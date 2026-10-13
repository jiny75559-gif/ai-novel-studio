use novel_studio_lib::{
    context::*, db::Database, engine::*, files::*, model::*, provider::Secrets,
};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};

struct Mock {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
    mode: Arc<AtomicUsize>,
}
fn mock() -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let requests = Arc::new(Mutex::new(vec![]));
    let mode = Arc::new(AtomicUsize::new(0));
    let request_copy = requests.clone();
    let mode_copy = mode.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let requests = request_copy.clone();
            let mode = mode_copy.clone();
            std::thread::spawn(move || {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = vec![];
                let mut buf = [0; 8192];
                let (header_end, content_length) = loop {
                    let Ok(n) = stream.read(&mut buf) else { return };
                    if n == 0 {
                        return;
                    }
                    bytes.extend_from_slice(&buf[..n]);
                    if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        let header_end = end + 4;
                        let headers = String::from_utf8_lossy(&bytes[..end]);
                        let content_length = headers
                            .lines()
                            .find_map(|l| {
                                l.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|s| s.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if bytes.len() >= header_end + content_length {
                            break (header_end, content_length);
                        }
                    }
                };
                let input: Value =
                    serde_json::from_slice(&bytes[header_end..header_end + content_length])
                        .unwrap();
                requests.lock().unwrap().push(input.clone());
                let text = input["messages"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|m| m["content"].as_str().unwrap_or(""))
                    .collect::<Vec<_>>()
                    .join("\n");
                let state = mode.load(Ordering::SeqCst);
                if state == 1 && text.contains("现在写第 2 个场景") {
                    std::thread::sleep(std::time::Duration::from_secs(12));
                }
                if state == 3 {
                    std::thread::sleep(std::time::Duration::from_secs(2));
                }
                let reason = if state == 2 { "length" } else { "stop" };
                let output = if text.contains("REVIEW_JSON") {
                    let ch = text.find("\"chapterVersionId\":\"").unwrap()
                        + "\"chapterVersionId\":\"".len();
                    let vid = text[ch..].split('"').next().unwrap();
                    json!({"chapterVersionId":vid,"summary":"没有已核实的冲突","issues":[]})
                        .to_string()
                } else if text.contains("MEMORY_JSON") {
                    json!({"summary":"叶岚将铜钥匙交给林舟，两人离开灯塔。","facts":[{"category":"item","subjectId":"","predicate":"铜钥匙归属变化","value":"铜钥匙交给林舟","certainty":"confirmed","visibility":"reader_known","excerpt":"叶岚将铜钥匙交给林舟。","startOrder":2}]}).to_string()
                } else {
                    "雨水沿着石阶流淌，林舟护住受伤的左臂。叶岚握紧钥匙，远处的雾里透出微光。"
                        .repeat(50)
                        + "\n叶岚将铜钥匙交给林舟。两人离开灯塔。"
                };
                let body=json!({"choices":[{"message":{"content":output},"finish_reason":reason}],"usage":{"prompt_tokens":100,"completion_tokens":1000}}).to_string();
                let response=format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body);
                let _ = stream.write_all(response.as_bytes());
            });
        }
    });
    Mock {
        url: format!("http://{address}/v1"),
        requests,
        mode,
    }
}
fn setup(mock: &Mock, target: usize) -> (Arc<AppState>, Project) {
    let db = Database::open(Path::new(":memory:")).unwrap();
    let provider = Provider {
        base_url: mock.url.clone(),
        model_id: "mock".into(),
        allow_local_http: true,
        timeout_seconds: 10,
        ..Provider::default()
    };
    db.store_provider(&provider).unwrap();
    let secrets = Secrets::new();
    secrets
        .0
        .lock()
        .unwrap()
        .insert(provider.id.clone(), "mock-only".into());
    let mut p = fixture();
    p.settings.writer_id = provider.id.clone();
    p.settings.reviewer_id = provider.id;
    p.settings.target_chars = target;
    p.settings.context_tokens = 32000;
    let p = db.create(p).unwrap();
    (
        Arc::new(AppState {
            db,
            secrets,
            cancellations: Mutex::new(Default::default()),
            data_dir: std::env::temp_dir(),
        }),
        p,
    )
}
async fn task(state: &Arc<AppState>, p: &Project, cid: &str, kind: &str) -> Run {
    let rid = id();
    let run = prepare_run(state, &p.id, cid, kind, &rid, "", "").unwrap();
    execute(state.clone(), rid).await;
    state.db.run(&run.id).unwrap()
}

