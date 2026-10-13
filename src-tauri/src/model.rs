use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub fn id() -> String {
    uuid::Uuid::new_v4().to_string()
}
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn hash(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
pub fn han_count(s: &str) -> usize {
    s.chars()
        .filter(|c| matches!(*c as u32, 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0x20000..=0x2fa1f))
        .count()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub user_message: String,
    pub retryable: bool,
    pub correlation_id: String,
}
impl AppError {
    pub fn new(code: &str, msg: &str) -> Self {
        Self {
            code: code.into(),
            user_message: msg.into(),
            retryable: matches!(code, "NETWORK" | "TIMEOUT" | "RATE_LIMIT" | "CONFLICT"),
            correlation_id: id(),
        }
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.user_message)
    }
}
impl std::error::Error for AppError {}
impl From<rusqlite::Error> for AppError {
    fn from(_: rusqlite::Error) -> Self {
        Self::new("DATABASE", "本地数据库操作失败；请保留项目并重新启动。")
    }
}
impl From<serde_json::Error> for AppError {
    fn from(_: serde_json::Error) -> Self {
        Self::new("INVALID_SCHEMA", "数据格式不正确或版本不受支持。")
    }
}
impl From<std::io::Error> for AppError {
    fn from(_: std::io::Error) -> Self {
        Self::new("FILE_ERROR", "文件无法读写；请检查位置和权限。")
    }
}
pub type Result<T> = std::result::Result<T, AppError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub target_chars: usize,
    pub max_calls: usize,
    pub context_tokens: usize,
    pub writer_id: String,
    pub reviewer_id: String,
    pub auto_review: bool,
    pub auto_next: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            target_chars: 3000,
            max_calls: 6,
            context_tokens: 16000,
            writer_id: String::new(),
            reviewer_id: String::new(),
            auto_review: false,
            auto_next: false,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Style {
    pub preset: String,
    pub perspective: String,
    pub rhythm: String,
    pub dialogue: String,
    pub description: String,
    pub tone: String,
    pub avoid: String,
    pub revision: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    #[serde(default)]
    pub writing_preset: Option<crate::presets::WritingPreset>,
    pub id: String,
    pub title: String,
    pub genre: String,
    pub perspective: String,
    pub outline: String,
    pub revision: u32,
    pub created_at: u64,
    pub updated_at: u64,
    pub settings: Settings,
    pub style: Style,
    pub chapters: Vec<Chapter>,
    pub characters: Vec<Character>,
    pub relations: Vec<Relation>,
    pub facts: Vec<Fact>,
    pub proposals: Vec<Proposal>,
    pub reports: Vec<Report>,
    #[serde(default)]
    pub book_source: String,
    #[serde(default)]
    pub pdf_book: Option<crate::reading::PdfBook>,
    #[serde(default)]
    pub reading_marks: Vec<crate::reader_marks::ReadingMark>,
    #[serde(default)]
    pub book_outline: Vec<crate::ebooks::BookOutline>,
    #[serde(default)]
    pub book_content: Vec<crate::ebooks::BookContent>,
    #[serde(default)]
    pub cover_image_id: String,
    #[serde(default)]
    pub reader: crate::reading::ReaderState,
    #[serde(default)]
    pub visual_settings: crate::visual::VisualSettings,
    #[serde(default)]
    pub visual_profiles: Vec<crate::visual::VisualProfile>,
    #[serde(default)]
    pub visual_changes: Vec<crate::visual::VisualChange>,
    #[serde(default)]
    pub artwork: Vec<crate::visual::Artwork>,
}
impl Project {
    pub fn new(title: String) -> Self {
        Self {
            writing_preset: None,
            id: id(),
            title,
            genre: "悬疑".into(),
            perspective: "第三人称限知".into(),
            outline: String::new(),
            revision: 0,
            created_at: now(),
            updated_at: now(),
            settings: Settings::default(),
            style: Style {
                preset: "克制叙事".into(),
                tone: "语言自然、克制，用具体行动推进情节，少解释多呈现。".into(),
                ..Style::default()
            },
            chapters: vec![],
            characters: vec![],
            relations: vec![],
            facts: vec![],
            proposals: vec![],
            reports: vec![],
            book_source: String::new(),
            pdf_book: None,
            reading_marks: vec![],
            book_outline: vec![],
            book_content: vec![],
            cover_image_id: String::new(),
            reader: crate::reading::ReaderState::default(),
            visual_settings: crate::visual::VisualSettings::default(),
            visual_profiles: vec![],
            visual_changes: vec![],
            artwork: vec![],
        }
    }
    pub fn chapter(&self, cid: &str) -> Result<&Chapter> {
        self.chapters
            .iter()
            .find(|c| c.id == cid)
            .ok_or_else(|| AppError::new("NOT_FOUND", "找不到该章节。"))
    }
    pub fn chapter_mut(&mut self, cid: &str) -> Result<&mut Chapter> {
        self.chapters
            .iter_mut()
            .find(|c| c.id == cid)
            .ok_or_else(|| AppError::new("NOT_FOUND", "找不到该章节。"))
    }
    pub fn validate(&self) -> Result<()> {
        if let Some(preset) = &self.writing_preset {
            preset.validate()?;
        }
        self.reader.validate(self)?;
        crate::reader_marks::validate(self)?;
        crate::ebooks::validate(self)?;
        crate::visual::validate_project(self)?;
        if self.title.trim().is_empty() || self.title.chars().count() > 120 {
            return Err(AppError::new("VALIDATION", "作品标题需要 1～120 个字。"));
        }
        if !(200..=8000).contains(&self.settings.target_chars)
            || !(1..=6).contains(&self.settings.max_calls)
            || !(4000..=200000).contains(&self.settings.context_tokens)
        {
            return Err(AppError::new(
                "VALIDATION",
                "字数、调用次数或上下文预算超出允许范围。",
            ));
        }
        let mut ids = std::collections::HashSet::new();
        for c in &self.chapters {
            if !ids.insert(c.id.clone()) || c.title.trim().is_empty() {
                return Err(AppError::new(
                    "VALIDATION",
                    "章节标题不能为空，章节 ID 不可重复。",
                ));
            }
        }
        ids.clear();
        for c in &self.characters {
            if !ids.insert(c.id.clone()) || c.name.trim().is_empty() {
                return Err(AppError::new(
                    "VALIDATION",
                    "人物名称不能为空，人物 ID 不可重复。",
                ));
            }
        }
        for r in &self.relations {
            if !ids.contains(&r.from_id)
                || !ids.contains(&r.to_id)
                || r.from_id == r.to_id
                || r.kind.trim().is_empty()
                || r.end_order.is_some_and(|e| e < r.start_order)
            {
                return Err(AppError::new(
                    "VALIDATION",
                    "关系端点、类型或有效章节区间不正确。",
                ));
            }
        }
        for f in &self.facts {
            if f.end_order.is_some_and(|e| e < f.start_order) || f.value.trim().is_empty() {
                return Err(AppError::new(
                    "VALIDATION",
                    "记忆内容或有效章节区间不正确。",
                ));
            }
        }
        if serde_json::to_vec(self)?.len() > 100 * 1024 * 1024 {
            return Err(AppError::new(
                "TOO_LARGE",
                "作品及版本历史超过 100 MB，请分卷保存。",
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub volume: String,
    pub goal: String,
    pub events: String,
    pub forbidden: String,
    pub ending: String,
    pub locked: bool,
    pub outline_revision: u32,
    pub edit_revision: u32,
    pub working: String,
    pub current_version_id: String,
    pub approved_version_id: String,
    pub versions: Vec<Version>,
    pub summary: String,
    pub summary_version_id: String,
    pub summary_stale: bool,
    pub upstream_changed: bool,
}
impl Default for Chapter {
    fn default() -> Self {
        Self {
            id: id(),
            title: "新的章节".into(),
            volume: "第一卷".into(),
            goal: String::new(),
            events: String::new(),
            forbidden: String::new(),
            ending: String::new(),
            locked: false,
            outline_revision: 1,
            edit_revision: 0,
            working: String::new(),
            current_version_id: String::new(),
            approved_version_id: String::new(),
            versions: vec![],
            summary: String::new(),
            summary_version_id: String::new(),
            summary_stale: false,
            upstream_changed: false,
        }
    }
}
impl Chapter {
    pub fn approved(&self) -> bool {
        !self.approved_version_id.is_empty()
            && self.current_version_id == self.approved_version_id
            && self
                .versions
                .iter()
                .find(|v| v.id == self.current_version_id)
                .is_some_and(|v| v.content == self.working)
    }
    pub fn status(&self) -> &'static str {
        if self.approved() {
            "approved"
        } else if self.working.trim().is_empty() {
            "planned"
        } else {
            "draft"
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Version {
    pub id: String,
    pub chapter_id: String,
    pub number: u32,
    pub content: String,
    pub author: String,
    pub base_version_id: String,
    pub created_at: u64,
    pub branch: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub role: String,
    pub aliases: String,
    pub profile: String,
    pub state: String,
    pub knowledge: String,
    pub x: f64,
    pub y: f64,
    pub deleted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Relation {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub kind: String,
    pub direction: String,
    pub start_order: usize,
    pub end_order: Option<usize>,
    pub visibility: String,
    pub source: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Fact {
    pub id: String,
    pub category: String,
    pub subject_id: String,
    pub predicate: String,
    pub value: String,
    pub locked: bool,
    pub certainty: String,
    pub visibility: String,
    pub start_order: usize,
    pub end_order: Option<usize>,
    pub source_version_id: String,
    pub excerpt: String,
    pub needs_revalidation: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proposal {
    pub id: String,
    pub source_version_id: String,
    pub fact: Fact,
    pub status: String,
    pub verified: bool,
    pub conflict: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Evidence {
    pub source_id: String,
    pub source_version_id: String,
    pub quote: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Issue {
    pub issue_id: String,
    pub kind: String,
    pub severity: String,
    pub claim: String,
    pub quote: String,
    #[serde(default)]
    pub conflict_evidence: Option<Evidence>,
    pub suggestion: String,
    pub confidence: String,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub decision: String,
    #[serde(default)]
    pub note: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub id: String,
    pub chapter_version_id: String,
    pub summary: String,
    pub issues: Vec<Issue>,
    pub stale: bool,
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
    pub allow_local_http: bool,
    pub token_parameter: String,
    pub json_mode: bool,
    pub temperature: Option<f64>,
    pub max_tokens: usize,
    pub timeout_seconds: u64,
    pub has_key: bool,
    pub key_storage: String,
}
impl Default for Provider {
    fn default() -> Self {
        Self {
            id: id(),
            name: "新模型".into(),
            base_url: "https://api.openai.com/v1".into(),
            model_id: String::new(),
            allow_local_http: false,
            token_parameter: "max_tokens".into(),
            json_mode: false,
            temperature: Some(0.7),
            max_tokens: 4096,
            timeout_seconds: 120,
            has_key: false,
            key_storage: "none".into(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextItem {
    pub id: String,
    pub version_id: String,
    pub label: String,
    pub text: String,
    pub priority: u8,
    pub estimated_tokens: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextBundle {
    pub items: Vec<ContextItem>,
    pub omitted: Vec<String>,
    pub estimated_tokens: usize,
    pub hash: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub project: Project,
    pub chapter_id: String,
    pub outline_revision: u32,
    pub edit_revision: u32,
    pub context: ContextBundle,
    pub scene_count: usize,
    pub override_reason: String,
    pub provider: Provider,
    pub selected_issues: Vec<Issue>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    pub index: usize,
    pub status: String,
    pub text: String,
    pub finish_reason: String,
    pub han_count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub chapter_id: String,
    pub task: String,
    pub status: String,
    pub snapshot: Snapshot,
    pub segments: Vec<Segment>,
    pub error: Option<AppError>,
    pub calls: usize,
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub created_at: u64,
    pub result_version_id: String,
    pub recovered_from: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Mutation {
    ModelSelection {
        role: String,
        provider_id: String,
    },
    WritingPreset {
        preset: Option<crate::presets::WritingPreset>,
    },
    ReadingMark {
        mark: crate::reader_marks::ReadingMark,
    },
    DeleteReadingMark {
        mark_id: String,
    },
    VisualExtraction {
        profiles: Vec<crate::visual_extract::ProfileCandidate>,
        changes: Vec<crate::visual_extract::ChangeCandidate>,
        overwrite_existing: bool,
    },
    Reader {
        state: crate::reading::ReaderState,
    },
    VisualSettings {
        settings: crate::visual::VisualSettings,
    },
    VisualProfile {
        profile: crate::visual::VisualProfile,
    },
    VisualChange {
        change: crate::visual::VisualChange,
    },
    DeleteVisualChange {
        change_id: String,
    },
    Artwork {
        artwork_id: String,
        approved: bool,
    },
    Metadata {
        title: String,
        genre: String,
        perspective: String,
        outline: String,
        settings: Settings,
    },
    AddChapter {
        chapter: Chapter,
    },
    Outline {
        chapter: Chapter,
    },
    MoveChapter {
        chapter_id: String,
        direction: i32,
    },
    Character {
        character: Character,
    },
    Relation {
        relation: Relation,
    },
    DeleteRelation {
        relation_id: String,
    },
    Fact {
        fact: Fact,
    },
    DeleteFact {
        fact_id: String,
    },
    Style {
        style: Style,
    },
    Proposal {
        proposal_id: String,
        accept: bool,
    },
    Issue {
        report_id: String,
        issue_id: String,
        decision: String,
        note: String,
    },
    Summary {
        chapter_id: String,
        summary: String,
    },
    Acknowledge {
        chapter_id: String,
    },
}

pub fn apply_mutation(p: &mut Project, m: Mutation) -> Result<()> {
    match m {
        Mutation::ModelSelection { role, provider_id } => match role.as_str() {
            "writer" => p.settings.writer_id = provider_id,
            "reviewer" => p.settings.reviewer_id = provider_id,
            _ => return Err(AppError::new("VALIDATION", "模型角色不正确。")),
        },
        Mutation::WritingPreset { preset } => {
            if let Some(preset) = &preset {
                preset.validate()?;
            }
            p.writing_preset = preset;
        }
        Mutation::ReadingMark { mark } => crate::reader_marks::upsert(p, mark)?,
        Mutation::DeleteReadingMark { mark_id } => p.reading_marks.retain(|m| m.id != mark_id),
        Mutation::VisualExtraction {
            profiles,
            changes,
            overwrite_existing,
        } => {
            crate::visual_extract::apply(p, profiles, changes, overwrite_existing)?;
        }
        Mutation::Reader { mut state } => {
            state.validate(p)?;
            state.last_read_at = now();
            p.reader = state;
        }
        Mutation::VisualSettings { settings } => {
            p.visual_settings = settings;
        }
        Mutation::VisualProfile { profile } => {
            crate::visual::set_profile(p, profile)?;
        }
        Mutation::VisualChange { change } => {
            crate::visual::set_change(p, change)?;
        }
        Mutation::DeleteVisualChange { change_id } => {
            p.visual_changes.retain(|c| c.id != change_id);
        }
        Mutation::Artwork {
            artwork_id,
            approved,
        } => {
            let art = p
                .artwork
                .iter_mut()
                .find(|a| a.id == artwork_id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "插图不存在。"))?;
            if art.kind != "chapter" {
                return Err(AppError::new(
                    "VALIDATION",
                    "人物定妆图请在人物形象卡中确认。",
                ));
            }
            art.approved = approved;
        }
        Mutation::Metadata {
            title,
            genre,
            perspective,
            outline,
            settings,
        } => {
            p.title = title;
            p.genre = genre;
            p.perspective = perspective;
            p.outline = outline;
            p.settings = settings;
        }
        Mutation::AddChapter { mut chapter } => {
            chapter.id = id();
            chapter.versions.clear();
            chapter.working.clear();
            chapter.current_version_id.clear();
            chapter.approved_version_id.clear();
            p.chapters.push(chapter);
        }
        Mutation::Outline { chapter } => {
            let old = p.chapter_mut(&chapter.id)?;
            if old.locked && chapter.locked {
                return Err(AppError::new("LOCKED", "请先解锁章节大纲再编辑。"));
            }
            old.title = chapter.title;
            old.volume = chapter.volume;
            old.goal = chapter.goal;
            old.events = chapter.events;
            old.forbidden = chapter.forbidden;
            old.ending = chapter.ending;
            old.locked = chapter.locked;
            old.outline_revision += 1;
        }
        Mutation::MoveChapter {
            chapter_id,
            direction,
        } => {
            let i = p
                .chapters
                .iter()
                .position(|c| c.id == chapter_id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "章节不存在。"))?;
            if p.chapters.iter().any(|c| !c.versions.is_empty()) {
                return Err(AppError::new(
                    "ORDER_LOCKED",
                    "已有正文的作品不调整章节序号，避免改变记忆有效区间。可编辑卷名与标题。",
                ));
            }
            let j = (i as i32 + direction.signum()).clamp(0, p.chapters.len() as i32 - 1) as usize;
            p.chapters.swap(i, j);
        }
        Mutation::Character { mut character } => {
            if character.id.is_empty() {
                character.id = id();
            }
            if let Some(c) = p.characters.iter_mut().find(|c| c.id == character.id) {
                *c = character;
            } else {
                p.characters.push(character);
            }
        }
        Mutation::Relation { mut relation } => {
            if relation.id.is_empty() {
                relation.id = id();
            }
            if let Some(r) = p.relations.iter_mut().find(|r| r.id == relation.id) {
                *r = relation;
            } else {
                p.relations.push(relation);
            }
        }
        Mutation::DeleteRelation { relation_id } => p.relations.retain(|r| r.id != relation_id),
        Mutation::Fact { mut fact } => {
            fact.source_version_id.clear();
            fact.excerpt.clear();
            fact.needs_revalidation = false;
            if fact.id.is_empty() {
                fact.id = id();
            }
            if let Some(f) = p.facts.iter_mut().find(|f| f.id == fact.id) {
                *f = fact;
            } else {
                p.facts.push(fact);
            }
        }
        Mutation::DeleteFact { fact_id } => p.facts.retain(|f| f.id != fact_id),
        Mutation::Style { mut style } => {
            style.revision = p.style.revision + 1;
            p.style = style;
        }
        Mutation::Proposal {
            proposal_id,
            accept,
        } => {
            let proposal = p
                .proposals
                .iter()
                .find(|x| x.id == proposal_id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "候选不存在。"))?
                .clone();
            if proposal.status != "pending" {
                return Err(AppError::new("ALREADY_DECIDED", "这条候选已处理。"));
            }
            if accept {
                if !proposal.verified {
                    return Err(AppError::new(
                        "UNVERIFIED",
                        "无法定位来源，请手动核实并新增记忆。",
                    ));
                }
                let source_current = p
                    .chapters
                    .iter()
                    .any(|c| c.approved_version_id == proposal.source_version_id);
                if !source_current {
                    return Err(AppError::new(
                        "STALE_SOURCE",
                        "来源正文已改变，请重新提取。",
                    ));
                }
                if p.facts.iter().any(|f| {
                    f.subject_id == proposal.fact.subject_id
                        && f.predicate == proposal.fact.predicate
                        && f.value != proposal.fact.value
                        && f.start_order <= proposal.fact.end_order.unwrap_or(usize::MAX)
                        && proposal.fact.start_order <= f.end_order.unwrap_or(usize::MAX)
                }) {
                    return Err(AppError::new(
                        "MEMORY_CONFLICT",
                        "候选与现有事实冲突。请在事实编辑器调整有效章节区间后再处理。",
                    ));
                }
                let mut f = proposal.fact.clone();
                f.id = id();
                f.locked = false;
                p.facts.push(f);
            }
            p.proposals
                .iter_mut()
                .find(|x| x.id == proposal_id)
                .unwrap()
                .status = if accept { "accepted" } else { "rejected" }.into();
        }
        Mutation::Issue {
            report_id,
            issue_id,
            decision,
            note,
        } => {
            let report = p
                .reports
                .iter_mut()
                .find(|r| r.id == report_id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "报告不存在。"))?;
            if report.stale {
                return Err(AppError::new("STALE_REPORT", "正文已更新，请重新审稿。"));
            }
            if !["ignore", "foreshadow", "revise", "candidate", ""].contains(&decision.as_str()) {
                return Err(AppError::new("VALIDATION", "处理动作无效。"));
            }
            let issue = report
                .issues
                .iter_mut()
                .find(|i| i.issue_id == issue_id)
                .ok_or_else(|| AppError::new("NOT_FOUND", "问题不存在。"))?;
            issue.decision = decision;
            issue.note = note;
        }
        Mutation::Summary {
            chapter_id,
            summary,
        } => {
            let c = p.chapter_mut(&chapter_id)?;
            if c.approved_version_id.is_empty() {
                return Err(AppError::new(
                    "NEEDS_APPROVAL",
                    "先确认正文，再保存章节摘要。",
                ));
            }
            c.summary = summary;
            c.summary_version_id = c.approved_version_id.clone();
            c.summary_stale = false;
        }
        Mutation::Acknowledge { chapter_id } => {
            p.chapter_mut(&chapter_id)?.upstream_changed = false
        }
    }
    for proposal in p.proposals.iter_mut().filter(|x| x.status == "pending") {
        proposal.conflict = p
            .facts
            .iter()
            .find(|f| {
                f.subject_id == proposal.fact.subject_id
                    && f.predicate == proposal.fact.predicate
                    && f.value != proposal.fact.value
                    && f.start_order <= proposal.fact.end_order.unwrap_or(usize::MAX)
                    && proposal.fact.start_order <= f.end_order.unwrap_or(usize::MAX)
            })
            .map(|f| format!("与现有记忆“{}：{}”有效期间重叠。", f.predicate, f.value))
            .unwrap_or_default();
    }
    p.validate()
}

pub fn approve(
    p: &mut Project,
    chapter_id: &str,
    version_id: &str,
    risk_reason: &str,
) -> Result<()> {
    let index = p
        .chapters
        .iter()
        .position(|c| c.id == chapter_id)
        .ok_or_else(|| AppError::new("NOT_FOUND", "章节不存在。"))?;
    let c = &p.chapters[index];
    let v = c
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| AppError::new("NOT_FOUND", "版本不存在。"))?;
    if c.current_version_id != version_id || v.content != c.working {
        return Err(AppError::new(
            "UNSAVED",
            "请先保存当前正文为版本，再确认章节。",
        ));
    }
    let unresolved = p
        .reports
        .iter()
        .filter(|r| !r.stale && r.chapter_version_id == version_id)
        .any(|r| {
            r.issues
                .iter()
                .any(|i| i.severity == "blocker" && i.decision.is_empty())
        });
    let reviewed = p
        .reports
        .iter()
        .any(|r| !r.stale && r.chapter_version_id == version_id);
    if (unresolved || !reviewed) && risk_reason.trim().is_empty() {
        return Err(AppError::new(
            "REVIEW_REQUIRED",
            if unresolved {
                "仍有未处理的阻断问题；如需确认请填写原因。"
            } else {
                "本章尚未审稿；如需跳过请填写原因。"
            },
        ));
    }
    let old = c.approved_version_id.clone();
    if old != version_id {
        if !old.is_empty() {
            for f in &mut p.facts {
                if f.source_version_id == old {
                    f.needs_revalidation = true;
                }
            }
            for c in p.chapters.iter_mut().skip(index + 1) {
                c.upstream_changed = true;
            }
        }
        let c = &mut p.chapters[index];
        c.approved_version_id = version_id.into();
        c.summary_stale = true;
    }
    Ok(())
}

pub fn next_chapter(p: &Project, chapter_id: &str) -> Result<String> {
    let index = p
        .chapters
        .iter()
        .position(|c| c.id == chapter_id)
        .ok_or_else(|| AppError::new("NOT_FOUND", "章节不存在。"))?;
    if !p.chapters[index].approved() {
        return Err(AppError::new(
            "NEEDS_APPROVAL",
            "请先确认当前章，再进入下一章。",
        ));
    }
    p.chapters
        .get(index + 1)
        .filter(|c| !c.goal.trim().is_empty() || !c.events.trim().is_empty())
        .map(|c| c.id.clone())
        .ok_or_else(|| AppError::new("NEEDS_OUTLINE", "请先补充下一章大纲。"))
}

pub fn fixture() -> Project {
    let mut p = Project::new("雾港灯塔".into());
    p.outline="灯塔在暴雨中熄灭。林舟与叶岚逃离封锁的雾港，在第三章发现蓝光与失踪父亲的关联。真相的揭露必须循序渐进。".into();
    let a = id();
    let b = id();
    p.characters = vec![
        Character {
            id: a.clone(),
            name: "林舟".into(),
            role: "主角 · 修灯学徒".into(),
            profile: "敏锐、固执，习惯通过行动而非长篇解释表达情绪。".into(),
            state: "第一章结束时左臂受伤；第二章尚未治愈。".into(),
            knowledge: "不知道铜钥匙的藏处，也不知道蓝光真相。".into(),
            x: 100.0,
            y: 150.0,
            ..Character::default()
        },
        Character {
            id: b.clone(),
            name: "叶岚".into(),
            role: "主角 · 港口信使".into(),
            profile: "谨慎、观察力强，对林舟有所隐瞒。".into(),
            state: "持有铜钥匙，除非正文明确交接。".into(),
            knowledge: "知道钥匙藏处；蓝光的来历仍未知。".into(),
            x: 450.0,
            y: 150.0,
            ..Character::default()
        },
    ];
    p.relations = vec![Relation {
        id: id(),
        from_id: a,
        to_id: b,
        kind: "互相依赖".into(),
        direction: "both".into(),
        start_order: 1,
        visibility: "world_public".into(),
        source: "作者设定".into(),
        ..Relation::default()
    }];
    for (cat, pred, value, vis) in [
        (
            "world",
            "灯塔限制",
            "灯塔熄灭后的 24 小时内不能重燃。",
            "world_public",
        ),
        (
            "item",
            "铜钥匙持有者",
            "第一章由叶岚持有；第二章只有明确交接后才能进入林舟背包。",
            "character_subset",
        ),
        (
            "foreshadow",
            "蓝光揭示时点",
            "第一章出现奇怪蓝光，第三章才允许揭示真相。",
            "author_only",
        ),
    ] {
        p.facts.push(Fact {
            id: id(),
            category: cat.into(),
            predicate: pred.into(),
            value: value.into(),
            locked: true,
            certainty: "confirmed".into(),
            visibility: vis.into(),
            start_order: 1,
            ..Fact::default()
        });
    }
    for (title, goal, events, forbid, ending) in [
        (
            "熄灯",
            "建立雾港危机，留下蓝光疑问。",
            "暴雨来临\n灯塔熄灭\n林舟左臂受伤，叶岚保管铜钥匙",
            "不能揭示蓝光真相",
            "两人决定离开灯塔",
        ),
        (
            "逃港",
            "让两人在封锁中逃离雾港。",
            "寻找安全路线\n林舟伤势影响行动\n叶岚决定是否交出钥匙",
            "不能重燃灯塔；不能提前揭露蓝光真相；不能凭空转移钥匙",
            "抵达旧船厂",
        ),
        (
            "蓝光",
            "回收蓝光伏笔，推进父亲的秘密。",
            "发现蓝光来源线索\n解释前两章疑问\n确立新的目标",
            "不能忽略钥匙去向和林舟伤势",
            "踏上寻找父亲的旅程",
        ),
    ] {
        p.chapters.push(Chapter {
            title: title.into(),
            goal: goal.into(),
            events: events.into(),
            forbidden: forbid.into(),
            ending: ending.into(),
            ..Chapter::default()
        });
    }
    p
}
