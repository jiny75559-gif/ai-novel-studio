use crate::model::*;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::sync::Mutex;

pub struct Database(pub Mutex<Connection>);

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS chapters(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id));
CREATE TABLE IF NOT EXISTS reader_state(project_id TEXT PRIMARY KEY REFERENCES projects(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS book_metadata(project_id TEXT PRIMARY KEY REFERENCES projects(id),document_id TEXT);
CREATE TABLE IF NOT EXISTS chapter_versions(id TEXT PRIMARY KEY,chapter_id TEXT NOT NULL REFERENCES chapters(id),version_no INTEGER NOT NULL,content TEXT NOT NULL,data TEXT NOT NULL,UNIQUE(chapter_id,version_no));
CREATE TRIGGER IF NOT EXISTS immutable_version_update BEFORE UPDATE ON chapter_versions BEGIN SELECT RAISE(ABORT,'immutable chapter version'); END;
CREATE TRIGGER IF NOT EXISTS immutable_version_delete BEFORE DELETE ON chapter_versions BEGIN SELECT RAISE(ABORT,'immutable chapter version'); END;
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),chapter_id TEXT NOT NULL,task TEXT NOT NULL,status TEXT NOT NULL,data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS single_writer ON runs((1)) WHERE status='running' AND task IN ('write','revise');
CREATE UNIQUE INDEX IF NOT EXISTS single_task ON runs(chapter_id,task) WHERE status='running';
CREATE TABLE IF NOT EXISTS run_segments(run_id TEXT NOT NULL REFERENCES runs(id),segment_index INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,segment_index));
CREATE TABLE IF NOT EXISTS model_configs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS writing_presets(id TEXT PRIMARY KEY,name TEXT NOT NULL,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_log(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,event_type TEXT NOT NULL,entity_id TEXT NOT NULL,at INTEGER NOT NULL,note TEXT NOT NULL);
INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
CREATE TABLE IF NOT EXISTS image_configs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS media(id TEXT PRIMARY KEY,mime TEXT NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS image_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS single_image_job ON image_jobs((1)) WHERE status='running';
INSERT OR IGNORE INTO schema_migrations(version) VALUES(2);
"#;

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        let mut c = Connection::open(path)?;
        c.pragma_update(None, "journal_mode", "WAL")?;
        c.pragma_update(None, "foreign_keys", true)?;
        c.busy_timeout(std::time::Duration::from_secs(5))?;
        let tx = c.transaction()?;
        tx.execute_batch(SCHEMA)?;
        tx.commit()?;
        let db = Self(Mutex::new(c));
        db.seed_writing_presets()?;
        for mut run in db.list_runs(None)? {
            if run.status == "running" {
                run.status = "interrupted".into();
                run.error = Some(AppError::new(
                    "INTERRUPTED",
                    "上次任务未完成，已保留片段；可恢复或放弃。",
                ));
                db.store_run(&run)?;
            }
        }
        for mut job in db.image_jobs(None)? {
            if job.status == "running" {
                job.status = "interrupted".into();
                job.error = Some(AppError::new(
                    "INTERRUPTED",
                    "上次生图中断；有 ComfyUI 任务编号时可按原任务取回。",
                ));
                db.update_image_job(&job)?;
            }
        }
        Ok(db)
    }
    pub(crate) fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| AppError::new("DATABASE", "数据库暂不可用。"))
    }
    pub(crate) fn load_conn(c: &Connection, pid: &str) -> Result<Project> {
        let text: Option<String> = c
            .query_row(
                "SELECT data FROM projects WHERE id=? AND deleted=0",
                [pid],
                |r| r.get(0),
            )
            .optional()?;
        let mut p: Project = serde_json::from_str(
            &text.ok_or_else(|| AppError::new("NOT_FOUND", "项目不存在或已放入回收站。"))?,
        )?;
        Self::overlay_reader(c, &mut p)?;
        for chapter in &mut p.chapters {
            let mut stmt = c.prepare(
                "SELECT data FROM chapter_versions WHERE chapter_id=? ORDER BY version_no",
            )?;
            let rows = stmt.query_map([&chapter.id], |r| r.get::<_, String>(0))?;
            chapter.versions = rows
                .map(|x| Ok(serde_json::from_str::<Version>(&x?)?))
                .collect::<Result<Vec<_>>>()?;
        }
        Ok(p)
    }
    pub(crate) fn persist(c: &Connection, p: &mut Project) -> Result<()> {
        p.validate()?;
        let previous = p.revision;
        p.revision += 1;
        p.updated_at = now();
        let mut stored = p.clone();
        for ch in &mut stored.chapters {
            ch.versions.clear();
        }
        let changed=c.execute("UPDATE projects SET title=?,revision=?,data=?,updated_at=? WHERE id=? AND revision=? AND deleted=0",params![p.title,p.revision,serde_json::to_string(&stored)?,p.updated_at,p.id,previous])?;
        if changed != 1 {
            return Err(AppError::new(
                "CONFLICT",
                "项目已在另一窗口更新，请刷新后重新保存。",
            ));
        }
        c.execute("INSERT INTO reader_state VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data",params![p.id,serde_json::to_string(&p.reader)?])?;
        for ch in &p.chapters {
            c.execute(
                "INSERT OR IGNORE INTO chapters(id,project_id) VALUES(?,?)",
                params![ch.id, p.id],
            )?;
        }
        Ok(())
    }
    fn event(c: &Connection, pid: &str, kind: &str, entity: &str, note: &str) -> Result<()> {
        c.execute(
            "INSERT INTO event_log VALUES(?,?,?,?,?,?)",
            params![id(), pid, kind, entity, now(), note],
        )?;
        Ok(())
    }
    pub fn create(&self, p: Project) -> Result<Project> {
        self.create_with_media(p, &[])
    }
    pub fn create_with_media(
        &self,
        mut p: Project,
        assets: &[crate::visual::Media],
    ) -> Result<Project> {
        p.validate()?;
        let mut c = self.lock()?;
        let tx = c.transaction()?;
        for asset in assets {
            Self::store_media_conn(&tx, asset)?;
        }
        Self::validate_media_conn(&tx, &p)?;
        p.revision = 1;
        let mut stored = p.clone();
        for ch in &mut stored.chapters {
            ch.versions.clear();
        }
        tx.execute(
            "INSERT INTO projects(id,title,revision,data,updated_at) VALUES(?,?,?,?,?)",
            params![
                p.id,
                p.title,
                p.revision,
                serde_json::to_string(&stored)?,
                p.updated_at
            ],
        )?;
        for ch in &p.chapters {
            tx.execute("INSERT INTO chapters VALUES(?,?)", params![ch.id, p.id])?;
            for v in &ch.versions {
                Self::insert_version(&tx, v)?;
            }
        }
        tx.execute(
            "INSERT INTO book_metadata VALUES(?,?)",
            params![p.id, p.pdf_book.as_ref().map(|b| &b.document_id)],
        )?;
        Self::event(&tx, &p.id, "create", &p.id, "")?;
        tx.commit()?;
        Ok(p)
    }
    pub fn list_projects(&self, trash: bool) -> Result<Vec<serde_json::Value>> {
        let c = self.lock()?;
        let mut st=c.prepare("SELECT id,title,updated_at,data FROM projects WHERE deleted=? ORDER BY updated_at DESC")?;
        let rows = st.query_map([trash], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, u64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?;
        rows.map(|r| { let (pid,title,time,data)=r?; let mut p:Project=serde_json::from_str(&data)?; Self::overlay_reader(&c,&mut p)?; Ok(serde_json::json!({"id":pid,"title":title,"updatedAt":time,"genre":p.genre,"chapters":p.chapters.len(),"bookSource":p.book_source,"lastReadAt":p.reader.last_read_at,"readingProgress":crate::reading::progress(&p),"coverImageId":p.cover_image_id})) }).collect()
    }
    fn overlay_reader(c: &Connection, p: &mut Project) -> Result<()> {
        let state: Option<String> = c
            .query_row(
                "SELECT data FROM reader_state WHERE project_id=?",
                [&p.id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(state) = state {
            p.reader = serde_json::from_str(&state)?;
        }
        Ok(())
    }
    pub fn save_reader(
        &self,
        pid: &str,
        mut state: crate::reading::ReaderState,
    ) -> Result<crate::reading::ReaderState> {
        let c = self.lock()?;
        let mut pdf: Option<Option<String>> = c
            .query_row(
                "SELECT document_id FROM book_metadata WHERE project_id=?",
                [pid],
                |r| r.get(0),
            )
            .optional()?;
        if pdf.is_none() {
            pdf = c
                .query_row(
                    "SELECT json_extract(data,'$.pdfBook.documentId') FROM projects WHERE id=?",
                    [pid],
                    |r| r.get(0),
                )
                .optional()?;
            if let Some(document) = &pdf {
                c.execute(
                    "INSERT INTO book_metadata VALUES(?,?)",
                    params![pid, document],
                )?;
            }
        }
        let pdf = pdf.ok_or_else(|| AppError::new("NOT_FOUND", "作品不存在。"))?;
        let mut p = Project::new("阅读进度".into());
        if let Some(document_id) = pdf {
            p.pdf_book = Some(crate::reading::PdfBook { document_id });
            p.book_source = "pdf".into();
        } else {
            let mut ids = std::collections::HashSet::new();
            for cid in std::iter::once(&state.chapter_id)
                .chain(state.bookmarks.iter().map(|b| &b.chapter_id))
                .filter(|s| !s.is_empty())
            {
                if ids.insert(cid) {
                    let valid: bool = c.query_row(
                        "SELECT EXISTS(SELECT 1 FROM chapters WHERE id=? AND project_id=?)",
                        params![cid, pid],
                        |r| r.get(0),
                    )?;
                    if !valid {
                        return Err(AppError::new("VALIDATION", "阅读章节不属于这个作品。"));
                    }
                    p.chapters.push(Chapter {
                        id: cid.clone(),
                        ..Chapter::default()
                    });
                }
            }
        }
        state.validate(&p)?;
        state.last_read_at = now();
        c.execute("INSERT INTO reader_state VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET data=excluded.data",params![pid,serde_json::to_string(&state)?])?;
        Ok(state)
    }
    pub fn load(&self, pid: &str) -> Result<Project> {
        Self::load_conn(&*self.lock()?, pid)
    }
    pub fn mutate(&self, pid: &str, expected: u32, m: Mutation) -> Result<Project> {
        let mut c = self.lock()?;
        let tx = c.transaction()?;
        let mut p = Self::load_conn(&tx, pid)?;
        if p.revision != expected {
            return Err(AppError::new(
                "CONFLICT",
                "项目刚刚更新。请刷新后重新保存；输入仍在编辑框中。",
            ));
        }
        apply_mutation(&mut p, m)?;
        Self::validate_media_conn(&tx, &p)?;
        Self::persist(&tx, &mut p)?;
        Self::event(&tx, pid, "mutation", pid, "")?;
        tx.commit()?;
        Ok(p)
    }
    pub fn trash(&self, pid: &str, deleted: bool) -> Result<()> {
        let c = self.lock()?;
        if !deleted {
            c.execute("UPDATE projects SET deleted=0 WHERE id=?", [pid])?;
        } else {
            let active: i64 = c.query_row(
                "SELECT COUNT(*) FROM runs WHERE project_id=? AND status='running'",
                [pid],
                |r| r.get(0),
            )?;
            if active > 0 {
                return Err(AppError::new("ALREADY_RUNNING", "请先取消运行中的任务。"));
            }
            c.execute("UPDATE projects SET deleted=1 WHERE id=?", [pid])?;
        }
        Ok(())
    }
    pub fn save_working(
        &self,
        pid: &str,
        cid: &str,
        expected: u32,
        content: String,
    ) -> Result<Project> {
        if content.len() > 2 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "单章内容超过 2 MB。"));
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut p = Self::load_conn(&tx, pid)?;
        let c = p.chapter_mut(cid)?;
        if c.edit_revision != expected {
            return Err(AppError::new(
                "CONFLICT",
                "正文已有更新。你的输入仍保留，请复制内容后刷新并另存版本。",
            ));
        }
        if c.working != content {
            c.working = content;
            c.edit_revision += 1;
            for r in &mut p.reports {
                if p.chapters.iter().any(|ch| {
                    ch.id == cid && ch.versions.iter().any(|v| v.id == r.chapter_version_id)
                }) {
                    r.stale = true;
                }
            }
            Self::persist(&tx, &mut p)?;
        }
        tx.commit()?;
        Ok(p)
    }
    fn insert_version(c: &Connection, v: &Version) -> Result<()> {
        c.execute(
            "INSERT INTO chapter_versions VALUES(?,?,?,?,?)",
            params![
                v.id,
                v.chapter_id,
                v.number,
                v.content,
                serde_json::to_string(v)?
            ],
        )?;
        Ok(())
    }
    fn add_version(
        c: &Connection,
        p: &mut Project,
        cid: &str,
        content: String,
        author: &str,
        branch: bool,
    ) -> Result<Version> {
        if content.trim().is_empty() {
            return Err(AppError::new("EMPTY_CONTENT", "正文不能为空。"));
        }
        let ch = p.chapter_mut(cid)?;
        let v = Version {
            id: id(),
            chapter_id: cid.into(),
            number: ch.versions.iter().map(|v| v.number).max().unwrap_or(0) + 1,
            content: content.clone(),
            author: author.into(),
            base_version_id: ch.current_version_id.clone(),
            created_at: now(),
            branch,
        };
        Self::insert_version(c, &v)?;
        ch.versions.push(v.clone());
        if !branch {
            ch.current_version_id = v.id.clone();
            ch.working = content;
            ch.edit_revision += 1;
            for r in &mut p.reports {
                if p.chapters.iter().any(|ch| {
                    ch.id == cid && ch.versions.iter().any(|v| v.id == r.chapter_version_id)
                }) {
                    r.stale = true;
                }
            }
        }
        Ok(v)
    }
    pub fn save_version(
        &self,
        pid: &str,
        cid: &str,
        expected: u32,
        restore_id: &str,
    ) -> Result<Project> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut p = Self::load_conn(&tx, pid)?;
        let ch = p.chapter(cid)?;
        if ch.edit_revision != expected {
            return Err(AppError::new("CONFLICT", "正文已更新，请刷新后保存。"));
        }
        let (content, author) = if restore_id.is_empty() {
            (ch.working.clone(), "manual")
        } else {
            (
                ch.versions
                    .iter()
                    .find(|v| v.id == restore_id)
                    .ok_or_else(|| AppError::new("NOT_FOUND", "历史版本不存在。"))?
                    .content
                    .clone(),
                "rollback",
            )
        };
        if restore_id.is_empty()
            && ch
                .versions
                .iter()
                .find(|v| v.id == ch.current_version_id)
                .is_some_and(|v| v.content == content)
        {
            return Ok(p);
        }
        let v = Self::add_version(&tx, &mut p, cid, content, author, false)?;
        Self::persist(&tx, &mut p)?;
        Self::event(&tx, pid, "version", &v.id, author)?;
        tx.commit()?;
        Ok(p)
    }
    pub fn approve(&self, pid: &str, cid: &str, vid: &str, reason: &str) -> Result<Project> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut p = Self::load_conn(&tx, pid)?;
        approve(&mut p, cid, vid, reason)?;
        Self::persist(&tx, &mut p)?;
        Self::event(&tx, pid, "approve", vid, reason)?;
        tx.commit()?;
        Ok(p)
    }
    pub fn providers(&self) -> Result<Vec<Provider>> {
        let conn = self.lock()?;
        let mut st = conn.prepare("SELECT data FROM model_configs")?;
        let rows = st.query_map([], |r| r.get::<_, String>(0))?;
        rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
    }
    pub fn provider(&self, pid: &str) -> Result<Provider> {
        self.providers()?
            .into_iter()
            .find(|p| p.id == pid)
            .ok_or_else(|| AppError::new("NO_MODEL", "请在模型设置中配置并选择模型。"))
    }
    pub fn store_provider(&self, p: &Provider) -> Result<()> {
        self.lock()?.execute("INSERT INTO model_configs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",params![p.id,serde_json::to_string(p)?])?;
        Ok(())
    }
    pub fn remove_provider(&self, pid: &str) -> Result<()> {
        for v in self.list_projects(false)? {
            let p = self.load(v["id"].as_str().unwrap_or_default())?;
            if p.settings.writer_id == pid || p.settings.reviewer_id == pid {
                return Err(AppError::new(
                    "MODEL_IN_USE",
                    "该模型仍被项目使用。请先更换主/副模型。",
                ));
            }
        }
        self.lock()?
            .execute("DELETE FROM model_configs WHERE id=?", [pid])?;
        Ok(())
    }
    fn read_run(conn: &Connection, rid: &str) -> Result<Run> {
        let data: Option<String> = conn
            .query_row("SELECT data FROM runs WHERE id=?", [rid], |r| r.get(0))
            .optional()?;
        let mut run: Run =
            serde_json::from_str(&data.ok_or_else(|| AppError::new("NOT_FOUND", "任务不存在。"))?)?;
        let mut st =
            conn.prepare("SELECT data FROM run_segments WHERE run_id=? ORDER BY segment_index")?;
        let rows = st.query_map([rid], |r| r.get::<_, String>(0))?;
        run.segments = rows
            .map(|r| Ok(serde_json::from_str(&r?)?))
            .collect::<Result<_>>()?;
        Ok(run)
    }
    pub fn run(&self, rid: &str) -> Result<Run> {
        Self::read_run(&*self.lock()?, rid)
    }
    pub fn list_runs(&self, pid: Option<&str>) -> Result<Vec<Run>> {
        let conn = self.lock()?;
        let mut st = conn.prepare(
            "SELECT id FROM runs WHERE (? IS NULL OR project_id=?) ORDER BY rowid DESC LIMIT 100",
        )?;
        let ids = st
            .query_map(params![pid, pid], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        ids.iter().map(|rid| Self::read_run(&conn, rid)).collect()
    }
    pub fn begin_run(&self, run: &Run) -> Result<Run> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if tx.query_row("SELECT COUNT(*) FROM runs WHERE id=?", [&run.id], |r| {
            r.get::<_, i64>(0)
        })? > 0
        {
            let existing = Self::read_run(&tx, &run.id)?;
            if existing.project_id != run.project_id
                || existing.chapter_id != run.chapter_id
                || existing.task != run.task
            {
                return Err(AppError::new("ID_CONFLICT", "任务 ID 已用于不同操作。"));
            }
            return Ok(existing);
        }
        let latest = Self::load_conn(&tx, &run.project_id)?;
        if latest.revision != run.snapshot.project.revision {
            return Err(AppError::new(
                "CONFLICT",
                "准备期间项目发生变化，请重新生成。",
            ));
        }
        let inserted = tx.execute(
            "INSERT INTO runs VALUES(?,?,?,?,?,?)",
            params![
                run.id,
                run.project_id,
                run.chapter_id,
                run.task,
                run.status,
                serde_json::to_string(run)?
            ],
        );
        if let Err(e) = inserted {
            if matches!(e, rusqlite::Error::SqliteFailure(_, _)) {
                return Err(AppError::new(
                    "ALREADY_RUNNING",
                    "已有同类任务运行中。请等待或取消。",
                ));
            }
            return Err(e.into());
        }
        for s in &run.segments {
            tx.execute(
                "INSERT INTO run_segments VALUES(?,?,?)",
                params![run.id, s.index, serde_json::to_string(s)?],
            )?;
        }
        tx.commit()?;
        Ok(run.clone())
    }
    pub fn store_run(&self, run: &Run) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let old_status: String =
            tx.query_row("SELECT status FROM runs WHERE id=?", [&run.id], |r| {
                r.get(0)
            })?;
        // Once cancelled, no late HTTP result may revive or commit this task.
        if old_status == "cancelled" && run.status != "cancelled" {
            return Err(AppError::new("CANCELLED", "任务已取消。"));
        }
        if old_status != "running" && old_status != run.status {
            return Err(AppError::new("TASK_FINISHED", "任务已结束，不能更改终态。"));
        }
        let mut stored = run.clone();
        stored.segments.clear();
        tx.execute(
            "UPDATE runs SET status=?,data=? WHERE id=?",
            params![run.status, serde_json::to_string(&stored)?, run.id],
        )?;
        for s in &run.segments {
            tx.execute("INSERT INTO run_segments VALUES(?,?,?) ON CONFLICT(run_id,segment_index) DO UPDATE SET data=excluded.data",params![run.id,s.index,serde_json::to_string(s)?])?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn finish_write(&self, run: &mut Run, content: String) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if Self::read_run(&tx, &run.id)?.status != "running" {
            return Err(AppError::new("CANCELLED", "任务已停止。"));
        }
        let mut p = Self::load_conn(&tx, &run.project_id)?;
        let ch = p.chapter(&run.chapter_id)?;
        let branch = run.task == "revise"
            || ch.outline_revision != run.snapshot.outline_revision
            || ch.edit_revision != run.snapshot.edit_revision;
        let v = Self::add_version(
            &tx,
            &mut p,
            &run.chapter_id,
            content,
            if run.task == "revise" {
                "revision"
            } else {
                "ai"
            },
            branch,
        )?;
        Self::persist(&tx, &mut p)?;
        run.result_version_id = v.id.clone();
        run.status = "succeeded".into();
        let mut stored = run.clone();
        stored.segments.clear();
        tx.execute(
            "UPDATE runs SET status='succeeded',data=? WHERE id=?",
            params![serde_json::to_string(&stored)?, run.id],
        )?;
        Self::event(
            &tx,
            &p.id,
            "generation",
            &v.id,
            if branch { "branch" } else { "current" },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn finish_report(&self, run: &mut Run, mut report: Report) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if Self::read_run(&tx, &run.id)?.status != "running" {
            return Err(AppError::new("CANCELLED", "任务已停止。"));
        }
        let mut p = Self::load_conn(&tx, &run.project_id)?;
        let ch = p.chapter(&run.chapter_id)?;
        report.stale = ch.current_version_id != report.chapter_version_id
            || ch.edit_revision != run.snapshot.edit_revision;
        p.reports.push(report);
        Self::persist(&tx, &mut p)?;
        run.status = "succeeded".into();
        tx.execute(
            "UPDATE runs SET status='succeeded',data=? WHERE id=?",
            params![serde_json::to_string(run)?, run.id],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn finish_memory(
        &self,
        run: &mut Run,
        summary: String,
        proposals: Vec<Proposal>,
    ) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        if Self::read_run(&tx, &run.id)?.status != "running" {
            return Err(AppError::new("CANCELLED", "任务已停止。"));
        }
        let mut p = Self::load_conn(&tx, &run.project_id)?;
        let source = run
            .snapshot
            .project
            .chapter(&run.chapter_id)?
            .approved_version_id
            .clone();
        let ch = p.chapter_mut(&run.chapter_id)?;
        if ch.approved_version_id != source {
            return Err(AppError::new(
                "STALE_SOURCE",
                "正文确认版本已改变，请重新提取。",
            ));
        }
        ch.summary = summary;
        ch.summary_version_id = source;
        ch.summary_stale = false;
        for candidate in proposals {
            if !p.proposals.iter().any(|old| {
                old.source_version_id == candidate.source_version_id
                    && old.fact.predicate == candidate.fact.predicate
                    && old.fact.value == candidate.fact.value
                    && old.fact.excerpt == candidate.fact.excerpt
            }) {
                p.proposals.push(candidate);
            }
        }
        Self::persist(&tx, &mut p)?;
        run.status = "succeeded".into();
        tx.execute(
            "UPDATE runs SET status='succeeded',data=? WHERE id=?",
            params![serde_json::to_string(run)?, run.id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> Database {
        Database::open(Path::new(":memory:")).unwrap()
    }
    #[test]
    fn persistence_conflict_and_immutable_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.db");
        let db = Database::open(&path).unwrap();
        let p = db.create(fixture()).unwrap();
        let cid = p.chapters[0].id.clone();
        let p = db
            .save_working(&p.id, &cid, 0, "林舟左臂受伤，叶岚握着铜钥匙。".into())
            .unwrap();
        assert_eq!(
            db.save_working(&p.id, &cid, 0, "旧窗口".into())
                .unwrap_err()
                .code,
            "CONFLICT"
        );
        let p = db
            .save_version(&p.id, &cid, p.chapters[0].edit_revision, "")
            .unwrap();
        let v = p.chapters[0].versions[0].clone();
        assert!(db
            .lock()
            .unwrap()
            .execute(
                "UPDATE chapter_versions SET content='改写' WHERE id=?",
                [&v.id]
            )
            .is_err());
        drop(db);
        let db = Database::open(&path).unwrap();
        let loaded = db.load(&p.id).unwrap();
        assert_eq!(loaded.chapters[0].versions[0].content, v.content);
        assert_eq!(loaded.characters.len(), 2);
    }
    #[test]
    fn approval_gate_and_invalidation() {
        let db = db();
        let p = db.create(fixture()).unwrap();
        let cid = p.chapters[0].id.clone();
        let p = db
            .save_working(&p.id, &cid, 0, "叶岚持有钥匙。".into())
            .unwrap();
        let p = db
            .save_version(&p.id, &cid, p.chapters[0].edit_revision, "")
            .unwrap();
        let vid = p.chapters[0].current_version_id.clone();
        assert_eq!(
            db.approve(&p.id, &cid, &vid, "").unwrap_err().code,
            "REVIEW_REQUIRED"
        );
        let p = db.approve(&p.id, &cid, &vid, "人工核实，跳过审核").unwrap();
        assert_eq!(next_chapter(&p, &cid).unwrap(), p.chapters[1].id);
        let p = db
            .save_working(
                &p.id,
                &cid,
                p.chapters[0].edit_revision,
                "钥匙改为由林舟持有。".into(),
            )
            .unwrap();
        assert!(!p.chapters[0].approved());
        let p = db
            .save_version(&p.id, &cid, p.chapters[0].edit_revision, "")
            .unwrap();
        let p = db
            .approve(&p.id, &cid, &p.chapters[0].current_version_id, "人工核实")
            .unwrap();
        assert!(p.chapters[1].upstream_changed);
    }
    #[test]
    fn relation_validation_and_pending_memory() {
        let mut p = fixture();
        let original = p.facts.len();
        p.proposals.push(Proposal {
            id: id(),
            source_version_id: "missing".into(),
            fact: Fact {
                value: "新事实".into(),
                ..Fact::default()
            },
            status: "pending".into(),
            verified: true,
            conflict: String::new(),
        });
        assert_eq!(p.facts.len(), original);
        let prop = p.proposals[0].id.clone();
        assert_eq!(
            apply_mutation(
                &mut p,
                Mutation::Proposal {
                    proposal_id: prop,
                    accept: true
                }
            )
            .unwrap_err()
            .code,
            "STALE_SOURCE"
        );
        p.relations[0].end_order = Some(0);
        assert!(p.validate().is_err());
    }
}
