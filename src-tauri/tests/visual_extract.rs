use novel_studio_lib::{
    model::*,
    visual::*,
    visual_extract::{apply, ChangeCandidate, Evidence as VisualEvidence, ProfileCandidate},
};

fn project() -> Project {
    let mut p = fixture();
    p.chapters[0].working =
        "林舟留着黑色短发，左眉有一道浅疤，穿深灰色外套。叶岚剪短了头发，换上蓝色外套。".into();
    p
}
fn evidence(p: &Project, excerpt: &str) -> VisualEvidence {
    VisualEvidence {
        chapter_id: p.chapters[0].id.clone(),
        excerpt: excerpt.into(),
        source_hash: hash(&p.chapters[0].working),
    }
}
fn candidate(p: &Project, n: usize) -> ProfileCandidate {
    ProfileCandidate {
        character_id: p.characters[n].id.clone(),
        name: p.characters[n].name.clone(),
        appearance: "黑色短发，左眉浅疤，深灰色外套".into(),
        evidence: vec![evidence(
            p,
            "林舟留着黑色短发，左眉有一道浅疤，穿深灰色外套。",
        )],
    }
}
#[test]
fn adopts_real_text_profile_without_changing_chapter_versions() {
    let mut p = project();
    let before = p.chapters.clone();
    let c = candidate(&p, 0);
    apply(&mut p, vec![c], vec![], false).unwrap();
    assert_eq!(
        p.visual_profiles[0].appearance,
        "黑色短发，左眉浅疤，深灰色外套"
    );
    assert_eq!(
        serde_json::to_value(&p.chapters).unwrap(),
        serde_json::to_value(before).unwrap()
    );
}
#[test]
fn stale_text_rejects_the_whole_batch_without_partial_profiles() {
    let mut p = project();
    let first = candidate(&p, 0);
    let second = candidate(&p, 1);
    p.chapters[0].working.push_str("作者改稿。");
    let before = serde_json::to_value(&p).unwrap();
    assert_eq!(
        apply(&mut p, vec![first, second], vec![], true)
            .unwrap_err()
            .code,
        "SOURCE_CHANGED"
    );
    assert_eq!(serde_json::to_value(&p).unwrap(), before);
}
#[test]
fn cannot_overwrite_a_confirmed_face_even_with_explicit_draft_overwrite() {
    let mut p = project();
    let c = candidate(&p, 0);
    let image = id();
    p.visual_profiles.push(VisualProfile {
        character_id: c.character_id.clone(),
        appearance: "已确认的外貌".into(),
        reference_image_id: image.clone(),
        revision: 3,
    });
    assert_eq!(
        apply(&mut p, vec![c], vec![], true).unwrap_err().code,
        "FIXED_PROFILE"
    );
    assert_eq!(p.visual_profiles[0].reference_image_id, image);
    assert_eq!(p.visual_profiles[0].revision, 3);
}
#[test]
fn current_text_changes_keep_the_reference_and_deduplicate() {
    let mut p = project();
    let cid = p.characters[1].id.clone();
    let image = id();
    p.visual_profiles.push(VisualProfile {
        character_id: cid.clone(),
        appearance: "长发".into(),
        reference_image_id: image.clone(),
        revision: 1,
    });
    let c = ChangeCandidate {
        character_id: cid,
        description: "短发，蓝色外套".into(),
        evidence: evidence(&p, "叶岚剪短了头发，换上蓝色外套。"),
    };
    apply(&mut p, vec![], vec![c.clone()], true).unwrap();
    apply(&mut p, vec![], vec![c], true).unwrap();
    assert_eq!(p.visual_changes.len(), 1);
    assert_eq!(p.visual_changes[0].start_order, 1);
    assert_eq!(p.visual_profiles[0].reference_image_id, image);
}
#[test]
fn author_can_adopt_new_characters_named_in_the_cited_text() {
    let mut p = project();
    p.chapters[0].working.push_str("顾青戴着银框眼镜。");
    let c = ProfileCandidate {
        character_id: "".into(),
        name: "顾青".into(),
        appearance: "银框眼镜".into(),
        evidence: vec![evidence(&p, "顾青戴着银框眼镜。")],
    };
    let count = p.characters.len();
    apply(&mut p, vec![c], vec![], true).unwrap();
    assert_eq!(p.characters.len(), count + 1);
    assert_eq!(p.characters.last().unwrap().name, "顾青");
    assert_eq!(
        p.visual_profiles[0].character_id,
        p.characters.last().unwrap().id
    );
}
#[test]
fn rejects_invented_citations_unknown_people_and_unapproved_draft_replacement() {
    let mut p = project();
    let original = candidate(&p, 0);
    let mut bad = original.clone();
    bad.evidence[0].excerpt = "原文不存在的银色头发。".into();
    assert!(apply(&mut p, vec![bad], vec![], true).is_err());
    let mut bad = original.clone();
    bad.character_id = id();
    assert!(apply(&mut p, vec![bad], vec![], true).is_err());
    apply(&mut p, vec![original.clone()], vec![], false).unwrap();
    assert_eq!(
        apply(&mut p, vec![original], vec![], false)
            .unwrap_err()
            .code,
        "PROFILE_EXISTS"
    );
}