#[tokio::test]
async fn writing_preset_parameters_survive_resume_and_do_not_leak_to_reviewer() {
    let mock = mock();
    let (state, p) = setup(&mock, 600);
    let mut preset = novel_studio_lib::presets::builtins().remove(0);
    preset.use_parameters = true;
    preset.parameters.temperature = Some(0.35);
    preset.parameters.top_p = Some(0.8);
    preset.parameters.frequency_penalty = Some(0.4);
    preset.parameters.max_tokens = Some(2048);
    let p = state
        .db
        .mutate(
            &p.id,
            p.revision,
            Mutation::WritingPreset {
                preset: Some(preset.clone()),
            },
        )
        .unwrap();
    let cid = &p.chapters[0].id;
    mock.mode.store(2, Ordering::SeqCst);
    let failed = task(&state, &p, cid, "write").await;
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error.unwrap().code, "OUTPUT_TRUNCATED");
    preset.name = "库中修改不会替换作品副本".into();
    state.db.save_writing_preset(&preset).unwrap();
    mock.mode.store(0, Ordering::SeqCst);
    let resumed = prepare_run(&state, &p.id, cid, "write", &id(), &failed.id, "").unwrap();
    assert_eq!(resumed.snapshot.provider.max_tokens, 2048);
    execute(state.clone(), resumed.id.clone()).await;
    assert_eq!(state.db.run(&resumed.id).unwrap().status, "succeeded");
    let written = mock.requests.lock().unwrap().last().unwrap().clone();
    assert_eq!(written["max_tokens"], 2048);
    assert_eq!(written["temperature"], 0.35);
    assert_eq!(written["top_p"], 0.8);
    assert_eq!(written["frequency_penalty"], 0.4);
    assert_eq!(task(&state, &p, cid, "review").await.status, "succeeded");
    let reviewed = mock.requests.lock().unwrap().last().unwrap().clone();
    assert_eq!(reviewed["max_tokens"], 4096);
    assert_eq!(reviewed["temperature"], 0.7);
    assert!(reviewed.get("top_p").is_none());
    assert!(reviewed["messages"]
        .to_string()
        .contains("作者写作预设规范"));
}

#[tokio::test]
async fn generation_memory_edit_and_next_context() {
    let mock = mock();
    let (state, p) = setup(&mock, 600);
    let cid = &p.chapters[0].id;
    let run = task(&state, &p, cid, "write").await;
    assert_eq!(run.status, "succeeded");
    let p = state.db.load(&p.id).unwrap();
    assert!(p.chapters[1].working.is_empty());
    let run = task(&state, &p, cid, "review").await;
    assert_eq!(run.status, "succeeded");
    let p = state.db.load(&p.id).unwrap();
    let p = state
        .db
        .approve(&p.id, cid, &p.chapters[0].current_version_id, "")
        .unwrap();
    let run = task(&state, &p, cid, "remember").await;
    assert_eq!(run.status, "succeeded");
    let mut p = state.db.load(&p.id).unwrap();
    assert_eq!(p.facts.len(), 3);
    assert_eq!(p.proposals[0].status, "pending");
    assert!(p.proposals[0].verified);
    let prop = p.proposals[0].id.clone();
    p = state
        .db
        .mutate(
            &p.id,
            p.revision,
            Mutation::Proposal {
                proposal_id: prop,
                accept: true,
            },
        )
        .unwrap();
    assert_eq!(p.facts.len(), 4);
    let edited = p.chapters[0].working.clone() + "\n作者修改：两人在堤岸遇见巡逻队。";
    p = state
        .db
        .save_working(&p.id, cid, p.chapters[0].edit_revision, edited)
        .unwrap();
    p = state
        .db
        .save_version(&p.id, cid, p.chapters[0].edit_revision, "")
        .unwrap();
    p = state
        .db
        .approve(
            &p.id,
            cid,
            &p.chapters[0].current_version_id,
            "作者确认改稿",
        )
        .unwrap();
    assert!(p.chapters[1].upstream_changed);
    assert!(p.facts.iter().any(|f| f.needs_revalidation));
    assert!(p.chapters[0].summary_stale);
    let bundle = build_context(&p, &p.chapters[1].id).unwrap();
    let text = context_text(&bundle);
    assert!(text.contains("遇见巡逻队"));
    assert!(!bundle.items.iter().any(|i| i.label == "铜钥匙归属变化"));
    assert!(mock.requests.lock().unwrap().len() >= 3);
}

