use super::{xml, BookContent, BookImage, BookOutline, Footnote, Node, Section};
use crate::{
    model::*,
    reading::{inside_zip, open_zip, zip_text},
    visual::Media,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{collections::HashMap, io::Read, path::Path};

const MAX_DOCUMENT: u64 = 25 * 1024 * 1024;
const MAX_IMAGE: u64 = 20 * 1024 * 1024;

fn read_small(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let f = std::fs::File::open(path)?;
    if f.metadata()?.len() > limit {
        return Err(AppError::new("TOO_LARGE", "文件超过此格式的大小上限。"));
    }
    let mut bytes = vec![];
    f.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(AppError::new("TOO_LARGE", "文件读取时超过大小上限。"));
    }
    Ok(bytes)
}
fn decode(bytes: &[u8]) -> Result<String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let codec = if bytes[0] == 0xff {
            encoding_rs::UTF_16LE
        } else {
            encoding_rs::UTF_16BE
        };
        let (text, _, errors) = codec.decode(&bytes[2..]);
        if errors {
            return Err(AppError::new(
                "INVALID_ENCODING",
                "文档含无效 UTF-16 文字。",
            ));
        }
        return Ok(text.into_owned());
    }
    let header = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
    let label = regex::Regex::new(r#"(?i)(?:encoding|charset)\s*=\s*["']?([a-z0-9_-]+)"#).unwrap();
    if let Some(capture) = label.captures(&header) {
        let codec = encoding_rs::Encoding::for_label(capture[1].as_bytes())
            .ok_or_else(|| AppError::new("INVALID_ENCODING", "文档声明了未支持的编码。"))?;
        let (text, _, errors) = codec.decode(bytes);
        if errors {
            return Err(AppError::new(
                "INVALID_ENCODING",
                "文档与声明的字符编码不符。",
            ));
        }
        return Ok(text.into_owned());
    }
    crate::files::decode_reference(bytes, "utf8")
        .or_else(|_| crate::files::decode_reference(bytes, "gb18030"))
}
fn empty_section() -> Section {
    Section {
        text: String::new(),
        images: vec![],
        footnotes: vec![],
        anchors: HashMap::new(),
    }
}
struct Heading {
    title: String,
    offset: usize,
    level: usize,
}
type ImageLoader<'a> = dyn FnMut(&str) -> Result<Option<String>> + 'a;
struct Renderer<'a> {
    image: &'a mut ImageLoader<'a>,
    notes: HashMap<String, String>,
    headings: Vec<Heading>,
    format: &'a str,
    offset: usize,
}
fn render(n: &Node, s: &mut Section, r: &mut Renderer<'_>, depth: usize) -> Result<()> {
    if depth > 128 {
        return Err(AppError::new("INVALID_DOCUMENT", "文档层级过深。"));
    }
    if [
        "head",
        "script",
        "style",
        "iframe",
        "object",
        "embed",
        "noscript",
        "svg",
        "binary",
        "annotation",
        "tracked-changes",
    ]
    .contains(&n.name.as_str())
        || n.attr("type")
            .split_whitespace()
            .any(|v| ["footnote", "endnote"].contains(&v))
        || ["doc-footnote", "doc-endnote"].contains(&n.attr("role"))
    {
        return Ok(());
    }
    if n.name == "#text" {
        if !(n.value.trim().is_empty() && n.value.contains('\n')) {
            s.text.push_str(&n.value);
            r.offset += n.value.encode_utf16().count();
        }
        return Ok(());
    }
    let level = match n.name.as_str() {
        "h1" => 1,
        "h2" => 2,
        "h3" => 3,
        "h4" => 4,
        "h5" => 5,
        "h6" => 6,
        "h" if r.format == "odt" => n
            .attr("outline-level")
            .parse::<usize>()
            .unwrap_or(1)
            .clamp(1, 6),
        "title" if r.format == "fb2" => depth.saturating_sub(1).clamp(1, 6),
        _ => 0,
    };
    let block = level > 0
        || [
            "p",
            "div",
            "li",
            "section",
            "tr",
            "subtitle",
            "stanza",
            "v",
            "empty-line",
        ]
        .contains(&n.name.as_str());
    if block && !s.text.is_empty() && !s.text.ends_with("\n\n") {
        s.text.push_str("\n\n");
        r.offset += 2;
    }
    let offset = r.offset;
    if level > 0 && !n.text().trim().is_empty() {
        r.headings.push(Heading {
            title: n.text().trim().chars().take(100).collect(),
            offset,
            level,
        });
    }
    if !n.attr("id").is_empty() {
        s.anchors.insert(n.attr("id").into(), offset);
    }
    if n.name == "img" || n.name == "image" {
        let href = if n.name == "img" {
            n.attr("src")
        } else {
            n.attr("href")
        };
        if let Some(image_id) = (r.image)(href)? {
            s.images.push(BookImage {
                offset,
                image_id,
                caption: n.attr("alt").into(),
            });
        }
        return Ok(());
    }
    if n.name == "note" && r.format == "odt" {
        let label = n
            .find("note-citation")
            .first()
            .map(|v| v.text())
            .unwrap_or_else(|| "*".into());
        let note = n
            .find("note-body")
            .first()
            .map(|v| v.text())
            .unwrap_or_default();
        s.text.push_str(&label);
        r.offset += label.encode_utf16().count();
        s.footnotes.push(Footnote {
            start: offset,
            end: r.offset,
            label,
            text: note,
        });
        return Ok(());
    }
    if n.name == "a" {
        let note = n
            .attr("href")
            .strip_prefix('#')
            .and_then(|id| r.notes.get(id));
        if let Some(note) = note {
            let label = n.text();
            if !label.is_empty() {
                s.text.push_str(&label);
                r.offset += label.encode_utf16().count();
                s.footnotes.push(Footnote {
                    start: offset,
                    end: r.offset,
                    label,
                    text: note.clone(),
                });
                return Ok(());
            }
        }
    }
    if n.name == "br" || (r.format == "odt" && n.name == "line-break") {
        s.text.push('\n');
        r.offset += 1;
    }
    if r.format == "odt" && n.name == "s" {
        let count = n.attr("c").parse::<usize>().unwrap_or(1);
        if count > 10000 {
            return Err(AppError::new("TOO_LARGE", "文档重复空格过多。"));
        }
        s.text.push_str(&" ".repeat(count));
        r.offset += count;
    }
    if r.format == "odt" && n.name == "tab" {
        s.text.push('\t');
        r.offset += 1;
    }
    for child in &n.children {
        render(child, s, r, depth + 1)?;
    }
    if block && !s.text.ends_with("\n\n") {
        s.text.push_str("\n\n");
        r.offset += 2;
    }
    if s.text.len() > 100 * 1024 * 1024 {
        return Err(AppError::new("TOO_LARGE", "展开后的正文超过上限。"));
    }
    Ok(())
}
fn add_outline(items: &mut Vec<BookOutline>, value: BookOutline, level: usize, previous: usize) {
    if level > previous && !items.is_empty() {
        let last = items.last_mut().unwrap();
        add_outline(&mut last.children, value, level, previous + 1);
    } else {
        items.push(value);
    }
}
fn finish(
    title: String,
    source: &str,
    s: Section,
    headings: Vec<Heading>,
    media: Vec<Media>,
) -> Result<(Project, Vec<Media>)> {
    if s.text.trim().is_empty() && s.images.is_empty() {
        return Err(AppError::new("EMPTY_CONTENT", "文档没有可阅读正文或图片。"));
    }
    let mut p = Project::new(title.chars().take(100).collect());
    p.genre = "阅读".into();
    p.book_source = source.into();
    let chars: Vec<char> = s.text.chars().collect();
    let (mut from, mut offset) = (0, 0);
    let mut locations = vec![];
    loop {
        let mut to = (from + 16000).min(chars.len());
        if to < chars.len() {
            if let Some(i) = chars[from + 12000..to].iter().rposition(|c| *c == '\n') {
                to = from + 12000 + i + 1;
            }
        }
        let working: String = chars[from..to].iter().collect();
        let end = offset + working.encode_utf16().count();
        let heading = headings
            .iter()
            .find(|h| h.offset >= offset && h.offset < end);
        let mut c = Chapter {
            title: heading
                .map(|h| h.title.clone())
                .unwrap_or_else(|| format!("正文 · {}", p.chapters.len() + 1)),
            working: working.clone(),
            ..Chapter::default()
        };
        if !working.trim().is_empty() {
            let v = Version {
                id: id(),
                chapter_id: c.id.clone(),
                number: 1,
                content: working,
                author: "import".into(),
                base_version_id: String::new(),
                created_at: now(),
                branch: false,
            };
            c.current_version_id = v.id.clone();
            c.approved_version_id = v.id.clone();
            c.versions.push(v);
        }
        p.book_content.push(BookContent {
            chapter_id: c.id.clone(),
            source_hash: hash(&c.working),
            images: s
                .images
                .iter()
                .filter(|i| {
                    i.offset >= offset && (i.offset < end || (to == chars.len() && i.offset == end))
                })
                .map(|i| BookImage {
                    offset: i.offset - offset,
                    ..i.clone()
                })
                .collect(),
            footnotes: s
                .footnotes
                .iter()
                .filter(|n| n.start >= offset && n.end <= end)
                .map(|n| Footnote {
                    start: n.start - offset,
                    end: n.end - offset,
                    ..n.clone()
                })
                .collect(),
        });
        locations.push((c.id.clone(), offset, end));
        p.chapters.push(c);
        if to == chars.len() {
            break;
        }
        from = to;
        offset = end;
    }
    for h in headings {
        let Some((chapter_id, start, _)) = locations
            .iter()
            .find(|(_, a, b)| h.offset >= *a && h.offset < *b)
            .or_else(|| locations.last())
        else {
            continue;
        };
        add_outline(
            &mut p.book_outline,
            BookOutline {
                title: h.title,
                chapter_id: chapter_id.clone(),
                offset: h.offset.saturating_sub(*start),
                children: vec![],
            },
            h.level,
            1,
        );
    }
    p.cover_image_id = media.first().map(|m| m.id.clone()).unwrap_or_default();
    p.reader.chapter_id = p.chapters[0].id.clone();
    p.validate()?;
    Ok((p, media))
}
fn html_node(e: scraper::ElementRef<'_>, depth: usize, count: &mut usize) -> Result<Node> {
    *count += 1;
    if depth > 128 || *count > 200000 {
        return Err(AppError::new("TOO_LARGE", "HTML 结构过大或层级过深。"));
    }
    let mut n = Node {
        name: e.value().name().into(),
        attrs: e
            .value()
            .attrs()
            .map(|(k, v)| (k.rsplit(':').next().unwrap_or(k).into(), v.into()))
            .collect(),
        ..Node::default()
    };
    for child in e.children() {
        if let Some(text) = child.value().as_text() {
            *count += 1;
            n.children.push(Node {
                name: "#text".into(),
                value: text.to_string(),
                ..Node::default()
            });
        } else if let Some(element) = scraper::ElementRef::wrap(child) {
            n.children.push(html_node(element, depth + 1, count)?);
        }
    }
    Ok(n)
}
fn notes(doc: &Node) -> HashMap<String, String> {
    doc.find("aside")
        .into_iter()
        .chain(doc.find("div"))
        .chain(doc.find("li"))
        .filter(|n| {
            n.attr("type")
                .split_whitespace()
                .any(|t| ["footnote", "endnote"].contains(&t))
                || ["doc-footnote", "doc-endnote"].contains(&n.attr("role"))
        })
        .filter(|n| !n.attr("id").is_empty())
        .map(|n| (n.attr("id").into(), n.text()))
        .collect()
}
fn import_html(path: &Path) -> Result<(Project, Vec<Media>)> {
    let text = decode(&read_small(path, MAX_DOCUMENT)?)?;
    let parsed = scraper::Html::parse_document(&text);
    let doc = html_node(parsed.root_element(), 0, &mut 0)?;
    let title = doc
        .find("title")
        .first()
        .map(|n| n.text())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| title(path));
    let base = path.parent().unwrap_or(Path::new(".")).canonicalize()?;
    let mut media = vec![];
    let mut seen = HashMap::new();
    let mut image_bytes = 0usize;
    let mut loader = |href: &str| -> Result<Option<String>> {
        if href.is_empty() {
            return Ok(None);
        }
        if let Some(id) = seen.get(href) {
            return Ok(Some(String::clone(id)));
        }
        let bytes = if href.starts_with("data:image/") {
            let Some((header, data)) = href.split_once(',') else {
                return Ok(None);
            };
            if !header.ends_with(";base64") || data.len() > MAX_IMAGE as usize * 4 / 3 + 10 {
                return Err(AppError::new(
                    "INVALID_DOCUMENT",
                    "HTML 内嵌图片无效或过大。",
                ));
            }
            STANDARD
                .decode(data)
                .map_err(|_| AppError::new("INVALID_DOCUMENT", "HTML 图片编码无效。"))?
        } else {
            // Read only local assets inside the selected document's directory. No HTTP.
            let relative =
                url::form_urlencoded::parse(format!("p={}", href.replace('+', "%2B")).as_bytes())
                    .next()
                    .map(|(_, s)| s.into_owned())
                    .unwrap_or_default();
            if relative.contains(':') || relative.starts_with('/') || relative.starts_with('\\') {
                return Ok(None);
            }
            let candidate = base.join(relative.split('#').next().unwrap_or(""));
            let Ok(file) = candidate.canonicalize() else {
                return Ok(None);
            };
            if !file.starts_with(&base) {
                return Ok(None);
            }
            read_small(&file, MAX_IMAGE)?
        };
        image_bytes += bytes.len();
        if image_bytes > 100 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "HTML 插图总大小超过 100 MB。"));
        }
        let image = Media::from_book_image_bytes(bytes)?;
        let id = image.id.clone();
        media.push(image);
        seen.insert(href.to_owned(), id.clone());
        Ok(Some(id))
    };
    let mut s = empty_section();
    let mut r = Renderer {
        image: &mut loader,
        notes: notes(&doc),
        headings: vec![],
        format: "html",
        offset: 0,
    };
    render(&doc, &mut s, &mut r, 0)?;
    let headings = r.headings;
    finish(title, "html", s, headings, media)
}
fn title(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("导入的书")
        .into()
}
fn import_fb2(path: &Path, packed: bool) -> Result<(Project, Vec<Media>)> {
    let bytes = if packed {
        let mut zip = open_zip(path)?;
        let names: Vec<String> = zip
            .file_names()
            .filter(|n| n.to_lowercase().ends_with(".fb2"))
            .map(str::to_string)
            .collect();
        if names.len() != 1 {
            return Err(AppError::new(
                "INVALID_DOCUMENT",
                "压缩包必须包含且只包含一本 FB2。",
            ));
        }
        let f = zip
            .by_name(&names[0])
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "FB2 文件缺失。"))?;
        let mut b = vec![];
        f.take(MAX_DOCUMENT + 1).read_to_end(&mut b)?;
        if b.len() as u64 > MAX_DOCUMENT {
            return Err(AppError::new("TOO_LARGE", "FB2 正文超过 25 MB。"));
        }
        b
    } else {
        read_small(path, MAX_DOCUMENT)?
    };
    let doc = xml(&decode(&bytes)?)?;
    if doc.find("FictionBook").is_empty() {
        return Err(AppError::new("INVALID_DOCUMENT", "不是有效 FB2 文档。"));
    }
    let mut images = HashMap::new();
    let mut media = vec![];
    for n in doc.find("binary") {
        if !n.attr("content-type").starts_with("image/") {
            continue;
        }
        let encoded: String = n.text().chars().filter(|c| !c.is_whitespace()).collect();
        if encoded.len() > MAX_IMAGE as usize * 4 / 3 + 10 {
            return Err(AppError::new("TOO_LARGE", "FB2 图片过大。"));
        }
        let image = Media::from_book_image_bytes(
            STANDARD
                .decode(encoded)
                .map_err(|_| AppError::new("INVALID_DOCUMENT", "FB2 图片编码无效。"))?,
        )?;
        images.insert(n.attr("id").to_owned(), image.id.clone());
        media.push(image);
    }
    let mut note_map = HashMap::new();
    for body in doc
        .find("body")
        .into_iter()
        .filter(|n| ["notes", "comments"].contains(&n.attr("name")))
    {
        for n in body.find("section") {
            if !n.attr("id").is_empty() {
                note_map.insert(n.attr("id").to_owned(), n.text());
            }
        }
    }
    let mut loader = |href: &str| Ok(images.get(href.trim_start_matches('#')).cloned());
    let mut r = Renderer {
        image: &mut loader,
        notes: note_map,
        headings: vec![],
        format: "fb2",
        offset: 0,
    };
    let mut s = empty_section();
    for body in doc
        .find("body")
        .into_iter()
        .filter(|n| !["notes", "comments"].contains(&n.attr("name")))
    {
        render(body, &mut s, &mut r, 0)?;
    }
    let title = doc
        .find("book-title")
        .first()
        .map(|n| n.text())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| title(path));
    finish(title, "fb2", s, r.headings, media)
}
fn import_odt(path: &Path) -> Result<(Project, Vec<Media>)> {
    let mut zip = open_zip(path)?;
    if zip_text(&mut zip, "mimetype")?.trim() != "application/vnd.oasis.opendocument.text" {
        return Err(AppError::new("INVALID_DOCUMENT", "不是 ODT 文本文档。"));
    }
    let doc = xml(&zip_text(&mut zip, "content.xml")?)?;
    let metadata = zip_text(&mut zip, "meta.xml")
        .ok()
        .and_then(|s| xml(&s).ok());
    let title = metadata
        .as_ref()
        .and_then(|n| n.find("title").first().map(|v| v.text()))
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| title(path));
    let mut media = vec![];
    let mut seen = HashMap::new();
    let mut loader = |href: &str| -> Result<Option<String>> {
        let path = inside_zip("", href.trim_start_matches("./"))?;
        if let Some(id) = seen.get(&path) {
            return Ok(Some(String::clone(id)));
        }
        let f = zip
            .by_name(&path)
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "ODT 插图文件缺失。"))?;
        let mut bytes = vec![];
        f.take(MAX_IMAGE + 1).read_to_end(&mut bytes)?;
        let image = Media::from_book_image_bytes(bytes)?;
        let id = image.id.clone();
        media.push(image);
        seen.insert(path, id.clone());
        Ok(Some(id))
    };
    let mut s = empty_section();
    let mut r = Renderer {
        image: &mut loader,
        notes: HashMap::new(),
        headings: vec![],
        format: "odt",
        offset: 0,
    };
    let body = doc
        .find("body")
        .first()
        .copied()
        .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "ODT 缺少正文。"))?;
    render(body, &mut s, &mut r, 0)?;
    let headings = r.headings;
    finish(title, "odt", s, headings, media)
}
fn natural_compare(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek(), b.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let x: String = std::iter::from_fn(|| a.next_if(|c| c.is_ascii_digit())).collect();
                let y: String = std::iter::from_fn(|| b.next_if(|c| c.is_ascii_digit())).collect();
                let (x, y) = (x.trim_start_matches('0'), y.trim_start_matches('0'));
                let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
                if !order.is_eq() {
                    return order;
                }
            }
            _ => {
                let order = a
                    .next()
                    .unwrap()
                    .to_ascii_lowercase()
                    .cmp(&b.next().unwrap().to_ascii_lowercase());
                if !order.is_eq() {
                    return order;
                }
            }
        }
    }
}
fn import_cbz(path: &Path) -> Result<(Project, Vec<Media>)> {
    if path.metadata()?.len() > 100 * 1024 * 1024 {
        return Err(AppError::new("TOO_LARGE", "CBZ 超过 100 MB。"));
    }
    let mut zip = open_zip(path)?;
    let mut names: Vec<String> = zip
        .file_names()
        .filter(|n| {
            Path::new(n)
                .extension()
                .and_then(|e| e.to_str())
                .is_some_and(|e| {
                    ["png", "jpg", "jpeg", "webp", "gif"].contains(&e.to_lowercase().as_str())
                })
        })
        .map(str::to_string)
        .collect();
    names.sort_by(|a, b| natural_compare(a, b).then_with(|| a.cmp(b)));
    if names.is_empty() || names.len() > 3000 {
        return Err(AppError::new(
            "INVALID_DOCUMENT",
            "CBZ 需要包含 1～3000 张受支持图片。",
        ));
    }
    let mut p = Project::new(title(path));
    p.genre = "漫画".into();
    p.book_source = "cbz".into();
    p.reader.layout = "single".into();
    let mut media = vec![];
    for (index, name) in names.into_iter().enumerate() {
        let mut bytes = vec![];
        zip.by_name(&name)
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "CBZ 图片缺失。"))?
            .take(MAX_IMAGE + 1)
            .read_to_end(&mut bytes)?;
        let image = Media::from_book_image_bytes(bytes)?;
        let c = Chapter {
            title: format!(
                "第 {} 页 · {}",
                index + 1,
                Path::new(&name)
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            ),
            ..Chapter::default()
        };
        p.book_content.push(BookContent {
            chapter_id: c.id.clone(),
            source_hash: hash(""),
            images: vec![BookImage {
                offset: 0,
                image_id: image.id.clone(),
                caption: String::new(),
            }],
            footnotes: vec![],
        });
        p.book_outline.push(BookOutline {
            title: c.title.clone(),
            chapter_id: c.id.clone(),
            offset: 0,
            children: vec![],
        });
        p.chapters.push(c);
        media.push(image);
    }
    p.cover_image_id = media[0].id.clone();
    p.reader.chapter_id = p.chapters[0].id.clone();
    p.validate()?;
    Ok((p, media))
}
pub fn import_extra(path: &Path) -> Result<(Project, Vec<Media>)> {
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ext != "cbz" && path.metadata()?.len() > MAX_DOCUMENT {
        return Err(AppError::new("TOO_LARGE", "文档超过 25 MB。"));
    }
    match ext.as_str() {
        "html" | "htm" | "xhtml" => import_html(path),
        "fb2" => import_fb2(path, false),
        "fbz" | "fb2z" => import_fb2(path, true),
        "zip" if name.ends_with(".fb2.zip") => import_fb2(path, true),
        "odt" => import_odt(path),
        "cbz" => import_cbz(path),
        "rtf" => {
            let text = super::rtf::parse(&read_small(path, MAX_DOCUMENT)?)?;
            Ok((
                crate::reading::document_project(&title(path), "rtf", &text)?,
                vec![],
            ))
        }
        _ => Err(AppError::new(
            "UNSUPPORTED_DOCUMENT",
            "此格式尚不支持；可先转换为 EPUB、PDF 或 TXT。",
        )),
    }
}
