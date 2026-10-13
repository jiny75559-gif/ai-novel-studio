use novel_studio_lib::{
    context::*, db::Database, engine::writing_preview, model::*, presets::*, provider::*,
};
use serde_json::json;

fn preset() -> WritingPreset {
    import_json(&json!({"name":"兼容检查","temperature":0.35,"top_p":0.8,"openai_max_tokens":2048,"prompts":[
        {"identifier":"main","name":"主提示词","role":"system","content":"写{{chapterTitle}}，作者{{user}}。{{setvar::tone::克制}}{{getvar::tone}}"},
        {"identifier":"off","name":"已关闭","role":"user","content":"绝不发送此条"},
        {"identifier":"late","name":"后置","role":"system","content":"正文结尾标记 QA-END"},
        {"identifier":"deep","name":"深度","role":"assistant","content":"深度检查","injection_position":1,"injection_depth":1,"injection_order":20}
    ],"prompt_order":[{"character_id":100001,"order":[{"identifier":"off","enabled":true},{"identifier":"main","enabled":true}]},{"character_id":100000,"order":[{"identifier":"main","enabled":true},{"identifier":"off","enabled":false},{"identifier":"chatHistory","enabled":true},{"identifier":"late","enabled":true},{"identifier":"deep","enabled":true}]}]}).to_string(), "preset").unwrap()
}

#[test]
fn imports_real_order_groups_switches_roles_and_depth() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    p.writing_preset = Some(preset());
    let cid = &p.chapters[0].id;
    let context = build_context(&p, cid).unwrap();
    let out = writing_preview(&p, cid, &context, 0, "").unwrap();
    assert!(out.can_generate);
    let text = out
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!text.contains("绝不发送此条"));
    assert!(text.contains("克制"));
    assert!(!text.contains("{{chapterTitle}}"));
    let deep = out
        .messages
        .iter()
        .position(|m| m.content == "深度检查")
        .unwrap();
    let task = out
        .messages
        .iter()
        .position(|m| m.content.contains("任务 WRITE_SCENE"))
        .unwrap();
    assert_eq!(out.messages[deep].role, "assistant");
    assert_eq!(deep + 1, task);
    assert_eq!(out.messages.last().unwrap().content, "正文结尾标记 QA-END");
    p.writing_preset.as_mut().unwrap().active_order = 0;
    let out = writing_preview(&p, cid, &build_context(&p, cid).unwrap(), 0, "").unwrap();
    assert!(out
        .messages
        .iter()
        .any(|m| m.role == "user" && m.content == "绝不发送此条"));
}

#[test]
fn disabled_data_markers_preserve_outline_canon_and_author_edits() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    let mut s = builtins().remove(0);
    for o in &mut s.orders[0].order {
        o.enabled = false;
    }
    p.writing_preset = Some(s);
    let c = build_context(&p, &p.chapters[1].id).unwrap();
    let out = writing_preview(&p, &p.chapters[1].id, &c, 0, "").unwrap();
    let text = out
        .messages
        .iter()
        .map(|m| m.content.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(text.contains("24 小时"));
    assert!(text.contains("左臂受伤"));
    assert!(text.contains(&p.chapters[1].goal));
    assert!(out.warnings.iter().any(|w| w.contains("补齐")));
}