#[tokio::test]
async fn scene_timeout_keeps_checkpoint_and_recovers_only_missing_scene() {
    let mock = mock();
    mock.mode.store(1, Ordering::SeqCst);
    let (state, p) = setup(&mock, 2800);
    let cid = &p.chapters[0].id;
    let failed = task(&state, &p, cid, "write").await;
    assert_eq!(failed.status, "failed");
    assert_eq!(failed.error.as_ref().unwrap().code, "TIMEOUT");
    assert_eq!(failed.segments.len(), 1);
    assert_eq!(failed.segments[0].status, "complete");
    assert!(state.db.load(&p.id).unwrap().chapters[0]
        .versions
        .is_empty());
    let saved = failed.segments[0].text.clone();
    mock.mode.store(0, Ordering::SeqCst);
    let rid = id();
    let resumed = prepare_run(&state, &p.id, cid, "write", &rid, &failed.id, "").unwrap();
    assert_eq!(resumed.segments.len(), 1);
    execute(state.clone(), rid.clone()).await;
    let result = state.db.run(&rid).unwrap();
    assert_eq!(result.status, "succeeded");
    assert_eq!(result.calls, 1);
    assert_eq!(result.segments[0].text, saved);
    assert_eq!(mock.requests.lock().unwrap().len(), 3);
}

