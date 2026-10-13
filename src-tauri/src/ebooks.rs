use crate::{
    model::*,
    reading::{inside_zip, open_zip, zip_text},
    visual::Media,
};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Read, path::Path};
mod extra;
mod rtf;
pub use extra::import_extra;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookOutline {
    pub title: String,
    pub chapter_id: String,
    pub offset: usize,
    pub children: Vec<BookOutline>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookImage {
    pub offset: usize,
    pub image_id: String,
    pub caption: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Footnote {
    pub start: usize,
    pub end: usize,
    pub label: String,
    pub text: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookContent {
    pub chapter_id: String,
    pub source_hash: String,
    pub images: Vec<BookImage>,
    pub footnotes: Vec<Footnote>,
}
pub fn validate(p: &Project) -> Result<()> {
    fn outline(p: &Project, items: &[BookOutline], depth: usize) -> Result<()> {
        if depth > 64 {
            return Err(AppError::new("INVALID_DOCUMENT", "目录层级过深。"));
        }
        for i in items {
            p.chapter(&i.chapter_id)?;
            outline(p, &i.children, depth + 1)?;
        }
        Ok(())
    }
    outline(p, &p.book_outline, 0)?;
    for c in &p.book_content {
        p.chapter(&c.chapter_id)?;
        if c.images
            .iter()
            .any(|i| uuid::Uuid::parse_str(&i.image_id).is_err())
            || c.footnotes.iter().any(|n| n.end <= n.start)
        {
            return Err(AppError::new(
                "INVALID_DOCUMENT",
                "电子书插图或脚注关联无效。",
            ));
        }
    }
    Ok(())
}
#[derive(Default, Debug)]
struct Node {
    name: String,
    attrs: HashMap<String, String>,
    value: String,
    children: Vec<Node>,
}
impl Node {
    fn attr(&self, key: &str) -> &str {
        self.attrs.get(key).map(String::as_str).unwrap_or("")
    }
    fn all<'a>(&'a self, name: &str, into: &mut Vec<&'a Node>) {
        if self.name == name {
            into.push(self);
        }
        for c in &self.children {
            c.all(name, into);
        }
    }
    fn find(&self, name: &str) -> Vec<&Node> {
        let mut v = vec![];
        self.all(name, &mut v);
        v
    }
    fn text(&self) -> String {
        if ["script", "style", "head"].contains(&self.name.as_str()) {
            String::new()
        } else {
            self.value.clone() + &self.children.iter().map(Node::text).collect::<String>()
        }
    }
}
fn xml(source: &str) -> Result<Node> {
    let source = source.replace("&nbsp;", "\u{a0}");
    let mut reader = Reader::from_str(&source);
    let mut stack = vec![Node::default()];
    loop {
        let event = reader
            .read_event()
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 标记格式无效。"))?;
        let empty = matches!(&event, Event::Empty(_));
        match event {
            Event::Start(e) | Event::Empty(e) => {
                let node = Node {
                    name: String::from_utf8_lossy(e.local_name().as_ref()).into(),
                    attrs: e
                        .attributes()
                        .flatten()
                        .filter_map(|a| {
                            a.unescape_value().ok().map(|v| {
                                (
                                    String::from_utf8_lossy(a.key.local_name().as_ref()).into(),
                                    v.into_owned(),
                                )
                            })
                        })
                        .collect(),
                    ..Node::default()
                };
                if empty {
                    stack.last_mut().unwrap().children.push(node);
                } else {
                    stack.push(node);
                }
                if stack.len() > 512 {
                    return Err(AppError::new("INVALID_DOCUMENT", "EPUB 标记层级过深。"));
                }
            }
            Event::End(_) => {
                if stack.len() > 1 {
                    let n = stack.pop().unwrap();
                    stack.last_mut().unwrap().children.push(n);
                }
            }
            Event::Text(t) => {
                let value = t
                    .xml_content()
                    .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 文字无效。"))?
                    .into_owned();
                stack.last_mut().unwrap().children.push(Node {
                    name: "#text".into(),
                    value,
                    ..Node::default()
                });
            }
            Event::CData(t) => stack.last_mut().unwrap().children.push(Node {
                name: "#text".into(),
                value: t
                    .decode()
                    .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 文字无效。"))?
                    .into_owned(),
                ..Node::default()
            }),
            Event::GeneralRef(r) => {
                let name = r
                    .decode()
                    .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 引用无效。"))?;
                let raw = format!("&{name};");
                let value = html_escape::decode_html_entities(&raw).into_owned();
                stack.last_mut().unwrap().children.push(Node {
                    name: "#text".into(),
                    value,
                    ..Node::default()
                });
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if stack.len() != 1 {
        return Err(AppError::new("INVALID_DOCUMENT", "EPUB 标记未闭合。"));
    }
    Ok(stack.pop().unwrap())
}
fn decoded(href: &str) -> String {
    url::form_urlencoded::parse(format!("p={}", href.replace('+', "%2B")).as_bytes())
        .next()
        .map(|(_, v)| v.into_owned())
        .unwrap_or_default()
}
fn resolve(file: &str, href: &str) -> Result<(String, String)> {
    let href = decoded(href);
    let (path, fragment) = href.split_once('#').unwrap_or((&href, ""));
    let path = if path.is_empty() {
        file.into()
    } else {
        inside_zip(file.rsplit_once('/').map(|(b, _)| b).unwrap_or(""), path)?
    };
    Ok((path, fragment.into()))
}
fn load_image(
    zip: &mut zip::ZipArchive<std::fs::File>,
    path: &str,
    media: &mut Vec<Media>,
    seen: &mut HashMap<String, String>,
) -> Result<String> {
    if let Some(id) = seen.get(path) {
        return Ok(id.clone());
    }
    let f = zip
        .by_name(path)
        .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 缺少插图文件。"))?;
    let mut bytes = vec![];
    f.take(20 * 1024 * 1024 + 1).read_to_end(&mut bytes)?;
    let image = Media::from_book_image_bytes(bytes)?;
    let id = image.id.clone();
    media.push(image);
    seen.insert(path.into(), id.clone());
    Ok(id)
}
struct Section {
    text: String,
    images: Vec<BookImage>,
    footnotes: Vec<Footnote>,
    anchors: HashMap<String, usize>,
}
struct Render<'a> {
    zip: &'a mut zip::ZipArchive<std::fs::File>,
    media: &'a mut Vec<Media>,
    seen: &'a mut HashMap<String, String>,
    notes: &'a HashMap<(String, String), String>,
    file: &'a str,
}
fn body(n: &Node, s: &mut Section, r: &mut Render<'_>) -> Result<()> {
    if ["head", "style", "script"].contains(&n.name.as_str())
        || n.attr("type")
            .split_whitespace()
            .any(|t| ["footnote", "endnote"].contains(&t))
        || ["doc-footnote", "doc-endnote"].contains(&n.attr("role"))
    {
        return Ok(());
    }
    let block = [
        "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "section", "tr",
    ]
    .contains(&n.name.as_str());
    if block && !s.text.is_empty() && !s.text.ends_with("\n\n") {
        s.text.push_str("\n\n");
    }
    if !n.attr("id").is_empty() {
        s.anchors
            .insert(n.attr("id").into(), s.text.encode_utf16().count());
    }
    if n.name == "#text" {
        if !(n.value.trim().is_empty() && n.value.contains('\n')) {
            s.text.push_str(&n.value);
        }
        return Ok(());
    }
    if n.name == "img" || (n.name == "image" && !n.attr("href").is_empty()) {
        let href = if n.name == "img" {
            n.attr("src")
        } else {
            n.attr("href")
        };
        let (path, _) = resolve(r.file, href)?;
        let id = load_image(r.zip, &path, r.media, r.seen)?;
        s.images.push(BookImage {
            offset: s.text.encode_utf16().count(),
            image_id: id,
            caption: n.attr("alt").into(),
        });
        return Ok(());
    }
    if n.name == "a"
        && (n.attr("type").split_whitespace().any(|t| t == "noteref")
            || n.attr("role") == "doc-noteref")
    {
        let target = resolve(r.file, n.attr("href"))?;
        if let Some(text) = r.notes.get(&target) {
            let label = n.text();
            let start = s.text.encode_utf16().count();
            s.text.push_str(&label);
            s.footnotes.push(Footnote {
                start,
                end: s.text.encode_utf16().count(),
                label,
                text: text.trim().into(),
            });
            return Ok(());
        }
    }
    if n.name == "br" {
        s.text.push('\n');
    }
    for c in &n.children {
        body(c, s, r)?;
    }
    if block && !s.text.ends_with("\n\n") {
        s.text.push_str("\n\n");
    }
    Ok(())
}
type Locations = HashMap<String, Vec<(String, usize, usize)>>;
fn destination(
    file: &str,
    href: &str,
    locations: &Locations,
    anchors: &HashMap<(String, String), usize>,
) -> Option<(String, usize)> {
    let (path, fragment) = resolve(file, href).ok()?;
    let offset = anchors.get(&(path.clone(), fragment)).copied().unwrap_or(0);
    let parts = locations.get(&path)?;
    let part = parts
        .iter()
        .find(|(_, a, b)| offset >= *a && offset < *b)
        .or_else(|| parts.last())?;
    Some((part.0.clone(), offset.saturating_sub(part.1)))
}
fn nav_items(
    n: &Node,
    file: &str,
    locations: &Locations,
    anchors: &HashMap<(String, String), usize>,
) -> Vec<BookOutline> {
    let mut items = vec![];
    for li in n.children.iter().filter(|n| n.name == "li") {
        let a = li
            .children
            .iter()
            .find(|n| n.name == "a" || n.name == "span");
        let children = li
            .children
            .iter()
            .filter(|n| n.name == "ol" || n.name == "ul")
            .flat_map(|n| nav_items(n, file, locations, anchors))
            .collect::<Vec<_>>();
        let target = a
            .and_then(|a| destination(file, a.attr("href"), locations, anchors))
            .or_else(|| children.first().map(|c| (c.chapter_id.clone(), c.offset)));
        if let Some((chapter_id, offset)) = target {
            items.push(BookOutline {
                title: a.map(Node::text).unwrap_or_default().trim().into(),
                chapter_id,
                offset,
                children,
            });
        }
    }
    items
}
fn ncx_items(
    n: &Node,
    file: &str,
    locations: &Locations,
    anchors: &HashMap<(String, String), usize>,
) -> Vec<BookOutline> {
    n.children
        .iter()
        .filter(|n| n.name == "navPoint")
        .filter_map(|point| {
            let children = ncx_items(point, file, locations, anchors);
            let target = point
                .children
                .iter()
                .find(|n| n.name == "content")
                .and_then(|n| destination(file, n.attr("src"), locations, anchors))
                .or_else(|| children.first().map(|c| (c.chapter_id.clone(), c.offset)))?;
            Some(BookOutline {
                title: point
                    .children
                    .iter()
                    .find(|n| n.name == "navLabel")
                    .map(Node::text)
                    .unwrap_or_default()
                    .trim()
                    .into(),
                chapter_id: target.0,
                offset: target.1,
                children,
            })
        })
        .collect()
}
pub fn import_epub(path: &Path) -> Result<(Project, Vec<Media>)> {
    let mut zip = open_zip(path)?;
    let container = xml(&zip_text(&mut zip, "META-INF/container.xml")?)?;
    let opf = container
        .find("rootfile")
        .first()
        .map(|n| n.attr("full-path").to_string())
        .filter(|s| crate::files::valid_zip_name(s))
        .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "EPUB 缺少阅读清单。"))?;
    let manifest = xml(&zip_text(&mut zip, &opf)?)?;
    let items = manifest.find("item");
    let mut documents = HashMap::new();
    let mut notes = HashMap::new();
    for item in &items {
        if item.attr("media-type") == "application/xhtml+xml" {
            let file = resolve(&opf, item.attr("href"))?.0;
            let doc = xml(&zip_text(&mut zip, &file)?)?;
            documents.insert(file, doc);
        }
    }
    let mut targets = std::collections::HashSet::new();
    for (file, doc) in &documents {
        for a in doc.find("a") {
            if a.attr("type").split_whitespace().any(|t| t == "noteref")
                || a.attr("role") == "doc-noteref"
            {
                targets.insert(resolve(file, a.attr("href"))?);
            }
        }
    }
    fn note_nodes(
        n: &Node,
        file: &str,
        targets: &std::collections::HashSet<(String, String)>,
        notes: &mut HashMap<(String, String), String>,
    ) {
        let key = (file.to_string(), n.attr("id").to_string());
        if !key.1.is_empty() && targets.contains(&key) {
            notes.insert(key, n.text());
        }
        for child in &n.children {
            note_nodes(child, file, targets, notes);
        }
    }
    for (file, doc) in &documents {
        note_nodes(doc, file, &targets, &mut notes);
    }
    let title = manifest
        .find("title")
        .first()
        .map(|n| n.text())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("导入的书")
                .into()
        });
    let mut p = Project::new(title.trim().chars().take(100).collect());
    p.book_source = "epub".into();
    p.genre = "阅读".into();
    let mut media = vec![];
    let mut seen = HashMap::new();
    let mut locations = Locations::new();
    let mut anchors = HashMap::new();
    let cover_id = manifest
        .find("meta")
        .iter()
        .find(|n| n.attr("name") == "cover")
        .map(|n| n.attr("content"));
    if let Some(cover) = items.iter().find(|n| {
        n.attr("properties")
            .split_whitespace()
            .any(|s| s == "cover-image")
            || cover_id == Some(n.attr("id"))
    }) {
        p.cover_image_id = load_image(
            &mut zip,
            &resolve(&opf, cover.attr("href"))?.0,
            &mut media,
            &mut seen,
        )?;
    }
    for entry in manifest.find("itemref") {
        if entry.attr("linear") == "no" {
            continue;
        }
        let item = items
            .iter()
            .find(|n| n.attr("id") == entry.attr("idref"))
            .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "EPUB 阅读顺序引用缺失。"))?;
        let file = resolve(&opf, item.attr("href"))?.0;
        let doc = documents
            .get(&file)
            .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "EPUB 章节不是可读取的 XHTML。"))?;
        let mut s = Section {
            text: String::new(),
            images: vec![],
            footnotes: vec![],
            anchors: HashMap::new(),
        };
        body(
            doc,
            &mut s,
            &mut Render {
                zip: &mut zip,
                media: &mut media,
                seen: &mut seen,
                notes: &notes,
                file: &file,
            },
        )?;
        for (key, offset) in &s.anchors {
            anchors.insert((file.clone(), key.clone()), *offset);
        }
        if s.text.trim().is_empty() && s.images.is_empty() {
            continue;
        }
        let heading = doc
            .find("h1")
            .into_iter()
            .next()
            .or_else(|| doc.find("h2").into_iter().next())
            .map(Node::text)
            .unwrap_or_else(|| format!("第 {} 节", p.chapters.len() + 1));
        let chars = s.text.chars().collect::<Vec<_>>();
        let mut from = 0;
        let mut offset = 0;
        let mut section_parts = vec![];
        loop {
            let mut to = (from + 16000).min(chars.len());
            if to < chars.len() {
                if let Some(i) = chars[from + 12000..to].iter().rposition(|c| *c == '\n') {
                    to = from + 12000 + i + 1;
                }
            }
            let working = chars[from..to].iter().collect::<String>();
            let finish = offset + working.encode_utf16().count();
            let mut chapter = Chapter {
                title: if chars.len() > 16000 {
                    format!("{} · {}", heading.trim(), section_parts.len() + 1)
                } else {
                    heading.trim().into()
                },
                working: working.clone(),
                ..Chapter::default()
            };
            if !working.trim().is_empty() {
                let version = Version {
                    id: id(),
                    chapter_id: chapter.id.clone(),
                    number: 1,
                    content: working,
                    author: "import".into(),
                    base_version_id: String::new(),
                    created_at: now(),
                    branch: false,
                };
                chapter.current_version_id = version.id.clone();
                chapter.approved_version_id = version.id.clone();
                chapter.versions.push(version);
            }
            let images = s
                .images
                .iter()
                .filter(|i| {
                    i.offset >= offset
                        && (i.offset < finish || (to == chars.len() && i.offset == finish))
                })
                .map(|i| BookImage {
                    offset: i.offset - offset,
                    ..i.clone()
                })
                .collect();
            let footnotes = s
                .footnotes
                .iter()
                .filter(|n| n.start >= offset && n.end <= finish)
                .map(|n| Footnote {
                    start: n.start - offset,
                    end: n.end - offset,
                    ..n.clone()
                })
                .collect();
            p.book_content.push(BookContent {
                chapter_id: chapter.id.clone(),
                source_hash: hash(&chapter.working),
                images,
                footnotes,
            });
            section_parts.push((chapter.id.clone(), offset, finish.max(offset + 1)));
            p.chapters.push(chapter);
            from = to;
            offset = finish;
            if to == chars.len() {
                break;
            }
        }
        locations.insert(file, section_parts);
    }
    if p.chapters.is_empty() {
        return Err(AppError::new(
            "EMPTY_CONTENT",
            "EPUB 没有可阅读的正文或插图。",
        ));
    }
    if let Some(item) = items
        .iter()
        .find(|n| n.attr("properties").split_whitespace().any(|s| s == "nav"))
    {
        let file = resolve(&opf, item.attr("href"))?.0;
        if let Some(doc) = documents.get(&file) {
            if let Some(nav) = doc
                .find("nav")
                .iter()
                .find(|n| n.attr("type").split_whitespace().any(|s| s == "toc"))
            {
                if let Some(list) = nav
                    .children
                    .iter()
                    .find(|n| n.name == "ol" || n.name == "ul")
                {
                    p.book_outline = nav_items(list, &file, &locations, &anchors);
                }
            }
        }
    }
    if p.book_outline.is_empty() {
        if let Some(item) = items
            .iter()
            .find(|n| n.attr("media-type") == "application/x-dtbncx+xml")
        {
            let file = resolve(&opf, item.attr("href"))?.0;
            let doc = xml(&zip_text(&mut zip, &file)?)?;
            if let Some(map) = doc.find("navMap").first() {
                p.book_outline = ncx_items(map, &file, &locations, &anchors);
            }
        }
    }
    if p.book_outline.is_empty() {
        p.book_outline = p
            .chapters
            .iter()
            .map(|c| BookOutline {
                title: c.title.clone(),
                chapter_id: c.id.clone(),
                ..BookOutline::default()
            })
            .collect();
    }
    p.reader.chapter_id = p.chapters[0].id.clone();
    p.validate()?;
    Ok((p, media))
}

