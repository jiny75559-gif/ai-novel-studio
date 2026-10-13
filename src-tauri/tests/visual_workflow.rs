use base64::{engine::general_purpose::STANDARD, Engine};
use novel_studio_lib::{
    db::Database, engine::AppState, files::*, model::*, provider::Secrets, reading::*, visual::*,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
fn png() -> Vec<u8> {
    let mut out = std::io::Cursor::new(vec![]);
    image::DynamicImage::new_rgba8(3, 4)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}
type CapturedRequests = Arc<Mutex<Vec<(String, Vec<u8>)>>>;
struct Mock {
    url: String,
    requests: CapturedRequests,
    hold: Arc<AtomicBool>,
}
fn mock() -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(vec![]));
    let copy = requests.clone();
    let hold = Arc::new(AtomicBool::new(false));
    let delay = hold.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let copy = copy.clone();
            let hold = delay.clone();
            std::thread::spawn(move || {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = vec![];
                let mut buf = [0; 8192];
                let (end, len) = loop {
                    let Ok(n) = stream.read(&mut buf) else { return };
                    if n == 0 {
                        return;
                    }
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let len = headers
                            .lines()
                            .find_map(|s| {
                                s.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|s| s.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= end + 4 + len {
                            break (end + 4, len);
                        }
                    }
                };
                let path = String::from_utf8_lossy(&bytes[..end])
                    .lines()
                    .next()
                    .unwrap()
                    .split_whitespace()
                    .nth(1)
                    .unwrap()
                    .to_string();
                let body = bytes[end..end + len].to_vec();
                copy.lock().unwrap().push((path.clone(), body));
                let (mime, body) = if path.starts_with("/view?") {
                    ("image/png", png())
                } else {
                    let response = match path.as_str() {
                        "/upload/image" => {
                            json!({"name":"confirmed.png","subfolder":"novel","type":"input"})
                        }
                        "/prompt" => json!({"prompt_id":"test-task"}),
                        "/history/test-task" => {
                            if hold.load(Ordering::SeqCst) {
                                json!({})
                            } else {
                                json!({"test-task":{"status":{"completed":true,"status_str":"success"},"outputs":{"9":{"images":[{"filename":"out.png","subfolder":"","type":"output"}]}}}})
                            }
                        }
                        "/images/generations" | "/images/edits" => {
                            json!({"data":[{"b64_json":STANDARD.encode(png())}]})
                        }
                        "/sdapi/v1/txt2img" | "/sdapi/v1/img2img" => {
                            json!({"images":[STANDARD.encode(png())]})
                        }
                        _ => json!({"ok":true}),
                    };
                    ("application/json", response.to_string().into_bytes())
                };
                let header=format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len());
                let _ = stream.write_all(header.as_bytes());
                let _ = stream.write_all(&body);
            });
        }
    });
    Mock {
        url: format!("http://{address}"),
        requests,
        hold,
    }
}
fn setup(m: &Mock, mode: &str) -> (Arc<AppState>, Project, ImageConfig) {
    let db = Database::open(Path::new(":memory:")).unwrap();
    let config = ImageConfig {
        base_url: m.url.clone(),
        mode: mode.into(),
        model_id: "mock-image".into(),
        workflow: json!({"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"10":{"class_type":"LoadImage","inputs":{"image":"old.png"}},"9":{"class_type":"SaveImage","inputs":{"images":["10",0],"conditioning":["6",0]}}}),
        seed_node: String::new(),
        negative_node: String::new(),
        reference_nodes: vec!["10".into()],
        ..Default::default()
    };
    db.save_image_config(&config).unwrap();
    let mut p = fixture();
    p.chapters[0].working = "她剪短了头发，戴上红色围巾。".into();
    p.visual_settings.provider_id = config.id.clone();
    let media = Media::from_bytes(png()).unwrap();
    db.store_media(&media).unwrap();
    p.visual_profiles.push(VisualProfile {
        character_id: p.characters[0].id.clone(),
        appearance: "圆脸，黑色长发，灰色眼睛。".into(),
        reference_image_id: media.id,
        revision: 1,
    });
    p.visual_changes.push(VisualChange {
        id: id(),
        character_id: p.characters[0].id.clone(),
        source_chapter_id: p.chapters[0].id.clone(),
        excerpt: "她剪短了头发".into(),
        description: "头发剪短".into(),
        start_order: 2,
        end_order: None,
    });
    let p = db.create(p).unwrap();
    let state = Arc::new(AppState {
        db,
        secrets: Secrets::new(),
        cancellations: Mutex::new(Default::default()),
        data_dir: std::env::temp_dir(),
    });
    (state, p, config)
}
fn request(p: &Project) -> ImageRequest {
    ImageRequest {
        id: id(),
        chapter_id: p.chapters[1].id.clone(),
        character_ids: vec![p.characters[0].id.clone()],
        kind: "chapter".into(),
        scene: "她站在庭院的灯下。".into(),
    }
}
async fn wait(s: &AppState, j: &str) -> ImageJob {
    for _ in 0..150 {
        let j = s.db.image_job(j).unwrap();
        if j.status != "running" {
            return j;
        }
        tokio::time::sleep(std::time::Duration::from_millis(40)).await;
    }
    panic!("job did not finish")
}
#[tokio::test]
async fn comfy_uploads_locked_reference_and_recovers_without_resubmission() {
    let m = mock();
    let (s, p, _) = setup(&m, "comfyui");
    m.hold.store(true, Ordering::SeqCst);
    let r = request(&p);
    let j = start_job(s.clone(), &p.id, r.clone()).unwrap();
    let duplicate = start_job(s.clone(), &p.id, r).unwrap();
    assert_eq!(j.id, duplicate.id);
    assert!(start_job(s.clone(), &p.id, request(&p)).is_err());
    for _ in 0..80 {
        if !s.db.image_job(&j.id).unwrap().remote_prompt_id.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
    cancel_job(&s, &j.id).unwrap();
    let cancelled = wait(&s, &j.id).await;
    assert_eq!(cancelled.status, "cancelled");
    assert_eq!(cancelled.remote_prompt_id, "test-task");
    m.hold.store(false, Ordering::SeqCst);
    resume_job(s.clone(), &j.id).unwrap();
    let done = wait(&s, &j.id).await;
    assert_eq!(done.status, "succeeded", "{:?}", done.error);
    let requests = m.requests.lock().unwrap();
    assert_eq!(requests.iter().filter(|(p, _)| p == "/prompt").count(), 1);
    assert_eq!(
        requests
            .iter()
            .filter(|(p, _)| p == "/upload/image")
            .count(),
        1
    );
    let submit: Value =
        serde_json::from_slice(&requests.iter().find(|(p, _)| p == "/prompt").unwrap().1).unwrap();
    assert_eq!(
        submit["prompt"]["10"]["inputs"]["image"],
        "novel/confirmed.png"
    );
    assert!(submit["prompt"]["6"]["inputs"]["text"]
        .as_str()
        .unwrap()
        .contains("头发剪短"));
    assert!(!requests.iter().any(|(p, _)| p == "/interrupt"));
    drop(requests);
    let after = s.db.load(&p.id).unwrap();
    assert_eq!(
        after.visual_profiles[0].reference_image_id,
        p.visual_profiles[0].reference_image_id
    );
    assert!(!after.artwork[0].approved);
    assert_eq!(after.artwork[0].chapter_id, p.chapters[1].id);
}
#[tokio::test]
async fn cloud_and_webui_receive_reference_images() {
    for mode in ["cloud", "webui"] {
        let m = mock();
        let (s, p, _) = setup(&m, mode);
        let j = start_job(s.clone(), &p.id, request(&p)).unwrap();
        let done = wait(&s, &j.id).await;
        assert_eq!(done.status, "succeeded", "{:?}", done.error);
        let requests = m.requests.lock().unwrap();
        if mode == "cloud" {
            let r = requests.iter().find(|(p, _)| p == "/images/edits").unwrap();
            assert!(String::from_utf8_lossy(&r.1).contains("name=\"image[]\""));
            assert!(r.1.windows(png().len()).any(|x| x == png()));
        } else {
            let r = requests
                .iter()
                .find(|(p, _)| p == "/sdapi/v1/img2img")
                .unwrap();
            let input: Value = serde_json::from_slice(&r.1).unwrap();
            assert!(input["init_images"][0]
                .as_str()
                .unwrap()
                .starts_with("data:image/png;base64,"));
        }
    }
}
#[test]
fn backup_restores_images_bookmarks_and_character_links() {
    let m = mock();
    let (s, mut p, _) = setup(&m, "cloud");
    p.reader.bookmarks.push(Bookmark {
        id: id(),
        chapter_id: p.chapters[0].id.clone(),
        offset: 8,
        label: "书签".into(),
    });
    p =
        s.db.mutate(
            &p.id,
            p.revision,
            Mutation::Reader {
                state: p.reader.clone(),
            },
        )
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("backup.zip");
    export_package(&s.db, &p.id, &path).unwrap();
    let imported = read_package(&path).unwrap();
    let assets = read_package_media(&path, &imported).unwrap();
    let db = Database::open(Path::new(":memory:")).unwrap();
    let restored = db.create_with_media(imported, &assets).unwrap();
    assert_ne!(restored.id, p.id);
    assert_eq!(
        restored.visual_profiles[0].character_id,
        restored.characters[0].id
    );
    assert_eq!(
        restored.reader.bookmarks[0].chapter_id,
        restored.chapters[0].id
    );
    assert!(restored.visual_settings.provider_id.is_empty());
    assert_eq!(
        db.media(&restored.visual_profiles[0].reference_image_id)
            .unwrap()
            .bytes,
        png()
    );
}
#[test]
fn document_import_reads_docx_and_epub_in_spine_order() {
    let dir = tempfile::tempdir().unwrap();
    let build = |name: &str, files: Vec<(&str, &str)>| {
        let path = dir.path().join(name);
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        for (name, text) in files {
            zip.start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        path
    };
    let docx=build("book.docx",vec![("word/document.xml","<w:document xmlns:w='w'><w:body><w:p><w:r><w:t>风 &amp; 雨</w:t></w:r></w:p></w:body></w:document>")]);
    let p = read_document(&docx, "auto").unwrap();
    assert!(p.chapters[0].working.contains("风 & 雨"));
    let epub=build("book.epub",vec![("META-INF/container.xml","<container><rootfiles><rootfile full-path='OEBPS/book.opf'/></rootfiles></container>"),("OEBPS/book.opf","<package><manifest><item id='b' href='b.xhtml'/><item id='a' href='a.xhtml'/></manifest><spine><itemref idref='a'/><itemref idref='b'/></spine></package>"),("OEBPS/b.xhtml","<html><body><p>结尾</p></body></html>"),("OEBPS/a.xhtml","<html><body><p>开篇</p></body></html>")]);
    let p = read_document(&epub, "auto").unwrap();
    assert!(
        p.chapters[0].working.find("开篇").unwrap() < p.chapters[0].working.find("结尾").unwrap()
    );
}
#[test]
fn old_projects_load_and_changed_quotes_stop_affecting_identity() {
    let m = mock();
    let (s, p, _) = setup(&m, "cloud");
    let mut json = serde_json::to_value(&p).unwrap();
    for key in [
        "reader",
        "bookSource",
        "visualSettings",
        "visualProfiles",
        "visualChanges",
        "artwork",
    ] {
        json.as_object_mut().unwrap().remove(key);
    }
    let old: Project = serde_json::from_value(json).unwrap();
    old.validate().unwrap();
    assert!(prepare_job(&s, &p.id, request(&p))
        .unwrap()
        .prompt
        .contains("头发剪短"));
    s.db.save_working(
        &p.id,
        &p.chapters[0].id,
        p.chapters[0].edit_revision,
        "她戴上围巾，走出家门。".into(),
    )
    .unwrap();
    assert!(!prepare_job(&s, &p.id, request(&p))
        .unwrap()
        .prompt
        .contains("头发剪短"));
}
