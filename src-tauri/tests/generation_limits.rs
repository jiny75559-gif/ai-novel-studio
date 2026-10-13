use novel_studio_lib::{
    context::*, engine::writing_preview, generation_limits::*, model::*, presets,
};
fn project() -> Project {
    let mut p = Project::new("预算检查".into());
    p.chapters.push(Chapter {
        goal: "在雨夜找到钥匙。".into(),
        ..Chapter::default()
    });
    p
}
#[test]
fn tight_context_short_timeout_and_insufficient_calls_are_visible() {
    let mut p = project();
    p.settings.target_chars = 8000;
    p.settings.context_tokens = 4000;
    p.settings.max_calls = 2;
    let provider = Provider {
        timeout_seconds: 20,
        max_tokens: 512,
        ..Provider::default()
    };
    let a = advice(&p, Some(&provider), &p.chapters[0].id);
    assert_eq!(a.scenes, 6);
    assert!(a.problems.len() >= 2);
    assert!(a.warnings.iter().any(|w| w.contains("20 秒")));
    assert!(a.warnings.iter().any(|w| w.contains("512 tokens")));
    assert!(a.suggested_context_tokens > 4000);
}
#[test]
fn later_scene_and_preset_expansion_are_included_in_budget() {
    let mut p = project();
    p.settings.target_chars = 8000;
    p.settings.context_tokens = 64000;
    let mut preset = presets::builtins().remove(0);
    preset.prompts[0].content = "{{lastmessage}}\n{{lastmessage}}".into();
    p.writing_preset = Some(preset);
    let cid = &p.chapters[0].id;
    let context = build_context(&p, cid).unwrap();
    let first = writing_preview(&p, cid, &context, 0, "")
        .unwrap()
        .estimated_tokens;
    let last = largest_writing_request(&p, cid, &context).unwrap();
    assert!(last > first + 12000);
    let provider = Provider::default();
    let a = advice(&p, Some(&provider), cid);
    assert_eq!(a.estimated_request_tokens, last + provider.max_tokens);
}
#[test]
fn disabled_preset_parameters_and_missing_model_do_not_fabricate_capacity() {
    let mut p = project();
    let mut preset = presets::builtins().remove(0);
    preset.parameters.max_tokens = Some(256);
    preset.use_parameters = false;
    p.writing_preset = Some(preset);
    let a = advice(&p, Some(&Provider::default()), &p.chapters[0].id);
    assert_eq!(a.output_tokens, 4096);
    let a = advice(&p, None, &p.chapters[0].id);
    assert_eq!(a.output_tokens, 0);
    assert_eq!(a.suggested_context_tokens, 0);
    assert!(!a.warnings.is_empty());
}