#[test]
fn imports_prompt_list_system_prompt_and_legacy_formats() {
    for v in [
        json!({"version":1,"type":"full","data":{"prompts":[{"identifier":"custom","name":"规则","role":"user","content":"自定义规范"}],"prompt_order":[{"identifier":"main","enabled":true},{"identifier":"chatHistory","enabled":true},{"identifier":"custom","enabled":true}]}}),
        json!({"name":"系统","content":"用具体动作写作。"}),
        json!({"sysprompt":{"name":"系统","content":"遵循作者大纲。"},"instruct":{"input_sequence":"<user>"}}),
        json!({"main_prompt":"作者规范","jailbreak_prompt":"后置规范"}),
    ] {
        let p = import_json(&v.to_string(), "file").unwrap();
        p.validate().unwrap();
        let exported = export_json(&p, true).unwrap();
        let back = import_json(&exported, "roundtrip").unwrap();
        assert_eq!(
            serde_json::to_value(&p.prompts).unwrap(),
            serde_json::to_value(&back.prompts).unwrap()
        );
    }
    assert_eq!(
        import_json(r#"{"top_k":50}"#, "file").unwrap_err().code,
        "PRESET_FORMAT"
    );
}

#[test]
fn nested_variable_macros_obey_order_and_do_not_execute_story_text() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    let mut s = builtins().remove(0);
    s.prompts.iter_mut().find(|e|e.identifier=="main").unwrap().content="{{setvar::name::tone}}{{setvar::{{getvar::name}}::自然}}{{//{{setvar::tone::坏}}}}{{getvar::tone}} {{incvar::count}} {{incvar::count}} {{addvar::count::3}}{{getvar::count}} {{chapterNumber}}".into();
    p.outline = "剧情里出现字面量 {{setvar::tone::故事不得执行}}。".into();
    p.writing_preset = Some(s);
    let cid = &p.chapters[0].id;
    let context = build_context(&p, cid).unwrap();
    for _ in 0..2 {
        let out = writing_preview(&p, cid, &context, 0, "").unwrap();
        assert!(out.messages.iter().any(|m| m.content == "自然 1 2 5 1"));
        assert!(out
            .messages
            .iter()
            .any(|m| m.content.contains("{{setvar::tone::故事不得执行}}")));
    }
}

#[test]
fn unsupported_macros_can_pause_or_remain_literal_by_author_choice() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    let mut s = builtins().remove(0);
    s.prompts[0].content = "{{unsupported_plugin::foo}}".into();
    p.writing_preset = Some(s);
    let cid = p.chapters[0].id.clone();
    let context = build_context(&p, &cid).unwrap();
    let out = writing_preview(&p, &cid, &context, 0, "").unwrap();
    assert!(!out.can_generate);
    assert_eq!(out.unresolved_macros, vec!["unsupported_plugin::foo"]);
    p.writing_preset.as_mut().unwrap().block_unknown_macros = false;
    assert!(
        writing_preview(&p, &cid, &context, 0, "")
            .unwrap()
            .can_generate
    );
}

#[test]
fn invalid_imports_do_not_change_library_and_no_connections_are_copied() {
    let db = Database::open(std::path::Path::new(":memory:")).unwrap();
    let count = db.writing_presets().unwrap().len();
    for v in [
        json!({"prompts":[{"identifier":"a","role":"admin"}]}),
        json!({"prompts":[{"identifier":"a"},{"identifier":"a"}]}),
        json!({"prompts":[{"identifier":"a"}],"prompt_order":[{"character_id":100000,"order":[{"identifier":"missing","enabled":true}]}]}),
    ] {
        assert!(import_json(&v.to_string(), "bad").is_err());
    }
    assert_eq!(db.writing_presets().unwrap().len(), count);
    let mut v =
        serde_json::from_str::<serde_json::Value>(&export_json(&preset(), true).unwrap()).unwrap();
    v["reverse_proxy"] = json!("https://unrelated.example");
    v["proxy_password"] = json!("PRIVATE-KEY");
    v["custom_include_headers"] = json!("Authorization: secret");
    let imported = import_json(&v.to_string(), "connections").unwrap();
    assert!(!serde_json::to_string(&imported)
        .unwrap()
        .contains("PRIVATE-KEY"));
    assert!(imported.import_warnings.iter().any(|s| s.contains("凭据")));
}

#[test]
fn library_project_binding_backup_and_restart_remain_independent() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("test.sqlite3");
    let mut s = preset();
    let pid;
    let original = serde_json::to_value(&s).unwrap();
    {
        let db = Database::open(&path).unwrap();
        db.save_writing_preset(&s).unwrap();
        let mut p = fixture();
        p.writing_preset = Some(s.clone());
        let p = db.create(p).unwrap();
        pid = p.id;
        s.name = "修改预设库名称".into();
        db.save_writing_preset(&s).unwrap();
        assert_eq!(
            serde_json::to_value(db.load(&pid).unwrap().writing_preset.unwrap()).unwrap(),
            original
        );
        novel_studio_lib::files::export_package(&db, &pid, &dir.path().join("book.zip")).unwrap();
        let imported = novel_studio_lib::files::read_package(&dir.path().join("book.zip")).unwrap();
        let imported = db
            .create(novel_studio_lib::files::remap_project(imported).unwrap())
            .unwrap();
        assert_eq!(
            serde_json::to_value(imported.writing_preset.unwrap()).unwrap(),
            original
        );
    }
    let db = Database::open(&path).unwrap();
    assert_eq!(
        db.load(&pid).unwrap().writing_preset.unwrap().name,
        "兼容检查"
    );
    assert!(db
        .writing_presets()
        .unwrap()
        .iter()
        .any(|s| s.name == "修改预设库名称"));
}

