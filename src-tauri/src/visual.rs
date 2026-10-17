use crate::{db::Database, engine::AppState, model::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

const MAX_IMAGE: usize = 20 * 1024 * 1024;
const MAX_RESPONSE: usize = 32 * 1024 * 1024;
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct VisualSettings {
    pub provider_id: String,
    pub style: String,
    pub negative_prompt: String,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct VisualProfile {
    pub character_id: String,
    pub appearance: String,
    pub reference_image_id: String,
    pub revision: u32,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct VisualChange {
    pub id: String,
    pub character_id: String,
    pub source_chapter_id: String,
    pub excerpt: String,
    pub description: String,
    pub start_order: usize,
    pub end_order: Option<usize>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Artwork {
    pub id: String,
    pub image_id: String,
    pub chapter_id: String,
    pub character_ids: Vec<String>,
    pub kind: String,
    pub approved: bool,
    pub created_at: u64,
    pub source_hash: String,
    pub prompt: String,
    pub profile_revisions: Value,
}
pub fn validate_project(p: &Project) -> Result<()> {
    let valid_char = |cid: &str| p.characters.iter().any(|c| c.id == cid);
    let mut seen = HashSet::new();
    for v in &p.visual_profiles {
        if !valid_char(&v.character_id) || !seen.insert(&v.character_id) {
            return Err(AppError::new("VALIDATION", "人物形象关联无效或重复。"));
        }
    }
    seen.clear();
    for v in &p.visual_changes {
        if v.id.is_empty()
            || !seen.insert(&v.id)
            || !valid_char(&v.character_id)
            || p.chapter(&v.source_chapter_id).is_err()
            || v.start_order == 0
            || v.end_order.is_some_and(|n| n < v.start_order)
            || v.excerpt.trim().is_empty()
            || v.description.trim().is_empty()
        {
            return Err(AppError::new(
                "VALIDATION",
                "形象变化需要人物、原文依据和有效的章节范围。",
            ));
        }
    }
    seen.clear();
    for a in &p.artwork {
        if a.id.is_empty()
            || !seen.insert(&a.id)
            || !uuid_valid(&a.image_id)
            || p.chapter(&a.chapter_id).is_err()
            || !["portrait", "chapter"].contains(&a.kind.as_str())
            || a.character_ids.iter().any(|cid| !valid_char(cid))
        {
            return Err(AppError::new("VALIDATION", "插图关联无效。"));
        }
    }
    Ok(())
}
fn uuid_valid(s: &str) -> bool {
    uuid::Uuid::parse_str(s).is_ok()
}
pub fn set_profile(p: &mut Project, mut v: VisualProfile) -> Result<()> {
    if !p
        .characters
        .iter()
        .any(|c| c.id == v.character_id && !c.deleted)
    {
        return Err(AppError::new("VALIDATION", "请先选择人物。"));
    }
    v.revision = p
        .visual_profiles
        .iter()
        .find(|x| x.character_id == v.character_id)
        .map_or(1, |x| x.revision + 1);
    if let Some(old) = p
        .visual_profiles
        .iter_mut()
        .find(|x| x.character_id == v.character_id)
    {
        *old = v;
    } else {
        p.visual_profiles.push(v);
    }
    Ok(())
}
pub fn set_change(p: &mut Project, mut v: VisualChange) -> Result<()> {
    if v.id.is_empty() {
        v.id = id();
    }
    if !p
        .chapter(&v.source_chapter_id)?
        .working
        .contains(&v.excerpt)
        || v.excerpt.trim().is_empty()
    {
        return Err(AppError::new(
            "VALIDATION",
            "变化依据必须是来源章节中存在的原文。",
        ));
    }
    if let Some(old) = p.visual_changes.iter_mut().find(|x| x.id == v.id) {
        *old = v;
    } else {
        p.visual_changes.push(v);
    }
    validate_project(p)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct ImageConfig {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub base_url: String,
    pub allow_local_http: bool,
    pub model_id: String,
    pub size: String,
    pub supports_edits: bool,
    pub image_field: String,
    pub timeout_seconds: u64,
    pub has_key: bool,
    pub key_storage: String,
    pub workflow: Value,
    pub positive_node: String,
    pub negative_node: String,
    pub reference_nodes: Vec<String>,
    pub output_node: String,
    pub seed_node: String,
    pub seed: i64,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub cfg: f64,
    pub denoising: f64,
}
impl Default for ImageConfig {
    fn default() -> Self {
        Self {
            id: id(),
            name: "本地 ComfyUI".into(),
            mode: "comfyui".into(),
            base_url: "http://127.0.0.1:8188".into(),
            allow_local_http: true,
            model_id: String::new(),
            size: "1024x1024".into(),
            supports_edits: true,
            image_field: "image[]".into(),
            timeout_seconds: 600,
            has_key: false,
            key_storage: "none".into(),
            workflow: json!({}),
            positive_node: "6".into(),
            negative_node: "7".into(),
            reference_nodes: vec![],
            output_node: "9".into(),
            seed_node: "3".into(),
            seed: -1,
            width: 768,
            height: 1024,
            steps: 24,
            cfg: 7.0,
            denoising: 0.5,
        }
    }
}
fn base_url(c: &ImageConfig) -> Result<url::Url> {
    let u = url::Url::parse(c.base_url.trim())
        .map_err(|_| AppError::new("INVALID_URL", "请输入完整生图服务地址。"))?;
    let local = matches!(
        u.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if u.scheme() != "https" && !(u.scheme() == "http" && local && c.allow_local_http) {
        return Err(AppError::new(
            "INSECURE_URL",
            "使用 HTTPS，或勾选允许本机 HTTP 地址。",
        ));
    }
    if !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || u.host_str().is_none()
    {
        return Err(AppError::new(
            "INVALID_URL",
            "地址不能包含密码、查询参数或片段。",
        ));
    }
    Ok(u)
}
fn endpoint(c: &ImageConfig, path: &str) -> Result<url::Url> {
    let mut u = base_url(c)?;
    let prefix = u.path().trim_end_matches('/').to_owned();
    u.set_path(&format!("{prefix}/{path}"));
    Ok(u)
}
pub fn validate_config(c: &ImageConfig) -> Result<()> {
    base_url(c)?;
    if !uuid_valid(&c.id)
        || c.name.trim().is_empty()
        || !["cloud", "comfyui", "webui"].contains(&c.mode.as_str())
        || !(30..=1800).contains(&c.timeout_seconds)
        || !(256..=2048).contains(&c.width)
        || !(256..=2048).contains(&c.height)
        || !(1..=150).contains(&c.steps)
        || !(0.0..=30.0).contains(&c.cfg)
        || !(0.0..=1.0).contains(&c.denoising)
    {
        return Err(AppError::new(
            "VALIDATION",
            "检查生图名称、类型、尺寸、采样参数与超时。",
        ));
    }
    if c.mode == "cloud"
        && (c.model_id.trim().is_empty()
            || !["image", "image[]"].contains(&c.image_field.as_str())
            || c.size.trim().is_empty())
    {
        return Err(AppError::new(
            "VALIDATION",
            "云端接口需要模型 ID、尺寸和参考图字段。",
        ));
    }
    if c.mode == "comfyui" {
        validate_workflow(c)?;
    }
    Ok(())
}
fn reachable(w: &Value, root: &str, target: &str, visited: &mut HashSet<String>) -> bool {
    if root == target {
        return true;
    }
    if !visited.insert(root.into()) {
        return false;
    }
    w[root]["inputs"].as_object().is_some_and(|i| {
        i.values().any(|v| {
            v.as_array().is_some_and(|a| {
                a.len() == 2
                    && a[0]
                        .as_str()
                        .is_some_and(|n| reachable(w, n, target, visited))
            })
        })
    })
}
pub fn validate_workflow(c: &ImageConfig) -> Result<()> {
    let w = &c.workflow;
    if !w.as_object().is_some_and(|o| {
        !o.is_empty()
            && o.values()
                .all(|n| n["class_type"].is_string() && n["inputs"].is_object())
    }) {
        return Err(AppError::new(
            "WORKFLOW",
            "请导入 ComfyUI 的 API 格式 JSON 工作流（不是画布格式）。",
        ));
    }
    if !w[&c.positive_node]["inputs"]["text"].is_string()
        || w[&c.output_node]["class_type"] != "SaveImage"
        || !reachable(w, &c.output_node, &c.positive_node, &mut HashSet::new())
    {
        return Err(AppError::new(
            "WORKFLOW",
            "正面提示词节点必须连接到指定的 SaveImage 输出节点。",
        ));
    }
    if !c.negative_node.is_empty() && !w[&c.negative_node]["inputs"]["text"].is_string() {
        return Err(AppError::new("WORKFLOW", "负面提示词节点缺少 text 输入。"));
    }
    let mut ids = HashSet::new();
    for n in &c.reference_nodes {
        if !ids.insert(n)
            || w[n]["class_type"] != "LoadImage"
            || !reachable(w, &c.output_node, n, &mut HashSet::new())
        {
            return Err(AppError::new(
                "WORKFLOW",
                "参考图节点需要是连接到输出的 LoadImage，且不能重复。",
            ));
        }
    }
    if !c.seed_node.is_empty()
        && !w[&c.seed_node]["inputs"]["seed"].is_number()
        && !w[&c.seed_node]["inputs"]["noise_seed"].is_number()
    {
        return Err(AppError::new(
            "WORKFLOW",
            "种子节点需要 seed 或 noise_seed 输入。",
        ));
    }
    Ok(())
}
#[derive(Clone)]
pub struct Media {
    pub id: String,
    pub mime: String,
    pub sha256: String,
    pub bytes: Vec<u8>,
}
impl Media {
    pub fn from_book_image_bytes(bytes: Vec<u8>) -> Result<Self> {
        if bytes.len() <= MAX_IMAGE {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                let lower = text.to_ascii_lowercase();
                if lower.contains("<svg")
                    && ![
                        "<script",
                        "<foreignobject",
                        "javascript:",
                        "<!entity",
                        " onload=",
                        " onerror=",
                    ]
                    .iter()
                    .any(|s| lower.contains(s))
                {
                    use sha2::{Digest, Sha256};
                    return Ok(Self {
                        id: id(),
                        mime: "image/svg+xml".into(),
                        sha256: format!("{:x}", Sha256::digest(&bytes)),
                        bytes,
                    });
                }
            }
        }
        Self::from_bytes(bytes)
    }
    pub fn from_pdf_bytes(bytes: Vec<u8>) -> Result<Self> {
        if bytes.is_empty()
            || bytes.len() > crate::reading::MAX_PDF
            || !bytes[..bytes.len().min(1024)]
                .windows(5)
                .any(|w| w == b"%PDF-")
        {
            return Err(AppError::new(
                "INVALID_DOCUMENT",
                "这不是 PDF 文件，或文件超过 100 MB。",
            ));
        }
        use sha2::{Digest, Sha256};
        Ok(Self {
            id: id(),
            mime: "application/pdf".into(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
        })
    }
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Self> {
        if bytes.is_empty() || bytes.len() > MAX_IMAGE {
            return Err(AppError::new("INVALID_IMAGE", "图片为空或超过 20 MB。"));
        }
        let format = image::guess_format(&bytes)
            .map_err(|_| AppError::new("INVALID_IMAGE", "图片格式不受支持。"))?;
        let mime = match format {
            image::ImageFormat::Png => "image/png",
            image::ImageFormat::Jpeg => "image/jpeg",
            image::ImageFormat::WebP => "image/webp",
            image::ImageFormat::Gif => "image/gif",
            _ => {
                return Err(AppError::new(
                    "INVALID_IMAGE",
                    "使用 PNG、JPEG 或 WebP 图片。",
                ))
            }
        };
        let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
        let (w, h) = reader
            .into_dimensions()
            .map_err(|_| AppError::new("INVALID_IMAGE", "图片头无效。"))?;
        if w == 0 || h == 0 || w > 12000 || h > 12000 || w as u64 * h as u64 > 80_000_000 {
            return Err(AppError::new("INVALID_IMAGE", "图片分辨率超限。"));
        }
        let mut decoder = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(128 * 1024 * 1024);
        decoder.limits(limits);
        decoder
            .decode()
            .map_err(|_| AppError::new("INVALID_IMAGE", "图片无法解码或解码内存超限。"))?;
        use sha2::{Digest, Sha256};
        Ok(Self {
            id: id(),
            mime: mime.into(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            bytes,
        })
    }
    pub fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.mime, STANDARD.encode(&self.bytes))
    }
    fn filename(&self) -> String {
        format!(
            "{}.{}",
            self.id,
            match self.mime.as_str() {
                "image/jpeg" => "jpg",
                "image/webp" => "webp",
                _ => "png",
            }
        )
    }
}
pub fn referenced_media(p: &Project) -> HashSet<String> {
    p.visual_profiles
        .iter()
        .map(|v| v.reference_image_id.clone())
        .chain(p.artwork.iter().map(|a| a.image_id.clone()))
        .chain(p.pdf_book.iter().map(|b| b.document_id.clone()))
        .chain(std::iter::once(p.cover_image_id.clone()))
        .chain(
            p.book_content
                .iter()
                .flat_map(|c| c.images.iter().map(|i| i.image_id.clone())),
        )
        .filter(|s| !s.is_empty())
        .collect()
}
impl Database {
    pub fn save_pdf_cover(&self, pid: &str, media: &Media) -> Result<()> {
        let mut c = self.lock()?;
        let tx = c.transaction()?;
        let mut p = Self::load_conn(&tx, pid)?;
        if p.pdf_book.is_none() {
            return Err(AppError::new("INVALID_DOCUMENT", "这个作品不是 PDF。"));
        }
        if p.cover_image_id.is_empty() {
            Self::store_media_conn(&tx, media)?;
            p.cover_image_id = media.id.clone();
            Self::persist(&tx, &mut p)?;
        }
        tx.commit()?;
        Ok(())
    }
    pub(crate) fn validate_media_conn(c: &rusqlite::Connection, p: &Project) -> Result<()> {
        for id in referenced_media(p) {
            let mime: Option<String> = c
                .query_row("SELECT mime FROM media WHERE id=?", [&id], |r| r.get(0))
                .optional()?;
            let pdf = p.pdf_book.as_ref().is_some_and(|b| b.document_id == id);
            if !mime.is_some_and(|m| {
                if pdf {
                    m == "application/pdf"
                } else {
                    m.starts_with("image/")
                }
            }) {
                return Err(AppError::new(
                    "NOT_FOUND",
                    "项目关联的图片或 PDF 缺失或格式不匹配，请导入完整备份。",
                ));
            }
        }
        Ok(())
    }
    pub fn image_configs(&self) -> Result<Vec<ImageConfig>> {
        let c = self.lock()?;
        let mut s = c.prepare("SELECT data FROM image_configs ORDER BY rowid")?;
        let rows = s.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn image_config(&self, id: &str) -> Result<ImageConfig> {
        self.image_configs()?
            .into_iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::new("NO_IMAGE_PROVIDER", "请选择并保存生图服务。"))
    }
    pub fn save_image_config(&self, c: &ImageConfig) -> Result<()> {
        validate_config(c)?;
        self.lock()?.execute("INSERT INTO image_configs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![c.id,serde_json::to_string(c)?])?;
        Ok(())
    }
    pub fn delete_image_config(&self, id: &str) -> Result<()> {
        self.lock()?
            .execute("DELETE FROM image_configs WHERE id=?", [id])?;
        Ok(())
    }
    pub fn media(&self, id: &str) -> Result<Media> {
        self.lock()?
            .query_row(
                "SELECT mime,sha256,bytes FROM media WHERE id=?",
                [id],
                |r| {
                    Ok(Media {
                        id: id.into(),
                        mime: r.get(0)?,
                        sha256: r.get(1)?,
                        bytes: r.get(2)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::new("NOT_FOUND", "参考图片不存在。"))
    }
    pub fn store_media_conn(c: &rusqlite::Connection, m: &Media) -> Result<()> {
        let old: Option<String> = c
            .query_row("SELECT sha256 FROM media WHERE id=?", [&m.id], |r| r.get(0))
            .optional()?;
        if old.is_some_and(|h| h != m.sha256) {
            return Err(AppError::new("INVALID_PACKAGE", "图片 ID 与现有内容冲突。"));
        }
        c.execute(
            "INSERT OR IGNORE INTO media VALUES(?,?,?,?)",
            params![m.id, m.mime, m.sha256, m.bytes],
        )?;
        Ok(())
    }
    pub fn store_media(&self, m: &Media) -> Result<()> {
        Self::store_media_conn(&*self.lock()?, m)
    }
    pub fn check_media(&self, p: &Project) -> Result<()> {
        for id in referenced_media(p) {
            self.media(&id)?;
        }
        Ok(())
    }
    pub fn image_jobs(&self, pid: Option<&str>) -> Result<Vec<ImageJob>> {
        let c = self.lock()?;
        let mut s = c.prepare(
            "SELECT data FROM image_jobs WHERE (?1 IS NULL OR project_id=?1) ORDER BY rowid DESC",
        )?;
        let rows = s.query_map([pid], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn image_job(&self, jid: &str) -> Result<ImageJob> {
        let text: String = self
            .lock()?
            .query_row("SELECT data FROM image_jobs WHERE id=?", [jid], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(|| AppError::new("NOT_FOUND", "生图任务不存在。"))?;
        Ok(serde_json::from_str(&text)?)
    }
    pub fn update_image_job(&self, j: &ImageJob) -> Result<()> {
        self.lock()?.execute(
            "UPDATE image_jobs SET status=?,data=? WHERE id=?",
            params![j.status, serde_json::to_string(j)?, j.id],
        )?;
        Ok(())
    }
    fn finish_image(&self, j: &mut ImageJob, m: Media) -> Result<()> {
        let mut c = self.lock()?;
        let tx = c.transaction()?;
        let status: String =
            tx.query_row("SELECT status FROM image_jobs WHERE id=?", [&j.id], |r| {
                r.get(0)
            })?;
        if status != "running" {
            return Err(AppError::new("CANCELLED", "任务已停止。"));
        }
        let mut p = Self::load_conn(&tx, &j.project_id)?;
        Self::store_media_conn(&tx, &m)?;
        let art = Artwork {
            id: id(),
            image_id: m.id,
            chapter_id: j.chapter_id.clone(),
            character_ids: j.character_ids.clone(),
            kind: j.kind.clone(),
            approved: false,
            created_at: now(),
            source_hash: j.source_hash.clone(),
            prompt: j.prompt.clone(),
            profile_revisions: j.profile_revisions.clone(),
        };
        j.result_artwork_id = art.id.clone();
        p.artwork.push(art);
        Self::persist(&tx, &mut p)?;
        j.status = "succeeded".into();
        j.error = None;
        tx.execute(
            "UPDATE image_jobs SET status=?,data=? WHERE id=?",
            params![j.status, serde_json::to_string(j)?, j.id],
        )?;
        tx.commit()?;
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageJob {
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub character_ids: Vec<String>,
    pub kind: String,
    pub status: String,
    pub prompt: String,
    pub negative_prompt: String,
    pub reference_ids: Vec<String>,
    pub config: ImageConfig,
    pub remote_prompt_id: String,
    pub source_hash: String,
    pub profile_revisions: Value,
    pub result_artwork_id: String,
    pub created_at: u64,
    pub error: Option<AppError>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ImageRequest {
    pub id: String,
    pub chapter_id: String,
    pub character_ids: Vec<String>,
    pub kind: String,
    pub scene: String,
}
pub fn prepare_job(state: &AppState, pid: &str, r: ImageRequest) -> Result<ImageJob> {
    let p = state.db.load(pid)?;
    let ch = p.chapter(&r.chapter_id)?;
    let c = state.db.image_config(&p.visual_settings.provider_id)?;
    validate_config(&c)?;
    if !uuid_valid(&r.id)
        || !["portrait", "chapter"].contains(&r.kind.as_str())
        || r.scene.trim().is_empty()
        || r.scene.chars().count() > 24000
        || (r.kind == "portrait" && r.character_ids.len() != 1)
    {
        return Err(AppError::new(
            "VALIDATION",
            "请选择章节与场景；人物定妆图只能选择一人。",
        ));
    }
    let mut refs = vec![];
    let mut identities = vec![];
    let mut revisions = json!({});
    let mut seen = HashSet::new();
    let order = p.chapters.iter().position(|x| x.id == ch.id).unwrap_or(0) + 1;
    for cid in &r.character_ids {
        let character = p
            .characters
            .iter()
            .find(|x| &x.id == cid && !x.deleted)
            .ok_or_else(|| AppError::new("VALIDATION", "出场人物不存在。"))?;
        if !seen.insert(cid) {
            return Err(AppError::new("VALIDATION", "人物不能重复。"));
        }
        let profile = p
            .visual_profiles
            .iter()
            .find(|x| &x.character_id == cid)
            .ok_or_else(|| AppError::new("NO_IDENTITY", "请先保存人物的固定外貌描述。"))?;
        if profile.appearance.trim().is_empty()
            || (r.kind == "chapter" && profile.reference_image_id.is_empty())
        {
            return Err(AppError::new(
                "NO_IDENTITY",
                "有出场人物时，请先确认他们的定妆图与固定外貌。",
            ));
        }
        if !profile.reference_image_id.is_empty() {
            state.db.media(&profile.reference_image_id)?;
            refs.push(profile.reference_image_id.clone());
        }
        revisions[cid] = json!(profile.revision);
        let changes = p
            .visual_changes
            .iter()
            .filter(|v| {
                &v.character_id == cid
                    && v.start_order <= order
                    && v.end_order.is_none_or(|n| order <= n)
                    && p.chapters
                        .iter()
                        .position(|x| x.id == v.source_chapter_id)
                        .is_some_and(|i| i < order)
                    && p.chapter(&v.source_chapter_id)
                        .is_ok_and(|src| src.working.contains(&v.excerpt))
            })
            .map(|v| format!("明确变化：{}（原文：{}）", v.description, v.excerpt))
            .collect::<Vec<_>>()
            .join("\n");
        identities.push(format!(
            "人物 {}（参考图按人物排列）：{}\n{}",
            character.name, profile.appearance, changes
        ));
    }
    if !refs.is_empty()
        && ((c.mode == "cloud"
            && (!c.supports_edits || (c.image_field == "image" && refs.len() > 1)))
            || (c.mode == "comfyui" && c.reference_nodes.len() < refs.len())
            || (c.mode == "webui" && refs.len() > 1))
    {
        return Err(AppError::new("REFERENCE_UNSUPPORTED","此配置无法接收所有人物参考图。云端需要图像编辑支持，ComfyUI 需要足够的参考图节点；WebUI 基础 img2img 只支持一位人物。"));
    }
    let prompt = format!(
        "{}\n{}\n{}\n场景：{}",
        p.visual_settings.style,
        if identities.is_empty() {
            ""
        } else {
            "沿用参考图的人物身份、脸型与五官；仅改变下列明确变化。"
        },
        identities.join("\n"),
        r.scene
    );
    Ok(ImageJob {
        id: r.id,
        project_id: pid.into(),
        chapter_id: ch.id.clone(),
        character_ids: r.character_ids,
        kind: r.kind,
        status: "running".into(),
        prompt,
        negative_prompt: p.visual_settings.negative_prompt.clone(),
        reference_ids: refs,
        config: c,
        remote_prompt_id: String::new(),
        source_hash: hash(&ch.working),
        profile_revisions: revisions,
        result_artwork_id: String::new(),
        created_at: now(),
        error: None,
    })
}
pub fn start_job(state: Arc<AppState>, pid: &str, r: ImageRequest) -> Result<ImageJob> {
    if let Ok(old) = state.db.image_job(&r.id) {
        if old.project_id != pid {
            return Err(AppError::new("CONFLICT", "任务 ID 已存在。"));
        }
        return Ok(old);
    }
    let j = prepare_job(&state, pid, r)?;
    // Lock project and job insertion together; snapshots never overwrite subsequent author edits.
    {
        let mut c = state.db.lock()?;
        let tx = c.transaction()?;
        let previous: Option<String> = tx
            .query_row("SELECT data FROM image_jobs WHERE id=?", [&j.id], |r| {
                r.get(0)
            })
            .optional()?;
        if let Some(text) = previous {
            let old: ImageJob = serde_json::from_str(&text)?;
            if old.project_id != pid {
                return Err(AppError::new("CONFLICT", "任务 ID 已存在。"));
            }
            return Ok(old);
        }
        let busy: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM image_jobs WHERE status='running')",
            [],
            |r| r.get(0),
        )?;
        if busy {
            return Err(AppError::new("BUSY", "已有生图任务运行，请等待或取消。"));
        }
        tx.execute(
            "INSERT INTO image_jobs VALUES(?,?,?,?)",
            params![j.id, j.project_id, j.status, serde_json::to_string(&j)?],
        )?;
        tx.commit()?;
    }
    spawn_job(state, j.clone());
    Ok(j)
}
fn spawn_job(state: Arc<AppState>, j: ImageJob) {
    let cancel = CancellationToken::new();
    if let Ok(mut m) = state.cancellations.lock() {
        m.insert(j.id.clone(), cancel.clone());
    }
    tauri::async_runtime::spawn(async move {
        let mut job = j;
        let timeout = Duration::from_secs(job.config.timeout_seconds);
        let result = tokio::select! { biased; _=cancel.cancelled()=>Err(AppError::new("CANCELLED","已停止等待；本地服务可能仍在生成，可稍后按原任务取回。")), result=tokio::time::timeout(timeout,generate(&state,&mut job))=>result.unwrap_or_else(|_|Err(AppError::new("TIMEOUT","等待生图超时；ComfyUI 可按原任务取回，勿重复提交。"))) };
        match result {
            Ok(media) => {
                if let Err(e) = state.db.finish_image(&mut job, media) {
                    job.error = Some(e);
                    job.status = "failed".into();
                    let _ = state.db.update_image_job(&job);
                }
            }
            Err(e) => {
                job.status = if e.code == "CANCELLED" {
                    "cancelled"
                } else {
                    "failed"
                }
                .into();
                job.error = Some(e);
                let _ = state.db.update_image_job(&job);
            }
        }
        if let Ok(mut m) = state.cancellations.lock() {
            m.remove(&job.id);
        }
    });
}
pub fn cancel_job(state: &AppState, jid: &str) -> Result<()> {
    let j = state.db.image_job(jid)?;
    if j.status == "running" {
        if let Some(t) = state
            .cancellations
            .lock()
            .map_err(|_| AppError::new("BUSY", "任务状态暂不可用。"))?
            .get(jid)
        {
            t.cancel();
        }
    }
    Ok(())
}
pub fn resume_job(state: Arc<AppState>, jid: &str) -> Result<ImageJob> {
    let mut j = state.db.image_job(jid)?;
    if j.config.mode != "comfyui"
        || j.remote_prompt_id.is_empty()
        || j.status == "succeeded"
        || j.status == "running"
    {
        return Err(AppError::new(
            "NO_RECOVERY",
            "仅有 ComfyUI 任务编号的未完成任务可以取回结果。",
        ));
    }
    {
        let mut c = state.db.lock()?;
        let tx = c.transaction()?;
        let busy: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM image_jobs WHERE status='running')",
            [],
            |r| r.get(0),
        )?;
        if busy {
            return Err(AppError::new("BUSY", "已有生图任务运行。"));
        }
        j.status = "running".into();
        j.error = None;
        tx.execute(
            "UPDATE image_jobs SET status=?,data=? WHERE id=?",
            params![j.status, serde_json::to_string(&j)?, j.id],
        )?;
        tx.commit()?;
    }
    spawn_job(state, j.clone());
    Ok(j)
}
fn client(url: &url::Url) -> Result<reqwest::Client> {
    crate::provider::client_builder(url)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(1800))
        .build()
        .map_err(|_| AppError::new("NETWORK", "网络客户端初始化失败。"))
}
fn auth(r: reqwest::RequestBuilder, key: &str) -> reqwest::RequestBuilder {
    if key.is_empty() {
        r
    } else {
        r.bearer_auth(key)
    }
}
async fn response(r: reqwest::RequestBuilder, max: usize) -> Result<Vec<u8>> {
    let mut res = r.send().await.map_err(|e| {
        AppError::new(
            if e.is_timeout() { "TIMEOUT" } else { "NETWORK" },
            "无法连接生图服务；检查地址、服务与超时。",
        )
    })?;
    if !res.status().is_success() {
        let msg = match res.status().as_u16() {
            401 | 403 => "生图服务鉴权失败。",
            429 => "生图服务限流，请稍后重试。",
            _ => "生图服务拒绝请求，请检查模型与工作流配置。",
        };
        return Err(AppError::new("IMAGE_SERVICE", msg));
    }
    if res.content_length().is_some_and(|n| n > max as u64) {
        return Err(AppError::new("TOO_LARGE", "生图服务返回内容过大。"));
    }
    let mut bytes = vec![];
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|_| AppError::new("NETWORK", "图片接收中断。"))?
    {
        if bytes.len() + chunk.len() > max {
            return Err(AppError::new("TOO_LARGE", "图片返回内容过大。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn request_json(r: reqwest::RequestBuilder) -> Result<Value> {
    Ok(serde_json::from_slice(&response(r, MAX_RESPONSE).await?)?)
}
fn b64_image(s: &str) -> Result<Media> {
    let payload = s
        .split_once(",")
        .filter(|_| s.starts_with("data:"))
        .map_or(s, |(_, x)| x);
    Media::from_bytes(
        STANDARD
            .decode(payload)
            .map_err(|_| AppError::new("INVALID_IMAGE", "服务返回的图片编码无效。"))?,
    )
}
async fn generate(state: &AppState, j: &mut ImageJob) -> Result<Media> {
    let c = &j.config;
    let cli = client(&endpoint(c, "")?)?;
    let key = state
        .secrets
        .get(&format!("image:{}", c.id))
        .unwrap_or_default();
    let refs = j
        .reference_ids
        .iter()
        .map(|id| state.db.media(id))
        .collect::<Result<Vec<_>>>()?;
    if c.mode == "cloud" {
        let res = if refs.is_empty() {
            request_json(
                auth(cli.post(endpoint(c, "images/generations")?), &key)
                    .json(&json!({"model":c.model_id,"prompt":j.prompt,"n":1,"size":c.size})),
            )
            .await?
        } else {
            let mut form = reqwest::multipart::Form::new()
                .text("model", c.model_id.clone())
                .text("prompt", j.prompt.clone())
                .text("n", "1")
                .text("size", c.size.clone());
            for m in refs {
                let part = reqwest::multipart::Part::bytes(m.bytes.clone())
                    .file_name(m.filename())
                    .mime_str(&m.mime)
                    .map_err(|_| AppError::new("INVALID_IMAGE", "参考图 MIME 无效。"))?;
                form = form.part(c.image_field.clone(), part);
            }
            request_json(auth(cli.post(endpoint(c, "images/edits")?), &key).multipart(form)).await?
        };
        if let Some(s) = res["data"][0]["b64_json"].as_str() {
            return b64_image(s);
        }
        if let Some(s) = res["data"][0]["url"].as_str() {
            let u =
                url::Url::parse(s).map_err(|_| AppError::new("INVALID_IMAGE", "图片地址无效。"))?;
            let local = matches!(
                u.host_str(),
                Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
            );
            if (u.scheme() != "https" && !(u.scheme() == "http" && local && c.allow_local_http))
                || !u.username().is_empty()
                || u.password().is_some()
            {
                return Err(AppError::new(
                    "INVALID_IMAGE",
                    "图片地址需要 HTTPS 或已允许的本机地址。",
                ));
            }
            return Media::from_bytes(response(client(&u)?.get(u), MAX_IMAGE).await?);
        }
        return Err(AppError::new("INVALID_IMAGE", "生图服务未返回图片。"));
    }
    if c.mode == "webui" {
        let mut payload = json!({"prompt":j.prompt,"negative_prompt":j.negative_prompt,"width":c.width,"height":c.height,"steps":c.steps,"cfg_scale":c.cfg,"seed":c.seed,"batch_size":1,"n_iter":1});
        if !c.model_id.is_empty() {
            payload["override_settings"] = json!({"sd_model_checkpoint":c.model_id});
            payload["override_settings_restore_afterwards"] = json!(true);
        }
        let route = if let Some(m) = refs.first() {
            payload["init_images"] = json!([m.data_url()]);
            payload["denoising_strength"] = json!(c.denoising);
            "sdapi/v1/img2img"
        } else {
            "sdapi/v1/txt2img"
        };
        let res = request_json(auth(cli.post(endpoint(c, route)?), &key).json(&payload)).await?;
        return b64_image(
            res["images"][0]
                .as_str()
                .ok_or_else(|| AppError::new("INVALID_IMAGE", "WebUI 未返回图片。"))?,
        );
    }
    if j.remote_prompt_id.is_empty() {
        let mut w = c.workflow.clone();
        w[&c.positive_node]["inputs"]["text"] = json!(j.prompt);
        if !c.negative_node.is_empty() {
            w[&c.negative_node]["inputs"]["text"] = json!(j.negative_prompt);
        }
        if !c.seed_node.is_empty() {
            let field = if w[&c.seed_node]["inputs"]["seed"].is_number() {
                "seed"
            } else {
                "noise_seed"
            };
            w[&c.seed_node]["inputs"][field] = json!(if c.seed < 0 {
                (now() % i64::MAX as u64) as i64
            } else {
                c.seed
            });
        }
        for (i, m) in refs.into_iter().enumerate() {
            let part = reqwest::multipart::Part::bytes(m.bytes.clone())
                .file_name(m.filename())
                .mime_str(&m.mime)
                .map_err(|_| AppError::new("INVALID_IMAGE", "参考图格式无效。"))?;
            let upload = request_json(
                auth(cli.post(endpoint(c, "upload/image")?), &key).multipart(
                    reqwest::multipart::Form::new()
                        .part("image", part)
                        .text("type", "input")
                        .text("overwrite", "false"),
                ),
            )
            .await?;
            let name = upload["name"]
                .as_str()
                .ok_or_else(|| AppError::new("UPLOAD_FAILED", "ComfyUI 未确认参考图上传。"))?;
            let folder = upload["subfolder"].as_str().unwrap_or("");
            w[&c.reference_nodes[i]]["inputs"]["image"] = json!(if folder.is_empty() {
                name.into()
            } else {
                format!("{folder}/{name}")
            });
        }
        let res = request_json(
            auth(cli.post(endpoint(c, "prompt")?), &key)
                .json(&json!({"prompt":w,"client_id":j.id})),
        )
        .await?;
        j.remote_prompt_id = res["prompt_id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| AppError::new("WORKFLOW", "ComfyUI 未接受工作流。"))?
            .into();
        state.db.update_image_job(j)?;
    }
    loop {
        let mut url = endpoint(c, "history")?;
        url.path_segments_mut()
            .map_err(|_| AppError::new("INVALID_URL", "任务地址无效。"))?
            .push(&j.remote_prompt_id);
        let history = request_json(auth(cli.get(url), &key)).await?;
        let h = &history[&j.remote_prompt_id];
        if h["status"]["status_str"] == "error" {
            return Err(AppError::new(
                "WORKFLOW",
                "ComfyUI 执行失败，请查看本地服务的节点错误。",
            ));
        }
        if let Some(image) = h["outputs"][&c.output_node]["images"][0].as_object() {
            let filename = image
                .get("filename")
                .and_then(Value::as_str)
                .ok_or_else(|| AppError::new("INVALID_IMAGE", "输出文件名缺失。"))?;
            let mut u = endpoint(c, "view")?;
            u.query_pairs_mut()
                .append_pair("filename", filename)
                .append_pair(
                    "subfolder",
                    image.get("subfolder").and_then(Value::as_str).unwrap_or(""),
                )
                .append_pair(
                    "type",
                    image
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("output"),
                );
            return Media::from_bytes(response(auth(cli.get(u), &key), MAX_IMAGE).await?);
        }
        if h["status"]["completed"] == true {
            return Err(AppError::new(
                "INVALID_IMAGE",
                "工作流完成，但指定输出节点没有图片。",
            ));
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
}
pub async fn test_config(state: &AppState, c: &ImageConfig) -> Result<String> {
    validate_config(c)?;
    let route = match c.mode.as_str() {
        "comfyui" => "system_stats",
        "webui" => "sdapi/v1/options",
        _ => "models",
    };
    let key = state
        .secrets
        .get(&format!("image:{}", c.id))
        .unwrap_or_default();
    let url = endpoint(c, route)?;
    let _ = request_json(auth(client(&url)?.get(url), &key)).await?;
    Ok("服务连接成功；未提交生图任务。".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ImageConfig {
        ImageConfig {
            workflow: json!({"6":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"10":{"class_type":"LoadImage","inputs":{"image":"a.png"}},"9":{"class_type":"SaveImage","inputs":{"images":["10",0],"conditioning":["6",0]}}}),
            seed_node: String::new(),
            negative_node: String::new(),
            reference_nodes: vec!["10".into()],
            ..Default::default()
        }
    }
    #[test]
    fn disconnected_reference_is_rejected() {
        let mut c = config();
        validate_workflow(&c).unwrap();
        c.workflow["9"]["inputs"]["images"] = json!(["6", 0]);
        assert!(validate_workflow(&c).is_err());
    }
    #[test]
    fn user_workflow_keeps_custom_nodes() {
        let mut c = config();
        c.workflow["custom"] = json!({"class_type":"IPAdapterAdvanced","inputs":{"weight":0.8}});
        validate_workflow(&c).unwrap();
        assert_eq!(c.workflow["custom"]["inputs"]["weight"], 0.8);
    }
    #[test]
    fn image_urls_and_dimensions_are_checked() {
        let mut c = config();
        c.base_url = "http://example.com".into();
        assert!(validate_config(&c).is_err());
        assert!(Media::from_bytes(b"<html>not an image</html>".to_vec()).is_err());
    }
}
