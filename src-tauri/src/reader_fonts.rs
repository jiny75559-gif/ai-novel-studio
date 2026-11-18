use crate::{db::Database, model::*, reading::ReaderState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io::Read, path::Path};

pub const MAX_FONT: usize = 32 * 1024 * 1024;
pub const BUILTIN_FONTS: [&str; 4] = ["NanoOldSong", "SimSun", "Microsoft YaHei", "Georgia"];

pub fn font_id(value: &str) -> Option<String> {
    let value = value.strip_prefix("font:")?;
    let canonical = uuid::Uuid::parse_str(value).ok()?.to_string();
    (canonical == value).then_some(canonical)
}

pub fn valid_family(value: &str, inherit: bool) -> bool {
    BUILTIN_FONTS.contains(&value) || (inherit && value == "inherit") || font_id(value).is_some()
}

pub fn references(reader: &ReaderState) -> BTreeSet<String> {
    [&reader.font_family, &reader.title_style.font_family]
        .into_iter()
        .filter_map(|value| font_id(value))
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReaderFontInfo {
    pub id: String,
    pub family_name: String,
    pub style_name: String,
    pub format: String,
    pub sha256: String,
    pub byte_length: usize,
    pub created_at: u64,
}

#[derive(Clone)]
pub struct ReaderFontAsset {
    pub info: ReaderFontInfo,
    pub bytes: Vec<u8>,
}

impl ReaderFontAsset {
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() > MAX_FONT {
            return Err(AppError::new("TOO_LARGE", "单个字体不能超过 32 MB。"));
        }
        let format = match bytes.get(..4) {
            Some(b"\0\x01\0\0") => "ttf",
            Some(b"OTTO") => "otf",
            _ => {
                return Err(AppError::new(
                    "INVALID_FONT",
                    "请选择有效的 TTF 或 OTF 字体文件。暂不支持字体集合及 WOFF。",
                ))
            }
        };
        let face = ttf_parser::Face::parse(&bytes, 0)
            .map_err(|_| AppError::new("INVALID_FONT", "字体文件损坏或格式不受支持。"))?;
        if face.number_of_glyphs() == 0
            || face.tables().cmap.is_none()
            || (face.tables().glyf.is_none()
                && face.tables().cff.is_none()
                && face.tables().cff2.is_none())
        {
            return Err(AppError::new(
                "INVALID_FONT",
                "这个文件缺少可用的字体轮廓或字符映射。",
            ));
        }
        let name = |ids: &[u16], fallback: &str| {
            for name_id in ids {
                let names: Vec<_> = face
                    .names()
                    .into_iter()
                    .filter(|n| n.name_id == *name_id)
                    .collect();
                for english in [true, false] {
                    for n in &names {
                        if (n.language_id == 0x0409) != english {
                            continue;
                        }
                        if let Some(value) = n.to_string() {
                            let cleaned: String = value
                                .chars()
                                .filter(|c| !c.is_control())
                                .take(120)
                                .collect();
                            if !cleaned.trim().is_empty() {
                                return cleaned.trim().to_string();
                            }
                        }
                    }
                }
            }
            fallback.to_string()
        };
        let family_name = name(&[16, 1, 4], "导入字体");
        let style_name = name(&[17, 2], "Regular");
        Ok(Self {
            info: ReaderFontInfo {
                id: id(),
                family_name,
                style_name,
                format: format.into(),
                sha256: format!("{:x}", Sha256::digest(&bytes)),
                byte_length: bytes.len(),
                created_at: now(),
            },
            bytes,
        })
    }

    pub fn from_path(path: &Path) -> Result<Self> {
        let file = std::fs::File::open(path)?;
        if file.metadata()?.len() > MAX_FONT as u64 {
            return Err(AppError::new("TOO_LARGE", "单个字体不能超过 32 MB。"));
        }
        let mut bytes = Vec::new();
        file.take(MAX_FONT as u64 + 1).read_to_end(&mut bytes)?;
        Self::from_bytes(bytes)
    }

    fn validate(&self) -> Result<()> {
        if uuid::Uuid::parse_str(&self.info.id)
            .map(|id| id.to_string())
            .ok()
            .as_deref()
            != Some(self.info.id.as_str())
        {
            return Err(AppError::new("INVALID_FONT", "字体 ID 无效。"));
        }
        let verified = Self::from_bytes(self.bytes.clone())?;
        if verified.info.sha256 != self.info.sha256
            || verified.info.format != self.info.format
            || verified.info.byte_length != self.info.byte_length
            || verified.info.family_name != self.info.family_name
            || verified.info.style_name != self.info.style_name
        {
            return Err(AppError::new("INVALID_FONT", "字体内容与元数据不一致。"));
        }
        Ok(())
    }
}

impl Database {
    pub fn reader_fonts(&self) -> Result<Vec<ReaderFontInfo>> {
        let conn = self.lock()?;
        let mut query = conn.prepare("SELECT data FROM reader_fonts ORDER BY rowid")?;
        let rows = query.query_map([], |row| row.get::<_, String>(0))?;
        rows.map(|row| Ok(serde_json::from_str(&row?)?)).collect()
    }