#[test]
fn generation_triggers_and_reviewer_formats_do_not_compete() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    let mut s = builtins().remove(0);
    s.prompts[0].injection_trigger = vec!["continue".into()];
    s.prompts[0].content = "只在后续场景发送".into();
    p.writing_preset = Some(s);
    let cid = &p.chapters[0].id;
    let context = build_context(&p, cid).unwrap();
    assert!(!writing_preview(&p, cid, &context, 0, "")
        .unwrap()
        .messages
        .iter()
        .any(|m| m.content == "只在后续场景发送"));
    assert!(writing_preview(&p, cid, &context, 1, "已完成的场景")
        .unwrap()
        .messages
        .iter()
        .any(|m| m.content == "只在后续场景发送"));
    let review = context_for_task(&p, cid, "review").unwrap();
    assert!(review.items.iter().any(|i| i.label == "作者写作预设规范"));
    let remember = context_for_task(&p, cid, "remember").unwrap();
    assert!(!remember.items.iter().any(|i| i.id.starts_with("preset:")));
}

#[test]
fn incomplete_api_configuration_can_persist_but_calls_need_model_id() {
    let mut p = Provider {
        base_url: "http://127.0.0.1:9000/v1".into(),
        allow_local_http: true,
        ..Provider::default()
    };
    assert!(connection_endpoint(&p).is_ok());
    assert_eq!(endpoint(&p).unwrap_err().code, "NO_MODEL_ID");
    let db = Database::open(std::path::Path::new(":memory:")).unwrap();
    db.store_provider(&p).unwrap();
    assert!(db.provider(&p.id).unwrap().model_id.is_empty());
    assert!(Secrets::new().for_provider(&p).unwrap().is_empty());
    p.allow_local_http = false;
    assert!(Secrets::new().for_provider(&p).is_err());
}

#[test]
fn export_uses_selected_order_and_only_enabled_parameter_overrides() {
    let mut p = preset();
    p.active_order = 0;
    p.use_parameters = false;
    let v: serde_json::Value = serde_json::from_str(&export_json(&p, true).unwrap()).unwrap();
    assert!(v.get("temperature").is_none());
    let global = v["prompt_order"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["character_id"] == 100000)
        .unwrap();
    assert_eq!(
        global["order"],
        serde_json::to_value(&p.orders[0].order).unwrap()
    );
    let restored = import_json(&export_json(&p, false).unwrap(), "完整导入").unwrap();
    assert_eq!(restored.active_order, p.active_order);
    assert_eq!(restored.parameters, p.parameters);
    assert!(!restored.use_parameters);
}

#[test]
fn preview_does_not_silently_drop_unknown_original_or_send_null_parameters() {
    let mut p = fixture();
    p.settings.context_tokens = 64000;
    let mut s = builtins().remove(0);
    s.prompts[0].content = "{{original}}".into();
    p.writing_preset = Some(s);
    let cid = &p.chapters[0].id;
    let mut preview = writing_preview(&p, cid, &build_context(&p, cid).unwrap(), 0, "").unwrap();
    assert!(!preview.can_generate);
    assert_eq!(preview.unresolved_macros, vec!["original"]);
    let provider = Provider {
        model_id: "fixture".into(),
        temperature: None,
        max_tokens: 300,
        ..Provider::default()
    };
    apply_provider_to_preview(&mut preview, &p, &provider);
    assert!(preview.parameters.get("temperature").is_none());
    assert_eq!(preview.parameters["max_tokens"], 300);
    assert!(preview.warnings.iter().any(|s| s.contains("可能截断")));
}
