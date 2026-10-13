use crate::{db::Database, model::*};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

const MAX_PACKAGE: u64 = 200 * 1024 * 1024;
const MAX_REFERENCE: usize = 20 * 1024 * 1024;

pub fn export_package(db: &Database, pid: &str, path: &Path) -> Result<()> {
    let mut p = db.load(pid)?;
    p.settings.writer_id.clear();
    p.settings.reviewer_id.clear();
    p.settings.auto_next = false;
    p.settings.auto_review = false;
    p.visual_settings.provider_id.clear();
    let project_json = serde_json::to_string_pretty(&p)?;
    let mut total = project_json.len() as u64 + 1024;
    for c in &p.chapters {
        total += c.working.len() as u64 + c.title.len() as u64 + 128;
    }
    for id in crate::visual::referenced_media(&p) {
        total += db.media(&id)?.bytes.len() as u64;
    }
    if total > MAX_PACKAGE - 1024 * 1024 {
        return Err(AppError::new(
            "TOO_LARGE",
            "完整备份内容超过 200 MB；请先单独导出图片。",
        ));
    }
    let file = std::fs::File::create(path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut entry = |name: &str, text: &str| -> Result<()> {
        zip.start_file(name, options)
            .map_err(|_| AppError::new("EXPORT_ERROR", "无法写入项目包。"))?;
        zip.write_all(text.as_bytes())?;
        Ok(())
    };
    entry("manifest.json",&json!({"schemaVersion":2,"application":"AI Novel Studio","exportedAt":now(),"containsKeys":false}).to_string())?;
    entry("project.json", &project_json)?;
    for (index, c) in p.chapters.iter().enumerate() {
        entry(
            &format!("chapters/{:04}.md", index + 1),
            &format!("# 第{}章 {}\n\n{}", index + 1, c.title, c.working),
        )?;
    }
    for id in crate::visual::referenced_media(&p) {
        let m = db.media(&id)?;
        zip.start_file(format!("media/{id}"), options)
            .map_err(|_| AppError::new("EXPORT_ERROR", "无法写入图片。"))?;
        zip.write_all(&m.bytes)?;
    }
    zip.finish()
        .map_err(|_| AppError::new("EXPORT_ERROR", "项目包写入失败。"))?;
    Ok(())
}
pub fn valid_zip_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('/')
        && !name.starts_with('\\')
        && !name.contains('\\')
        && !name.contains(':')
        && name.split('/').all(|part| part != ".." && part != ".")
}
pub fn read_package(path: &Path) -> Result<Project> {
    if std::fs::metadata(path)?.len() > MAX_PACKAGE {
        return Err(AppError::new("TOO_LARGE", "项目包超过 200 MB。"));
    }
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|_| AppError::new("INVALID_PACKAGE", "这不是有效的 ZIP 项目包。"))?;
    if archive.len() > 20000 {
        return Err(AppError::new("INVALID_PACKAGE", "项目包文件数量过多。"));
    }
    let mut total = 0;
    let mut names = std::collections::HashSet::new();
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|_| AppError::new("INVALID_PACKAGE", "无法读取项目包。"))?;
        if !valid_zip_name(file.name())
            || !names.insert(file.name().to_string())
            || file.is_symlink()
        {
            return Err(AppError::new(
                "INVALID_PACKAGE",
                "项目包含重复、不安全路径或符号链接。",
            ));
        }
        total += file.size();
        if total > MAX_PACKAGE {
            return Err(AppError::new("TOO_LARGE", "项目包解压内容超过 200 MB。"));
        }
    }
    let read = |archive: &mut ZipArchive<std::fs::File>, name: &str| -> Result<String> {
        let file = archive
            .by_name(name)
            .map_err(|_| AppError::new("INVALID_PACKAGE", "项目包缺少必要文件。"))?;
        let mut buf = vec![];
        file.take(MAX_PACKAGE + 1).read_to_end(&mut buf)?;
        if buf.len() as u64 > MAX_PACKAGE {
            return Err(AppError::new("TOO_LARGE", "项目包内容超限。"));
        }
        String::from_utf8(buf).map_err(|_| AppError::new("INVALID_PACKAGE", "项目包文本编码错误。"))
    };
    let manifest: Value = serde_json::from_str(&read(&mut archive, "manifest.json")?)?;
    if (manifest["schemaVersion"] != 1 && manifest["schemaVersion"] != 2)
        || manifest["application"] != "AI Novel Studio"
    {
        return Err(AppError::new(
            "INVALID_PACKAGE",
            "项目包版本或格式不受支持。",
        ));
    }
    let p: Project = serde_json::from_str(&read(&mut archive, "project.json")?)?;
    p.validate()?;
    validate_references(&p)?;
    remap_project(p)
}
fn validate_references(p: &Project) -> Result<()> {
    let mut version_ids = std::collections::HashSet::new();
    for c in &p.chapters {
        let mut numbers = std::collections::HashSet::new();
        for v in &c.versions {
            if v.chapter_id != c.id
                || !version_ids.insert(v.id.clone())
                || !numbers.insert(v.number)
                || v.number == 0
                || v.content.trim().is_empty()
            {
                return Err(AppError::new("INVALID_PACKAGE", "正文版本关联无效。"));
            }
        }
        for pointer in [&c.current_version_id, &c.approved_version_id] {
            if !pointer.is_empty() && !c.versions.iter().any(|v| &v.id == pointer) {
                return Err(AppError::new("INVALID_PACKAGE", "章节版本指针无效。"));
            }
        }
    }
    for r in &p.reports {
        if !version_ids.contains(&r.chapter_version_id) {
            return Err(AppError::new("INVALID_PACKAGE", "审稿来源版本不存在。"));
        }
    }
    for x in &p.proposals {
        if !version_ids.contains(&x.source_version_id)
            || !["pending", "accepted", "rejected"].contains(&x.status.as_str())
        {
            return Err(AppError::new("INVALID_PACKAGE", "记忆候选来源/状态无效。"));
        }
    }
    Ok(())
}
pub fn read_package_media(path: &Path, p: &Project) -> Result<Vec<crate::visual::Media>> {
    let mut zip = ZipArchive::new(std::fs::File::open(path)?)
        .map_err(|_| AppError::new("INVALID_PACKAGE", "无法打开项目包。"))?;
    let mut assets = vec![];
    for id in crate::visual::referenced_media(p) {
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err(AppError::new("INVALID_PACKAGE", "图片 ID 无效。"));
        }
        let file = zip
            .by_name(&format!("media/{id}"))
            .map_err(|_| AppError::new("INVALID_PACKAGE", "备份缺少人物参考图或章节插图。"))?;
        let mut bytes = vec![];
        let pdf = p.pdf_book.as_ref().is_some_and(|b| b.document_id == id);
        let limit = if pdf {
            crate::reading::MAX_PDF
        } else {
            20 * 1024 * 1024
        };
        file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
        let mut m = if pdf {
            crate::visual::Media::from_pdf_bytes(bytes)?
        } else {
            crate::visual::Media::from_book_image_bytes(bytes)?
        };
        m.id = id;
        assets.push(m);
    }
    Ok(assets)
}
pub fn remap_project(mut p: Project) -> Result<Project> {
    let mut map = HashMap::new();
    map.insert(p.id.clone(), id());
    for m in &p.reading_marks {
        map.insert(m.id.clone(), id());
    }
    for b in &p.reader.bookmarks {
        map.insert(b.id.clone(), id());
    }
    for c in &p.visual_changes {
        map.insert(c.id.clone(), id());
    }
    for a in &p.artwork {
        map.insert(a.id.clone(), id());
    }
    for c in &p.chapters {
        map.insert(c.id.clone(), id());
        for v in &c.versions {
            map.insert(v.id.clone(), id());
        }
    }
    for c in &p.characters {
        map.insert(c.id.clone(), id());
    }
    for r in &p.relations {
        map.insert(r.id.clone(), id());
    }
    for f in &p.facts {
        map.insert(f.id.clone(), id());
    }
    for x in &p.proposals {
        map.insert(x.id.clone(), id());
        map.insert(x.fact.id.clone(), id());
    }
    for r in &p.reports {
        map.insert(r.id.clone(), id());
        for i in &r.issues {
            map.insert(i.issue_id.clone(), id());
        }
    }
    fn rewrite(v: &mut Value, map: &HashMap<String, String>) {
        match v {
            Value::String(s) => {
                if let Some(n) = map.get(s) {
                    *s = n.clone();
                } else if let Some((prefix, key)) = s.split_once(':') {
                    if [
                        "chapter",
                        "fact",
                        "character",
                        "relation",
                        "outline",
                        "project",
                        "summary",
                        "style",
                    ]
                    .contains(&prefix)
                    {
                        if let Some(n) = map.get(key) {
                            *s = format!("{prefix}:{n}");
                        }
                    }
                }
            }
            Value::Array(a) => {
                for v in a {
                    rewrite(v, map)
                }
            }
            Value::Object(o) => {
                for v in o.values_mut() {
                    rewrite(v, map)
                }
            }
            _ => {}
        }
    }
    let mut value = serde_json::to_value(&p)?;
    rewrite(&mut value, &map);
    p = serde_json::from_value(value)?;
    p.title = format!("{}（导入）", p.title.chars().take(100).collect::<String>());
    p.revision = 0;
    p.created_at = now();
    p.updated_at = now();
    p.settings.writer_id.clear();
    p.settings.reviewer_id.clear();
    p.settings.auto_next = false;
    p.settings.auto_review = false;
    p.visual_settings.provider_id.clear();
    Ok(p)
}

