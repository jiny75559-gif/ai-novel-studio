use crate::model::*;
use quick_xml::{events::Event, Reader};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{io::Read, path::Path};
use zip::ZipArchive;

pub const MAX_PDF: usize = 100 * 1024 * 1024;
pub fn progress(p: &Project) -> f64 {
    if p.book_source == "cbz" {
        return p
            .chapters
            .iter()
            .position(|c| c.id == p.reader.chapter_id)
            .map(|i| (i + 1) as f64 / p.chapters.len().max(1) as f64)
            .unwrap_or(0.0);
    }
    if p.pdf_book.is_some() {
        return if p.reader.total_pages > 0 {
            ((p.reader.offset + 1) as f64 / p.reader.total_pages as f64).min(1.0)
        } else {
            0.0
        };
    }
    let mut done = 0usize;
    let mut total = 0usize;
    let mut past = false;
    for c in &p.chapters {
        let len = c.working.encode_utf16().count();
        total += len;
        if !past {
            if c.id == p.reader.chapter_id {
                done += p.reader.offset.min(len);
                past = true;
            } else {
                done += len;
            }
        }
    }
    if p.reader.chapter_id.is_empty() || total == 0 {
        0.0
    } else {
        (done as f64 / total as f64).min(1.0)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfBook {
    pub document_id: String,
}
pub fn pdf_document(path: &Path) -> Result<(Project, crate::visual::Media)> {
    if std::fs::metadata(path)?.len() > MAX_PDF as u64 {
        return Err(AppError::new("TOO_LARGE", "PDF 超过 100 MB。"));
    }
    let asset = crate::visual::Media::from_pdf_bytes(std::fs::read(path)?)?;
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("导入的 PDF");
    let mut p = Project::new(title.chars().take(100).collect());
    p.genre = "阅读".into();
    p.book_source = "pdf".into();
    p.pdf_book = Some(PdfBook {
        document_id: asset.id.clone(),
    });
    p.validate()?;
    Ok((p, asset))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReaderState {
    pub font_family: String,
    pub paragraph_spacing: usize,
    pub page_margin: usize,
    pub image_id: String,
    pub total_pages: usize,
    pub last_read_at: u64,
    pub chapter_id: String,
    pub offset: usize,
    pub font_size: usize,
    pub line_height: f64,
    pub zoom: usize,
    pub theme: String,
    pub layout: String,
    pub bookmarks: Vec<Bookmark>,
}
impl Default for ReaderState {
    fn default() -> Self {
        Self {
            font_family: "NanoOldSong".into(),
            paragraph_spacing: 12,
            page_margin: 44,
            image_id: String::new(),
            total_pages: 0,
            last_read_at: 0,
            chapter_id: String::new(),
            offset: 0,
            font_size: 22,
            line_height: 1.9,
            zoom: 100,
            theme: "paper".into(),
            layout: "double".into(),
            bookmarks: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bookmark {
    pub id: String,
    pub chapter_id: String,
    pub offset: usize,
    pub label: String,
}
impl ReaderState {
    pub fn validate(&self, p: &Project) -> Result<()> {
        if !(14..=36).contains(&self.font_size)
            || !["NanoOldSong", "SimSun", "Microsoft YaHei", "Georgia"]
                .contains(&self.font_family.as_str())
            || self.paragraph_spacing > 32
            || !(24..=64).contains(&self.page_margin)
            || !(1.4..=2.5).contains(&self.line_height)
            || !(50..=if p.pdf_book.is_some() { 400 } else { 160 }).contains(&self.zoom)
            || !["paper", "white", "night"].contains(&self.theme.as_str())
            || !["single", "double"].contains(&self.layout.as_str())
            || self.bookmarks.len() > 500
        {
            return Err(AppError::new(
                "VALIDATION",
                "阅读字号、行距、缩放或书签无效。",
            ));
        }
        if let Some(pdf) = &p.pdf_book {
            if uuid::Uuid::parse_str(&pdf.document_id).is_err()
                || p.book_source != "pdf"
                || !p.chapters.is_empty()
                || !self.chapter_id.is_empty()
                || self.offset > 1_000_000
                || self
                    .bookmarks
                    .iter()
                    .any(|b| !b.chapter_id.is_empty() || b.offset > 1_000_000)
            {
                return Err(AppError::new("VALIDATION", "PDF 文件关联或阅读页码无效。"));
            }
            return Ok(());
        }
        if !self.chapter_id.is_empty() {
            p.chapter(&self.chapter_id)?;
        }
        for b in &self.bookmarks {
            p.chapter(&b.chapter_id)?;
        }
        Ok(())
    }
}

const LIMIT: u64 = 25 * 1024 * 1024;
pub(crate) fn zip_text(zip: &mut ZipArchive<std::fs::File>, name: &str) -> Result<String> {
    let f = zip
        .by_name(name)
        .map_err(|_| AppError::new("INVALID_DOCUMENT", "文档缺少必要的内容文件。"))?;
    let mut bytes = vec![];
    f.take(LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(AppError::new("TOO_LARGE", "文档内容超过 25 MB。"));
    }
    String::from_utf8(bytes)
        .map_err(|_| AppError::new("INVALID_ENCODING", "文档内容不是有效 UTF-8。"))
}
pub(crate) fn open_zip(path: &Path) -> Result<ZipArchive<std::fs::File>> {
    let mut zip = ZipArchive::new(std::fs::File::open(path)?)
        .map_err(|_| AppError::new("INVALID_DOCUMENT", "文档结构无效或已加密。"))?;
    let mut total = 0;
    if zip.len() > 10000 {
        return Err(AppError::new("TOO_LARGE", "文档内部文件过多。"));
    }
    for n in 0..zip.len() {
        let f = zip
            .by_index(n)
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "无法读取文档。"))?;
        if !crate::files::valid_zip_name(f.name()) || f.is_symlink() {
            return Err(AppError::new(
                "INVALID_DOCUMENT",
                "文档含有不安全的内部路径。",
            ));
        }
        total += f.size();
        if total > 100 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "文档解压内容超过 100 MB。"));
        }
    }
    Ok(zip)
}
pub fn markup_text(source: &str) -> Result<String> {
    let mut reader = Reader::from_str(source);
    let mut result = String::new();
    let mut ignored = 0usize;
    loop {
        match reader
            .read_event()
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "文档标记格式不正确。"))?
        {
            Event::Start(e) => {
                let tag = e.local_name();
                let tag = tag.as_ref();
                if ignored > 0 || matches!(tag, b"script" | b"style" | b"head") {
                    ignored += 1;
                } else if matches!(tag, b"p" | b"h1" | b"h2" | b"h3" | b"li" | b"tr" | b"div")
                    && !result.ends_with('\n')
                {
                    result.push_str("\n\n");
                }
            }
            Event::End(e) => {
                if ignored > 0 {
                    ignored -= 1;
                } else if matches!(
                    e.local_name().as_ref(),
                    b"p" | b"h1" | b"h2" | b"h3" | b"li" | b"tr"
                ) {
                    result.push_str("\n\n");
                }
            }
            Event::Empty(e) if ignored == 0 => {
                if matches!(e.local_name().as_ref(), b"br" | b"cr") {
                    result.push('\n');
                } else if e.local_name().as_ref() == b"tab" {
                    result.push('\t');
                }
            }
            Event::Text(t) if ignored == 0 => {
                result.push_str(
                    &t.xml_content()
                        .map_err(|_| AppError::new("INVALID_ENCODING", "文档文字解码失败。"))?,
                );
            }
            Event::CData(t) if ignored == 0 => {
                result.push_str(
                    &t.decode()
                        .map_err(|_| AppError::new("INVALID_ENCODING", "文档文字解码失败。"))?,
                );
            }
            Event::GeneralRef(r) if ignored == 0 => {
                let name = r
                    .decode()
                    .map_err(|_| AppError::new("INVALID_DOCUMENT", "无效文字引用。"))?;
                let decoded = quick_xml::escape::unescape(&format!("&{name};"))
                    .map_err(|_| AppError::new("INVALID_DOCUMENT", "未知文字引用。"))?
                    .into_owned();
                result.push_str(&decoded);
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(result.trim().to_string())
}
fn attrs(e: &quick_xml::events::BytesStart<'_>, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == key)
        .and_then(|a| a.unescape_value().ok().map(|s| s.into_owned()))
}
pub(crate) fn inside_zip(base: &str, href: &str) -> Result<String> {
    if href.contains(':') || href.contains('\\') {
        return Err(AppError::new(
            "INVALID_DOCUMENT",
            "电子书不能引用外部网络文档。",
        ));
    }
    let raw = format!("{base}/{}", href.split('#').next().unwrap_or(""));
    let mut parts = vec![];
    for p in raw.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err(AppError::new("INVALID_DOCUMENT", "电子书引用越界。"));
                }
            }
            _ => parts.push(p),
        }
    }
    Ok(parts.join("/"))
}
fn epub_text(path: &Path) -> Result<String> {
    let mut zip = open_zip(path)?;
    let container = zip_text(&mut zip, "META-INF/container.xml")?;
    let mut reader = Reader::from_str(&container);
    let mut opf = None;
    loop {
        match reader
            .read_event()
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 容器无效。"))?
        {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"rootfile" => {
                opf = attrs(&e, b"full-path");
            }
            Event::Eof => break,
            _ => {}
        }
    }
    let opf = opf
        .filter(|s| crate::files::valid_zip_name(s))
        .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "EPUB 缺少阅读清单。"))?;
    let manifest = zip_text(&mut zip, &opf)?;
    let mut reader = Reader::from_str(&manifest);
    let mut items = std::collections::HashMap::new();
    let mut spine = vec![];
    loop {
        match reader
            .read_event()
            .map_err(|_| AppError::new("INVALID_DOCUMENT", "EPUB 阅读清单无效。"))?
        {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"item" => {
                if let (Some(id), Some(href)) = (attrs(&e, b"id"), attrs(&e, b"href")) {
                    items.insert(id, href);
                }
            }
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"itemref" => {
                if attrs(&e, b"linear").as_deref() != Some("no") {
                    if let Some(id) = attrs(&e, b"idref") {
                        spine.push(id);
                    }
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if spine.is_empty() {
        return Err(AppError::new("INVALID_DOCUMENT", "EPUB 没有可阅读内容。"));
    }
    let base = opf.rsplit_once('/').map(|x| x.0).unwrap_or("");
    let mut result = String::new();
    for key in spine {
        let href = items
            .get(&key)
            .ok_or_else(|| AppError::new("INVALID_DOCUMENT", "EPUB 章节引用缺失。"))?;
        let file = inside_zip(base, href)?;
        result.push_str(&markup_text(&zip_text(&mut zip, &file)?)?);
        result.push_str("\n\n");
        if result.len() as u64 > LIMIT {
            return Err(AppError::new("TOO_LARGE", "电子书正文超过 25 MB。"));
        }
    }
    Ok(result)
}
pub fn read_document(path: &Path, encoding: &str) -> Result<Project> {
    if std::fs::metadata(path)?.len() > LIMIT {
        return Err(AppError::new("TOO_LARGE", "文档超过 25 MB。"));
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let text = match ext.as_str() {
        "txt" | "md" | "markdown" => {
            let bytes = std::fs::read(path)?;
            if encoding == "auto" {
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
                            "UTF-16 文档含有无效文字。",
                        ));
                    }
                    text.into_owned()
                } else {
                    crate::files::decode_reference(&bytes, "utf8")
                        .or_else(|_| crate::files::decode_reference(&bytes, "gb18030"))?
                }
            } else {
                crate::files::decode_reference(&bytes, encoding)?
            }
        }
        "docx" => {
            let mut zip = open_zip(path)?;
            markup_text(&zip_text(&mut zip, "word/document.xml")?)?
        }
        "epub" => epub_text(path)?,
        _ => {
            return Err(AppError::new(
                "UNSUPPORTED_DOCUMENT",
                "支持 TXT、Markdown、DOCX、EPUB、PDF、HTML、FB2、RTF、ODT、CBZ。旧 DOC、MOBI/AZW3 请先转换为 EPUB 或 PDF。",
            ))
        }
    };
    document_project(
        path.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("导入的书"),
        &ext,
        &text,
    )
}
pub fn document_project(title: &str, source: &str, text: &str) -> Result<Project> {
    if text.trim().is_empty() {
        return Err(AppError::new("EMPTY_CONTENT", "文档没有可阅读的文字。"));
    }
    let heading=Regex::new(r"(?i)^(?:第[零〇一二三四五六七八九十百千万两0-9]+[章回节卷部篇].*|chapter\s+[0-9ivxlcdm]+.*|#{1,3}\s+\S.*)$").unwrap();
    let mut sections: Vec<(String, String)> = vec![];
    let mut current_title = "正文".to_string();
    let mut content = String::new();
    for line in text.split_inclusive('\n') {
        let name = line.trim();
        if name.chars().count() <= 100 && heading.is_match(name) {
            if !content.trim().is_empty() {
                sections.push((current_title, content));
                content = String::new();
            }
            current_title = name.trim_start_matches('#').trim().to_string();
        } else {
            content.push_str(line);
        }
    }
    if !content.trim().is_empty() {
        sections.push((current_title, content));
    }
    let mut p = Project::new(title.chars().take(100).collect());
    p.genre = "阅读".into();
    p.book_source = source.into();
    for (title, text) in sections {
        // Split very large sections at a paragraph boundary while preserving every character.
        let chars: Vec<char> = text.chars().collect();
        let mut start = 0;
        let mut part = 0;
        while start < chars.len() {
            let mut end = (start + 16000).min(chars.len());
            if end < chars.len() {
                if let Some(pos) = chars[start + 12000..end].iter().rposition(|c| *c == '\n') {
                    end = start + 12000 + pos + 1;
                }
            }
            part += 1;
            let body: String = chars[start..end].iter().collect();
            start = end;
            let mut c = Chapter {
                title: if chars.len() > 16000 {
                    format!("{title} · {part}")
                } else {
                    title.clone()
                },
                working: body.clone(),
                ..Chapter::default()
            };
            let v = Version {
                id: id(),
                chapter_id: c.id.clone(),
                number: 1,
                content: body,
                author: "import".into(),
                base_version_id: String::new(),
                created_at: now(),
                branch: false,
            };
            c.current_version_id = v.id.clone();
            c.approved_version_id = v.id.clone();
            c.versions.push(v);
            p.chapters.push(c);
        }
    }
    if p.chapters.is_empty() {
        return Err(AppError::new(
            "EMPTY_CONTENT",
            "文档只有标题，没有可阅读正文。",
        ));
    }
    p.reader.chapter_id = p.chapters.first().map(|c| c.id.clone()).unwrap_or_default();
    p.validate()?;
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn chapter_detection_and_long_text_preserve_content() {
        let body = "古老的庭院。".repeat(5000);
        let text = format!("第1章 归来\n{body}\n第二章 灯火\n她推开门。\n");
        let p = document_project("书", "txt", &text).unwrap();
        assert_eq!(p.genre, "阅读");
        assert!(p.chapters.len() > 2);
        let restored = p.chapters[..p.chapters.len() - 1]
            .iter()
            .map(|c| c.working.as_str())
            .collect::<String>();
        assert_eq!(restored, format!("{body}\n"));
        assert!(p.chapters.iter().all(Chapter::approved));
    }
    #[test]
    fn markup_is_text_only_and_decodes_entities() {
        let text=markup_text("<html><head><script>danger</script></head><body><p>风 &amp; 雨&#x3002;</p><p>下一页<br/>结尾</p></body></html>").unwrap();
        assert!(text.contains("风 & 雨。"));
        assert!(!text.contains("danger"));
        assert!(text.contains("下一页\n结尾"));
    }
}