pub fn import_docx(path: &Path) -> Result<(Project, Vec<Media>)> {
    let mut zip = open_zip(path)?;
    let doc = xml(&zip_text(&mut zip, "word/document.xml")?)?;
    let rels = if let Ok(text) = zip_text(&mut zip, "word/_rels/document.xml.rels") {
        xml(&text)?
    } else {
        Node::default()
    };
    let targets = rels
        .find("Relationship")
        .into_iter()
        .filter(|n| n.attr("TargetMode") != "External")
        .map(|n| (n.attr("Id").to_string(), n.attr("Target").to_string()))
        .collect::<HashMap<_, _>>();
    let notes = if let Ok(text) = zip_text(&mut zip, "word/footnotes.xml") {
        xml(&text)?
    } else {
        Node::default()
    };
    let note_map = notes
        .find("footnote")
        .into_iter()
        .map(|n| (n.attr("id").to_string(), n.text()))
        .collect::<HashMap<_, _>>();
    let mut section = Section {
        text: String::new(),
        images: vec![],
        footnotes: vec![],
        anchors: HashMap::new(),
    };
    let mut media = vec![];
    let mut seen = HashMap::new();
    fn render(
        n: &Node,
        s: &mut Section,
        zip: &mut zip::ZipArchive<std::fs::File>,
        media: &mut Vec<Media>,
        seen: &mut HashMap<String, String>,
        targets: &HashMap<String, String>,
        notes: &HashMap<String, String>,
    ) -> Result<()> {
        if n.name == "t" {
            s.text.push_str(&n.text());
            return Ok(());
        }
        if n.name == "p" {
            if !s.text.is_empty() && !s.text.ends_with("\n\n") {
                s.text.push_str("\n\n");
            }
            if n.find("pStyle")
                .iter()
                .any(|n| n.attr("val").to_lowercase().starts_with("heading"))
            {
                s.text.push_str("# ");
            }
        }
        if n.name == "tab" {
            s.text.push('\t');
        }
        if n.name == "br" || n.name == "cr" {
            s.text.push('\n');
        }
        if n.name == "blip" {
            if let Some(target) = targets.get(n.attr("embed")) {
                let path = resolve("word/document.xml", target)?.0;
                let id = load_image(zip, &path, media, seen)?;
                s.images.push(BookImage {
                    offset: s.text.encode_utf16().count(),
                    image_id: id,
                    caption: String::new(),
                });
            }
            return Ok(());
        }
        if n.name == "footnoteReference" {
            if let Some(text) = notes.get(n.attr("id")) {
                let label = format!("[{}]", n.attr("id"));
                let start = s.text.encode_utf16().count();
                s.text.push_str(&label);
                s.footnotes.push(Footnote {
                    start,
                    end: s.text.encode_utf16().count(),
                    label,
                    text: text.trim().into(),
                });
            }
            return Ok(());
        }
        for child in &n.children {
            render(child, s, zip, media, seen, targets, notes)?;
        }
        if n.name == "p" && !s.text.ends_with("\n\n") {
            s.text.push_str("\n\n");
        }
        Ok(())
    }
    render(
        &doc,
        &mut section,
        &mut zip,
        &mut media,
        &mut seen,
        &targets,
        &note_map,
    )?;
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("导入的文档");
    let mut p = if section.text.trim().is_empty() && !section.images.is_empty() {
        let mut p = Project::new(title.into());
        p.book_source = "docx".into();
        p.genre = "阅读".into();
        p.chapters.push(Chapter {
            title: "正文".into(),
            ..Chapter::default()
        });
        p.reader.chapter_id = p.chapters[0].id.clone();
        p
    } else {
        crate::reading::document_project(title, "docx", &section.text)?
    };
    let mut cursor = 0;
    for c in &p.chapters {
        let begin = section.text[cursor..]
            .find(&c.working)
            .map(|i| i + cursor)
            .unwrap_or(cursor);
        let end = begin + c.working.len();
        let start_offset = section.text[..begin].encode_utf16().count();
        let end_offset = section.text[..end].encode_utf16().count();
        cursor = end;
        let images = section
            .images
            .iter()
            .filter(|i| i.offset >= start_offset && i.offset <= end_offset)
            .map(|i| BookImage {
                offset: i.offset - start_offset,
                ..i.clone()
            })
            .collect();
        let footnotes = section
            .footnotes
            .iter()
            .filter(|n| n.start >= start_offset && n.end <= end_offset)
            .map(|n| Footnote {
                start: n.start - start_offset,
                end: n.end - start_offset,
                ..n.clone()
            })
            .collect();
        p.book_content.push(BookContent {
            chapter_id: c.id.clone(),
            source_hash: hash(&c.working),
            images,
            footnotes,
        });
    }
    if let Some(m) = media.first() {
        p.cover_image_id = m.id.clone();
    }
    p.validate()?;
    Ok((p, media))
}