pub fn export_text(db: &Database, pid: &str, path: &Path) -> Result<()> {
    let p = db.load(pid)?;
    let text = std::iter::once(p.title)
        .chain(
            p.chapters
                .iter()
                .enumerate()
                .map(|(i, c)| format!("\n第{}章 {}\n\n{}\n", i + 1, c.title, c.working)),
        )
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(path, text)?;
    Ok(())
}
pub fn decode_reference(bytes: &[u8], encoding: &str) -> Result<String> {
    if bytes.len() > MAX_REFERENCE {
        return Err(AppError::new("TOO_LARGE", "参考 TXT 超过 20 MB。"));
    }
    if bytes.contains(&0) {
        return Err(AppError::new(
            "INVALID_ENCODING",
            "该文件看起来不是纯文本。",
        ));
    }
    let text = match encoding {
        "utf8" => std::str::from_utf8(bytes)
            .map_err(|_| {
                AppError::new(
                    "INVALID_ENCODING",
                    "UTF-8 解码失败。若原文件是中文旧编码，请选择 GB18030 重新导入。",
                )
            })?
            .trim_start_matches('\u{feff}')
            .to_string(),
        "gb18030" => {
            let (text, _, errors) = encoding_rs::GB18030.decode(bytes);
            if errors {
                return Err(AppError::new(
                    "INVALID_ENCODING",
                    "GB18030 解码失败，请转换为 UTF-8 TXT。",
                ));
            }
            text.to_string()
        }
        _ => return Err(AppError::new("INVALID_ENCODING", "不支持该编码。")),
    };
    if text.trim().is_empty() {
        return Err(AppError::new("EMPTY_CONTENT", "参考文本为空。"));
    }
    Ok(text)
}
pub fn sample_reference(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= 5400 {
        return text.into();
    }
    [0, chars.len() / 2 - 900, chars.len() - 1800]
        .iter()
        .map(|start| chars[*start..*start + 1800].iter().collect::<String>())
        .enumerate()
        .map(|(i, s)| format!("[样本 {}]\n{}", i + 1, s))
        .collect::<Vec<_>>()
        .join("\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zip_roundtrip_without_model_credentials() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        let mut original = fixture();
        original.settings.writer_id = "secret-provider-id".into();
        let p = db.create(original).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("backup.zip");
        export_package(&db, &p.id, &path).unwrap();
        let imported = read_package(&path).unwrap();
        assert_ne!(imported.id, p.id);
        assert_eq!(imported.characters.len(), 2);
        assert!(imported.settings.writer_id.is_empty());
        assert_ne!(imported.characters[0].id, p.characters[0].id);
        assert_eq!(imported.relations[0].from_id, imported.characters[0].id);
    }
    #[test]
    fn invalid_reference_and_zip_slip() {
        for name in ["../x", "/root/x", "C:/x", "a\\..\\x", "a/../x"] {
            assert!(!valid_zip_name(name));
        }
        assert!(decode_reference(&vec![0; MAX_REFERENCE + 1], "utf8").is_err());
        assert!(decode_reference(&[0xff, 0xfe], "utf8").is_err());
        assert!(sample_reference(&"甲".repeat(20000)).chars().count() < 5500);
    }
}
