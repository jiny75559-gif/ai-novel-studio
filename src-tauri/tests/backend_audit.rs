use novel_studio_lib::{db::Database, model::*};
use rusqlite::params;
use serde_json::json;

fn run_for(p: &Project, status: &str) -> Run {
    Run {
        id: id(),
        project_id: p.id.clone(),
        chapter_id: p.chapters[0].id.clone(),
        task: "write".into(),
        status: status.into(),
        snapshot: Snapshot {
            project: p.clone(),
            chapter_id: p.chapters[0].id.clone(),
            outline_revision: p.chapters[0].outline_revision,
            edit_revision: p.chapters[0].edit_revision,
            context: ContextBundle {
                items: vec![],
                omitted: vec![],
                estimated_tokens: 0,
                hash: "audit".into(),
            },
            scene_count: 1,
            override_reason: String::new(),
            provider: Provider::default(),
            selected_issues: vec![],
        },
        segments: vec![],
        error: None,
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        created_at: now(),
        result_version_id: String::new(),
        recovered_from: String::new(),
    }
}

#[test]
fn restart_recovers_active_run_older_than_history_page() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("audit.sqlite3");
    let db = Database::open(&path).unwrap();
    let p = db.create(fixture()).unwrap();
    let mut active = run_for(&p, "running");
    active.segments.push(Segment {
        index: 0,
        status: "complete".into(),
        text: "已完成的场景".into(),
        finish_reason: "stop".into(),
        han_count: 6,
    });
    db.begin_run(&active).unwrap();
    for _ in 0..105 {
        db.begin_run(&run_for(&p, "failed")).unwrap();
    }
    assert_eq!(db.list_runs(None).unwrap().len(), 100);
    drop(db);
    let reopened = Database::open(&path).unwrap();
    let restored = reopened.run(&active.id).unwrap();
    assert_eq!(
        restored.status, "interrupted",
        "An old active task must not keep the global writer lock after restart"
    );
    assert_eq!(restored.segments[0].text, "已完成的场景");
    reopened
        .begin_run(&run_for(&reopened.load(&p.id).unwrap(), "running"))
        .unwrap();
}

#[test]
fn model_in_recycle_bin_cannot_be_deleted_before_project_is_restored() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("audit.sqlite3")).unwrap();
    let provider = Provider::default();
    db.store_provider(&provider).unwrap();
    let mut project = fixture();
    project.settings.writer_id = provider.id.clone();
    let project = db.create(project).unwrap();
    db.trash(&project.id, true).unwrap();
    let result = db.remove_provider(&provider.id);
    assert!(
        matches!(result, Err(ref e) if e.code == "MODEL_IN_USE"),
        "Deleting a referenced provider must not break a restored project: {result:?}"
    );
    db.trash(&project.id, false).unwrap();
    assert_eq!(
        db.load(&project.id).unwrap().settings.writer_id,
        provider.id
    );
    assert!(db.provider(&provider.id).is_ok());
}

#[test]
fn recycling_is_blocked_while_image_job_is_running() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("audit.sqlite3")).unwrap();
    let project = db.create(fixture()).unwrap();
    let jid = id();
    // Seed only the SQL fields checked by the recycle operation. No network or model calls.
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT INTO image_jobs VALUES(?,?,?,?)",
            params![jid, project.id, "running", json!({}).to_string()],
        )
        .unwrap();
    let result = db.trash(&project.id, true);
    assert!(
        matches!(result, Err(ref e) if e.code == "ALREADY_RUNNING"),
        "An active image task must retain its project: {result:?}"
    );
    assert!(db.load(&project.id).is_ok());
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE image_jobs SET status='cancelled' WHERE id=?",
            [&jid],
        )
        .unwrap();
    db.trash(&project.id, true).unwrap();
    db.trash(&project.id, false).unwrap();
    assert!(db.load(&project.id).is_ok());
}

#[test]
fn running_text_task_keeps_provider_after_project_switches_models() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("audit.sqlite3")).unwrap();
    let p = db.create(fixture()).unwrap();
    let mut run = run_for(&p, "running");
    let provider = Provider::default();
    db.store_provider(&provider).unwrap();
    run.snapshot.provider = provider.clone();
    db.begin_run(&run).unwrap();
    let result = db.remove_provider(&provider.id);
    assert!(
        matches!(result, Err(ref e) if e.code == "MODEL_IN_USE"),
        "Running task credentials must not be removed: {result:?}"
    );
    run.status = "cancelled".into();
    db.store_run(&run).unwrap();
    db.remove_provider(&provider.id).unwrap();
}

#[test]
fn referenced_image_config_is_preserved_in_active_and_recycled_projects() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("audit.sqlite3")).unwrap();
    let config = novel_studio_lib::visual::ImageConfig {
        mode: "cloud".into(),
        base_url: "https://example.com/v1".into(),
        model_id: "mock".into(),
        ..Default::default()
    };
    db.save_image_config(&config).unwrap();
    let mut p = fixture();
    p.visual_settings.provider_id = config.id.clone();
    let p = db.create(p).unwrap();
    for deleted in [false, true] {
        db.trash(&p.id, deleted).unwrap();
        let result = db.delete_image_config(&config.id);
        assert!(
            matches!(result, Err(ref e) if e.code == "MODEL_IN_USE"),
            "Referenced image provider must be retained: {result:?}"
        );
        assert!(db.image_config(&config.id).is_ok());
    }
    db.trash(&p.id, false).unwrap();
    let mut settings = p.visual_settings.clone();
    settings.provider_id.clear();
    db.mutate(&p.id, p.revision, Mutation::VisualSettings { settings })
        .unwrap();
    db.delete_image_config(&config.id).unwrap();
}

#[test]
fn running_image_job_keeps_config_after_project_switches_provider() {
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("audit.sqlite3")).unwrap();
    let project = db.create(fixture()).unwrap();
    let config = novel_studio_lib::visual::ImageConfig {
        mode: "cloud".into(),
        base_url: "https://example.com/v1".into(),
        model_id: "mock".into(),
        ..Default::default()
    };
    db.save_image_config(&config).unwrap();
    let jid = id();
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT INTO image_jobs VALUES(?,?,?,?)",
            params![
                jid,
                project.id,
                "running",
                json!({"config":config}).to_string()
            ],
        )
        .unwrap();
    let result = db.delete_image_config(&config.id);
    assert!(
        matches!(result, Err(ref e) if e.code == "MODEL_IN_USE"),
        "Running image credentials must be retained: {result:?}"
    );
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE image_jobs SET status='cancelled' WHERE id=?",
            [&jid],
        )
        .unwrap();
    db.delete_image_config(&config.id).unwrap();
}
