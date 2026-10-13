use crate::model::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PdfRect {
    pub page: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ReadingMark {
    pub id: String,
    pub chapter_id: String,
    pub start: usize,
    pub end: usize,
    pub quote: String,
    pub color: String,
    pub note: String,
    pub pdf_rects: Vec<PdfRect>,
}
impl Default for ReadingMark {
    fn default() -> Self {
        Self {
            id: id(),
            chapter_id: String::new(),
            start: 0,
            end: 0,
            quote: String::new(),
            color: "yellow".into(),
            note: String::new(),
            pdf_rects: vec![],
        }
    }
}
pub fn current_quote(p: &Project, m: &ReadingMark) -> bool {
    p.chapter(&m.chapter_id).is_ok_and(|c| {
        let text: Vec<u16> = c.working.encode_utf16().collect();
        text.get(m.start..m.end)
            .is_some_and(|s| String::from_utf16(s).is_ok_and(|t| t == m.quote))
    })
}
fn shape(p: &Project, m: &ReadingMark) -> Result<()> {
    if uuid::Uuid::parse_str(&m.id).is_err()
        || !["yellow", "green", "blue", "pink"].contains(&m.color.as_str())
        || m.note.chars().count() > 20000
    {
        return Err(AppError::new("VALIDATION", "批注编号、颜色或长度无效。"));
    }
    if p.pdf_book.is_some() {
        if !m.chapter_id.is_empty()
            || m.pdf_rects.is_empty()
            || m.pdf_rects.len() > 500
            || m.pdf_rects.iter().any(|r| {
                r.page == 0
                    || r.page > 1_000_000
                    || ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
                    || r.x < 0.0
                    || r.y < 0.0
                    || r.width <= 0.0
                    || r.height <= 0.0
                    || r.x + r.width > 1.001
                    || r.y + r.height > 1.001
            })
        {
            return Err(AppError::new("VALIDATION", "PDF 高亮位置无效。"));
        }
    } else if p.chapter(&m.chapter_id).is_err()
        || m.start >= m.end
        || m.quote.trim().is_empty()
        || !m.pdf_rects.is_empty()
    {
        return Err(AppError::new(
            "VALIDATION",
            "文字批注需要章节和选中的原文。",
        ));
    }
    Ok(())
}
pub fn validate(p: &Project) -> Result<()> {
    let mut ids = std::collections::HashSet::new();
    for m in &p.reading_marks {
        shape(p, m)?;
        if !ids.insert(&m.id) {
            return Err(AppError::new("VALIDATION", "阅读批注编号重复。"));
        }
    }
    Ok(())
}
pub fn upsert(p: &mut Project, mark: ReadingMark) -> Result<()> {
    shape(p, &mark)?;
    let old = p.reading_marks.iter().position(|m| m.id == mark.id);
    let anchors_unchanged = old.is_some_and(|i| {
        let m = &p.reading_marks[i];
        m.chapter_id == mark.chapter_id
            && m.start == mark.start
            && m.end == mark.end
            && m.quote == mark.quote
            && m.pdf_rects == mark.pdf_rects
    });
    if p.pdf_book.is_none() && !anchors_unchanged && !current_quote(p, &mark) {
        return Err(AppError::new(
            "SOURCE_CHANGED",
            "选中的原文已改变，请重新选择后添加批注。",
        ));
    }
    if let Some(i) = old {
        p.reading_marks[i] = mark;
    } else {
        p.reading_marks.push(mark);
    }
    Ok(())
}
pub fn export_notes(p: &Project) -> String {
    let mut text = format!("# {} · 阅读批注\n\n", p.title);
    for m in &p.reading_marks {
        let location = if p.pdf_book.is_some() {
            format!(
                "PDF 第 {} 页",
                m.pdf_rects.first().map(|r| r.page).unwrap_or(1)
            )
        } else {
            p.chapter(&m.chapter_id)
                .map(|c| c.title.clone())
                .unwrap_or_default()
        };
        text.push_str(&format!(
            "## {location}\n\n{}\n\n",
            m.quote
                .lines()
                .map(|l| format!("> {l}"))
                .collect::<Vec<_>>()
                .join("\n")
        ));
        if p.pdf_book.is_none() && !current_quote(p, m) {
            text.push_str("原文已修改，请重新核对位置。\n\n");
        }
        if !m.note.is_empty() {
            text.push_str(&m.note);
            text.push_str("\n\n");
        }
    }
    text
}
