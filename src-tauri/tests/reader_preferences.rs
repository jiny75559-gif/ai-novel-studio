use novel_studio_lib::{
    app_preferences::{AppPreferences, AppPreferencesPatch},
    db::Database,
    model::{now, Project},
    reader_marks::{upsert, ReadingMark},
};

#[test]
fn preference_patches_survive_reopen_without_overwriting_other_components() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("preferences.db");
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.load_app_preferences().unwrap(),
        AppPreferences::default()
    );
    db.save_app_preferences(AppPreferencesPatch {
        main_nav_collapsed: Some(true),
        ..Default::default()
    })
    .unwrap();
    db.save_app_preferences(AppPreferencesPatch {
        reader_nav_collapsed: Some(true),
        ..Default::default()
    })
    .unwrap();
    drop(db);
    let db = Database::open(&path).unwrap();
    let prefs = db.load_app_preferences().unwrap();
    assert!(prefs.main_nav_collapsed && prefs.reader_nav_collapsed);
    let prefs = db
        .save_app_preferences(AppPreferencesPatch {
            main_nav_collapsed: Some(false),
            ..Default::default()
        })
        .unwrap();
    assert!(!prefs.main_nav_collapsed && prefs.reader_nav_collapsed);
    assert!(serde_json::from_str::<AppPreferencesPatch>(r#"{"unknown":true}"#).is_err());
}

#[test]
fn host_owns_mark_timestamps_and_preserves_unknown_legacy_creation() {
    let mut p = Project::new("时间验证".into());
    p.chapters.push(novel_studio_lib::model::Chapter::default());
    p.chapters[0].working = "风吹过港口".into();
    let mut mark = ReadingMark {
        chapter_id: p.chapters[0].id.clone(),
        start: 0,
        end: 2,
        quote: "风吹".into(),
        created_at: 1,
        updated_at: u64::MAX,
        ..Default::default()
    };
    let before = now();
    upsert(&mut p, mark.clone()).unwrap();
    let created = p.reading_marks[0].created_at;
    assert!(created >= before && created <= now());
    assert_eq!(created, p.reading_marks[0].updated_at);
    mark.note = "修改备注".into();
    mark.created_at = 99;
    upsert(&mut p, mark.clone()).unwrap();
    assert_eq!(p.reading_marks[0].created_at, created);
    assert!(p.reading_marks[0].updated_at >= created);
    let mut legacy = serde_json::to_value(&p.reading_marks[0]).unwrap();
    legacy.as_object_mut().unwrap().remove("createdAt");
    legacy.as_object_mut().unwrap().remove("updatedAt");
    let legacy: ReadingMark = serde_json::from_value(legacy).unwrap();
    assert_eq!(legacy.created_at, 0);
    p.reading_marks[0] = legacy;
    upsert(&mut p, mark).unwrap();
    assert_eq!(p.reading_marks[0].created_at, 0);
    assert!(p.reading_marks[0].updated_at >= before);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("marks.db");
    let db = Database::open(&path).unwrap();
    let p = db.create(p).unwrap();
    drop(db);
    let restored = Database::open(&path).unwrap().load(&p.id).unwrap();
    assert_eq!(restored.reading_marks, p.reading_marks);
}

#[test]
fn dense_typography_is_valid_but_out_of_range_values_are_rejected() {
    let mut p = Project::new("紧凑阅读".into());
    p.reader.font_size = 12;
    p.reader.line_height = 1.0;
    p.reader.page_margin = 8;
    p.reader.paragraph_spacing = 0;
    p.validate().unwrap();
    let old = serde_json::json!({"fontSize":22,"lineHeight":1.9});
    let state: novel_studio_lib::reading::ReaderState = serde_json::from_value(old).unwrap();
    state.validate(&p).unwrap();
    p.reader.font_size = 11;
    assert!(p.validate().is_err());
    p.reader.font_size = 48;
    p.reader.line_height = 2.8;
    p.reader.page_margin = 96;
    p.reader.paragraph_spacing = 48;
    p.validate().unwrap();
    p.reader.line_height = f64::NAN;
    assert!(p.validate().is_err());
}

#[test]
fn reading_modes_and_page_styles_roundtrip_without_changing_anchors_or_history() {
    use novel_studio_lib::{files, model::Chapter};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reader-modes.db");
    let db = Database::open(&path).unwrap();
    let mut p = Project::new("阅读模式与页眉".into());
    p.chapters.push(Chapter {
        working: "灯塔😀旁的信笺".into(),
        ..Default::default()
    });
    let p = db.create(p).unwrap();
    let mut state = p.reader.clone();
    state.chapter_id = p.chapters[0].id.clone();
    state.offset = 4; // UTF-16 offset, including a surrogate pair.
    state.reading_mode = "scroll".into();
    state.title_style.enabled = true;
    state.title_style.font_family = "SimSun".into();
    state.title_style.font_size = 56;
    state.title_style.space_after = 80;
    state.header.center = "book-page".into();
    state.footer.right = "progress".into();
    let saved = db.save_reader(&p.id, state).unwrap();
    assert_eq!(saved.offset, 4);
    assert_eq!(saved.layout, "double");
    drop(db);
    let db = Database::open(&path).unwrap();
    let restored = db.load(&p.id).unwrap();
    assert_eq!(restored.reader.reading_mode, "scroll");
    assert_eq!(restored.reader.title_style, saved.title_style);
    assert_eq!(restored.reader.header, saved.header);
    assert_eq!(restored.reader.footer, saved.footer);
    assert_eq!(restored.chapters[0].working, p.chapters[0].working);
    assert_eq!(restored.chapters[0].versions.len(), 0);
    assert_eq!(restored.revision, p.revision);

    let backup = dir.path().join("reader.zip");
    files::export_package(&db, &p.id, &backup).unwrap();
    let imported = files::read_package(&backup).unwrap();
    assert_ne!(imported.chapters[0].id, p.chapters[0].id);
    assert_eq!(imported.reader.chapter_id, imported.chapters[0].id);
    assert_eq!(imported.reader.offset, 4);
    assert_eq!(imported.reader.reading_mode, "scroll");
    assert_eq!(imported.reader.title_style, saved.title_style);
    assert_eq!(imported.reader.header, saved.header);
}

#[test]
fn old_readers_default_to_paged_and_invalid_new_styles_do_not_replace_saved_state() {
    use novel_studio_lib::{model::Chapter, reading::ReaderState};
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("validation.db")).unwrap();
    let mut p = Project::new("旧阅读设置".into());
    p.chapters.push(Chapter::default());
    let p = db.create(p).unwrap();
    let old: ReaderState = serde_json::from_value(serde_json::json!({
        "layout":"single", "fontSize":22
    }))
    .unwrap();
    assert_eq!(old.reading_mode, "paged");
    assert!(!old.title_style.enabled);
    assert_eq!(old.header.left, "book-title");
    assert_eq!(old.footer.center, "chapter-page");
    let saved = db.save_reader(&p.id, old).unwrap();
    let invalid = [
        ("readingMode", serde_json::json!("vertical")),
        ("layout", serde_json::json!("scroll")),
        (
            "titleStyle",
            serde_json::json!({"fontFamily":"C:/untrusted.ttf"}),
        ),
        ("titleStyle", serde_json::json!({"fontSize":57})),
        ("titleStyle", serde_json::json!({"fontWeight":999})),
        ("titleStyle", serde_json::json!({"spaceBefore":81})),
        ("titleStyle", serde_json::json!({"align":"justify"})),
        (
            "header",
            serde_json::json!({"enabled":true,"left":"<script>","center":"none","right":"none","fontSize":10}),
        ),
        (
            "footer",
            serde_json::json!({"enabled":true,"left":"none","center":"chapter-page","right":"none","fontSize":19}),
        ),
    ];
    for (field, value) in invalid {
        let mut json = serde_json::to_value(&saved).unwrap();
        json[field] = value;
        let invalid: ReaderState = serde_json::from_value(json).unwrap();
        assert_eq!(
            db.save_reader(&p.id, invalid).unwrap_err().code,
            "VALIDATION"
        );
        assert_eq!(
            serde_json::to_value(db.load(&p.id).unwrap().reader).unwrap(),
            serde_json::to_value(&saved).unwrap()
        );
    }
    for value in [
        serde_json::json!({"readingMode":null}),
        serde_json::json!({"titleStyle":{"unknown":true}}),
        serde_json::json!({"header":{"enabled":true,"left":"none","center":"none","right":"none","fontSize":10,"template":"x"}}),
    ] {
        assert!(serde_json::from_value::<ReaderState>(value).is_err());
    }
}

#[test]
fn pdf_scroll_uses_original_page_anchor_and_preserves_progress() {
    use novel_studio_lib::reading;
    let dir = tempfile::tempdir().unwrap();
    let db = Database::open(&dir.path().join("pdf-modes.db")).unwrap();
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/illustrated.pdf");
    let (p, media) = reading::pdf_document(&fixture).unwrap();
    let p = db.create_with_media(p, &[media]).unwrap();
    let mut state = p.reader.clone();
    state.reading_mode = "scroll".into();
    state.total_pages = 8;
    state.offset = 3;
    db.save_reader(&p.id, state.clone()).unwrap();
    let loaded = db.load(&p.id).unwrap();
    assert_eq!(loaded.reader.offset, 3);
    assert_eq!(reading::progress(&loaded), 0.5);
    state.reading_mode = "paged".into();
    db.save_reader(&p.id, state).unwrap();
    assert_eq!(reading::progress(&db.load(&p.id).unwrap()), 0.5);
}