    pub fn import_reader_font(&self, asset: ReaderFontAsset) -> Result<ReaderFontInfo> {
        asset.validate()?;
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let existing: Option<(String, String, Vec<u8>)> = tx
            .query_row(
                "SELECT id,data,bytes FROM reader_fonts WHERE sha256=? ORDER BY rowid LIMIT 1",
                [&asset.info.sha256],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let info = if let Some((existing_id, data, bytes)) = existing {
            if uuid::Uuid::parse_str(&existing_id)
                .map(|id| id.to_string())
                .ok()
                .as_deref()
                != Some(existing_id.as_str())
            {
                return Err(AppError::new("INVALID_FONT", "保存的字体 ID 已损坏。"));
            }
            let old: Option<ReaderFontInfo> = serde_json::from_str(&data).ok();
            let mut info = asset.info.clone();
            info.id = existing_id;
            if let Some(previous) = old
                .as_ref()
                .filter(|old| old.id == info.id && old.sha256 == info.sha256)
            {
                info.created_at = previous.created_at;
            }
            // Reimporting identical source bytes repairs damaged storage without breaking references.
            if bytes != asset.bytes || old.as_ref() != Some(&info) {
                tx.execute(
                    "UPDATE reader_fonts SET data=?,bytes=? WHERE id=?",
                    params![serde_json::to_string(&info)?, asset.bytes, info.id],
                )?;
            }
            info
        } else {
            Self::store_reader_font_conn(&tx, &asset)?;
            asset.info
        };
        tx.commit()?;
        Ok(info)
    }

    pub fn reader_font(&self, id: &str) -> Result<ReaderFontAsset> {
        let id = uuid::Uuid::parse_str(id)
            .map_err(|_| AppError::new("VALIDATION", "字体 ID 无效。"))?
            .to_string();
        let conn = self.lock()?;
        let row: Option<(String, Vec<u8>)> = conn
            .query_row(
                "SELECT data,bytes FROM reader_fonts WHERE id=?",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (data, bytes) = row.ok_or_else(|| {
            AppError::new("FONT_NOT_FOUND", "字体不存在，请重新导入字体或完整备份。")
        })?;
        let info: ReaderFontInfo = serde_json::from_str(&data)?;
        if info.id != id
            || info.byte_length != bytes.len()
            || info.sha256 != format!("{:x}", Sha256::digest(&bytes))
        {
            return Err(AppError::new(
                "INVALID_FONT",
                "保存的字体已损坏，请重新导入。",
            ));
        }
        Ok(ReaderFontAsset { info, bytes })
    }

    pub(crate) fn store_reader_font_conn(conn: &Connection, asset: &ReaderFontAsset) -> Result<()> {
        asset.validate()?;
        let existing: Option<(String, Vec<u8>)> = conn
            .query_row(
                "SELECT sha256,bytes FROM reader_fonts WHERE id=?",
                [&asset.info.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((hash, bytes)) = existing {
            if hash != asset.info.sha256 || bytes != asset.bytes {
                return Err(AppError::new(
                    "FONT_CONFLICT",
                    "备份字体与本机同 ID 字体不一致，未覆盖现有字体。",
                ));
            }
            return Ok(());
        }
        conn.execute(
            "INSERT INTO reader_fonts(id,sha256,data,bytes) VALUES(?,?,?,?)",
            params![
                asset.info.id,
                asset.info.sha256,
                serde_json::to_string(&asset.info)?,
                asset.bytes
            ],
        )?;
        Ok(())
    }

    pub(crate) fn validate_reader_fonts_conn(
        conn: &Connection,
        reader: &ReaderState,
    ) -> Result<()> {
        for id in references(reader) {
            let exists: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM reader_fonts WHERE id=?)",
                [&id],
                |r| r.get(0),
            )?;
            if !exists {
                return Err(AppError::new(
                    "FONT_NOT_FOUND",
                    "作品使用的字体缺失，请先导入字体或完整备份。",
                ));
            }
        }
        Ok(())
    }

    pub fn delete_reader_font(&self, id: &str) -> Result<()> {
        let id = uuid::Uuid::parse_str(id)
            .map_err(|_| AppError::new("VALIDATION", "字体 ID 无效。"))?
            .to_string();
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        {
            let mut query = tx.prepare("SELECT p.title,p.deleted,COALESCE(r.data,json_extract(p.data,'$.reader')) FROM projects p LEFT JOIN reader_state r ON r.project_id=p.id")?;
            let rows = query.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, bool>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?;
            for row in rows {
                let (title, deleted, data) = row?;
                let reader: ReaderState = serde_json::from_str(&data)?;
                if references(&reader).contains(&id) {
                    let place = if deleted {
                        "回收站中的作品"
                    } else {
                        "作品"
                    };
                    return Err(AppError::new(
                        "FONT_IN_USE",
                        &format!(
                            "{place}“{title}”仍在使用此字体。请先更换正文和标题字体后再删除。"
                        ),
                    ));
                }
            }
        }
        tx.execute("DELETE FROM reader_fonts WHERE id=?", [&id])?;
        tx.commit()?;
        Ok(())
    }
}