#[tokio::test]
async fn idempotence_single_writer_and_cancel() {
    let mock = mock();
    mock.mode.store(3, Ordering::SeqCst);
    let (state, p) = setup(&mock, 600);
    let cid = &p.chapters[0].id;
    let rid = id();
    let first = prepare_run(&state, &p.id, cid, "write", &rid, "", "").unwrap();
    let same = prepare_run(&state, &p.id, cid, "write", &rid, "", "").unwrap();
    assert_eq!(first.id, same.id);
    assert_eq!(state.db.list_runs(Some(&p.id)).unwrap().len(), 1);
    assert_eq!(
        prepare_run(&state, &p.id, cid, "write", &id(), "", "")
            .unwrap_err()
            .code,
        "ALREADY_RUNNING"
    );
    let copied = state.clone();
    let rr = rid.clone();
    let handle = tokio::spawn(async move {
        execute(copied, rr).await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;
    cancel_run(&state, &rid).unwrap();
    handle.await.unwrap();
    let run = state.db.run(&rid).unwrap();
    assert_eq!(run.status, "cancelled");
    assert!(state.db.load(&p.id).unwrap().chapters[0]
        .versions
        .is_empty());
}

#[tokio::test]
async fn truncation_is_failed_without_committed_chapter() {
    let mock = mock();
    mock.mode.store(2, Ordering::SeqCst);
    let (state, p) = setup(&mock, 600);
    let run = task(&state, &p, &p.chapters[0].id, "write").await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.unwrap().code, "OUTPUT_TRUNCATED");
    assert_eq!(run.segments[0].status, "partial");
    assert!(state.db.load(&p.id).unwrap().chapters[0]
        .versions
        .is_empty());
}

#[tokio::test]
async fn outline_changed_mid_run_produces_branch() {
    let mock = mock();
    mock.mode.store(3, Ordering::SeqCst);
    let (state, p) = setup(&mock, 600);
    let cid = p.chapters[0].id.clone();
    let rid = id();
    prepare_run(&state, &p.id, &cid, "write", &rid, "", "").unwrap();
    let mut ch = p.chapters[0].clone();
    ch.goal = "作者临时决定改变剧情".into();
    state
        .db
        .mutate(&p.id, p.revision, Mutation::Outline { chapter: ch })
        .unwrap();
    execute(state.clone(), rid.clone()).await;
    let run = state.db.run(&rid).unwrap();
    assert_eq!(run.status, "succeeded");
    let p = state.db.load(&p.id).unwrap();
    assert!(p.chapters[0].working.is_empty());
    assert!(p.chapters[0].versions[0].branch);
}

#[test]
fn interrupted_run_reopens_and_relation_positions_persist() {
    let mock = mock();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("p.db");
    let db = Database::open(&path).unwrap();
    let p = db.create(fixture()).unwrap();
    let provider = Provider {
        base_url: mock.url,
        model_id: "mock".into(),
        allow_local_http: true,
        ..Provider::default()
    };
    let state = AppState {
        db,
        secrets: Secrets::new(),
        cancellations: Mutex::new(Default::default()),
        data_dir: dir.path().into(),
    };
    let ctx = build_context(&p, &p.chapters[0].id).unwrap();
    let run = Run {
        id: id(),
        project_id: p.id.clone(),
        chapter_id: p.chapters[0].id.clone(),
        task: "write".into(),
        status: "running".into(),
        snapshot: Snapshot {
            project: p.clone(),
            chapter_id: p.chapters[0].id.clone(),
            outline_revision: 1,
            edit_revision: 0,
            context: ctx,
            scene_count: 2,
            override_reason: String::new(),
            provider,
            selected_issues: vec![],
        },
        segments: vec![Segment {
            index: 0,
            status: "complete".into(),
            text: "已完成片段".into(),
            finish_reason: "stop".into(),
            han_count: 5,
        }],
        error: None,
        calls: 1,
        input_tokens: 0,
        output_tokens: 0,
        created_at: now(),
        result_version_id: String::new(),
        recovered_from: String::new(),
    };
    state.db.begin_run(&run).unwrap();
    let mut c = p.characters[0].clone();
    c.x = 333.0;
    c.y = 444.0;
    let p = state
        .db
        .mutate(&p.id, p.revision, Mutation::Character { character: c })
        .unwrap();
    let mut relation = p.relations[0].clone();
    relation.id = String::new();
    relation.kind = "秘密同盟".into();
    let p = state
        .db
        .mutate(&p.id, p.revision, Mutation::Relation { relation })
        .unwrap();
    drop(state);
    let db = Database::open(&path).unwrap();
    assert_eq!(db.run(&run.id).unwrap().status, "interrupted");
    assert_eq!(db.run(&run.id).unwrap().segments[0].text, "已完成片段");
    let p = db.load(&p.id).unwrap();
    assert_eq!(p.characters[0].x, 333.0);
    assert_eq!(p.relations.len(), 2);
}

#[test]
fn zip_full_history_roundtrip_and_secret_absence() {
    let mock = mock();
    let (state, p) = setup(&mock, 600);
    let p = state
        .db
        .save_working(&p.id, &p.chapters[0].id, 0, "作者的第一稿".into())
        .unwrap();
    let p = state
        .db
        .save_version(&p.id, &p.chapters[0].id, p.chapters[0].edit_revision, "")
        .unwrap();
    let p = state
        .db
        .save_working(
            &p.id,
            &p.chapters[0].id,
            p.chapters[0].edit_revision,
            "作者的第二稿".into(),
        )
        .unwrap();
    let p = state
        .db
        .save_version(&p.id, &p.chapters[0].id, p.chapters[0].edit_revision, "")
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("backup.zip");
    export_package(&state.db, &p.id, &path).unwrap();
    let restored = state.db.create(read_package(&path).unwrap()).unwrap();
    assert_eq!(restored.chapters[0].versions.len(), 2);
    assert_eq!(restored.chapters[0].working, "作者的第二稿");
    assert!(restored.settings.writer_id.is_empty());
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).unwrap()).unwrap();
    let mut text = String::new();
    archive
        .by_name("project.json")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    assert!(!text.contains("mock-only"));
    assert!(!text.contains("baseUrl"));
}
