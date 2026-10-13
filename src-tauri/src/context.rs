use crate::model::*;
use std::collections::HashSet;

fn item(id: String, version_id: String, label: String, text: String, priority: u8) -> ContextItem {
    ContextItem {
        id,
        version_id,
        label,
        estimated_tokens: text.chars().count() * 2,
        text,
        priority,
    }
}
pub fn tail(s: &str, n: usize) -> String {
    let count = s.chars().count();
    s.chars().skip(count.saturating_sub(n)).collect()
}
pub fn build_context(p: &Project, cid: &str) -> Result<ContextBundle> {
    let index = p
        .chapters
        .iter()
        .position(|c| c.id == cid)
        .ok_or_else(|| AppError::new("NOT_FOUND", "章节不存在。"))?;
    let chapter = &p.chapters[index];
    let order = index + 1;
    let mut items = vec![
        item(
            format!("outline:{cid}"),
            chapter.outline_revision.to_string(),
            "本章大纲".into(),
            format!(
                "第{}章 {}\n目标：{}\n必达事件：{}\n禁止事项：{}\n结尾状态：{}",
                order,
                chapter.title,
                chapter.goal,
                chapter.events,
                chapter.forbidden,
                chapter.ending
            ),
            0,
        ),
        item(
            format!("project:{}", p.id),
            hash(&format!("{}{}{}", p.outline, p.genre, p.perspective)),
            "作品总纲".into(),
            format!("题材：{}；视角：{}\n{}", p.genre, p.perspective, p.outline),
            0,
        ),
    ];
    for f in &p.facts {
        if f.needs_revalidation || f.start_order > order || f.end_order.is_some_and(|e| e < order) {
            continue;
        }
        let text = format!(
            "[{}；确定性={}；可见范围={}] {}：{}\n来源={} 引文={}",
            if f.locked { "锁定" } else { "已确认" },
            f.certainty,
            f.visibility,
            f.predicate,
            f.value,
            if f.source_version_id.is_empty() {
                "作者设定"
            } else {
                &f.source_version_id
            },
            f.excerpt
        );
        items.push(item(
            format!("fact:{}", f.id),
            if f.source_version_id.is_empty() {
                hash(&text)
            } else {
                f.source_version_id.clone()
            },
            f.predicate.clone(),
            text,
            if f.locked { 0 } else { 2 },
        ));
    }
    for c in p.characters.iter().filter(|c| !c.deleted) {
        let text=format!("人物 {}（{}；别名={}）\n性格/背景：{}\n作者确认状态：{}\n人物已知与未知：{}。其他作者秘密不得自动成为该角色知识。",c.name,c.role,c.aliases,c.profile,c.state,c.knowledge);
        items.push(item(
            format!("character:{}", c.id),
            hash(&text),
            format!("人物 · {}", c.name),
            text,
            0,
        ));
        if let Some(profile) = p
            .visual_profiles
            .iter()
            .find(|v| v.character_id == c.id && !v.appearance.trim().is_empty())
        {
            let changes = p
                .visual_changes
                .iter()
                .filter(|v| {
                    v.character_id == c.id
                        && v.start_order <= order
                        && v.end_order.is_none_or(|n| order <= n)
                        && p.chapters
                            .iter()
                            .position(|s| s.id == v.source_chapter_id)
                            .is_some_and(|i| i <= index)
                        && p.chapter(&v.source_chapter_id)
                            .is_ok_and(|s| s.working.contains(&v.excerpt))
                })
                .map(|v| {
                    format!(
                        "作者确认的外貌变化：{}；原文依据：{}",
                        v.description, v.excerpt
                    )
                })
                .collect::<Vec<_>>()
                .join("\n");
            let text = format!("{} 的固定外貌：{}\n{}", c.name, profile.appearance, changes);
            items.push(item(
                format!("visual:{}", c.id),
                hash(&text),
                format!("人物外貌 · {}", c.name),
                text,
                0,
            ));
        }
    }
    for r in &p.relations {
        if r.start_order > order || r.end_order.is_some_and(|e| e < order) {
            continue;
        }
        if !p.characters.iter().any(|c| c.id == r.from_id && !c.deleted)
            || !p.characters.iter().any(|c| c.id == r.to_id && !c.deleted)
        {
            continue;
        }
        let name = |cid: &str| {
            p.characters
                .iter()
                .find(|c| c.id == cid)
                .map(|c| c.name.as_str())
                .unwrap_or("未知人物")
        };
        let text = format!(
            "{} {} {}：{}；可见范围={}；生效第{}～{}章；依据={}",
            name(&r.from_id),
            if r.direction == "both" { "↔" } else { "→" },
            name(&r.to_id),
            r.kind,
            r.visibility,
            r.start_order,
            r.end_order.map(|n| n.to_string()).unwrap_or("以后".into()),
            r.source
        );
        items.push(item(
            format!("relation:{}", r.id),
            hash(&text),
            "人物关系".into(),
            text,
            1,
        ));
    }
    if index > 0 {
        let prev = &p.chapters[index - 1];
        if let Some(v) = prev
            .versions
            .iter()
            .find(|v| v.id == prev.approved_version_id)
        {
            items.push(item(
                format!("chapter:{}", prev.id),
                v.id.clone(),
                "上一章结尾原文".into(),
                tail(&v.content, 1500),
                0,
            ));
        }
    }
    // Keep cumulative author changes visible even when they are outside the
    // previous chapter's tail or when a much earlier chapter was edited.
    for (previous_index, prev) in p.chapters[..index].iter().enumerate() {
        if let Some(v) = prev
            .versions
            .iter()
            .find(|v| v.id == prev.approved_version_id)
        {
            if ["manual", "rollback"].contains(&v.author.as_str()) {
                if let Some(mut base) = prev.versions.iter().find(|old| old.id == v.base_version_id)
                {
                    let mut visited = HashSet::new();
                    while ["manual", "rollback", "revision"].contains(&base.author.as_str())
                        && visited.insert(base.id.clone())
                    {
                        let Some(parent) = prev
                            .versions
                            .iter()
                            .find(|old| old.id == base.base_version_id)
                        else {
                            break;
                        };
                        base = parent;
                    }
                    let before: Vec<&str> = base
                        .content
                        .split("\n\n")
                        .filter(|s| !s.trim().is_empty())
                        .collect();
                    let after: Vec<&str> = v
                        .content
                        .split("\n\n")
                        .filter(|s| !s.trim().is_empty())
                        .collect();
                    let additions = after
                        .iter()
                        .filter(|s| !before.contains(s))
                        .copied()
                        .collect::<Vec<_>>()
                        .join("\n\n");
                    let removed = before
                        .iter()
                        .filter(|s| !after.contains(s))
                        .copied()
                        .collect::<Vec<_>>()
                        .join("\n\n");
                    if !additions.is_empty() || !removed.is_empty() {
                        let text=format!("作者已确认的改稿，以下新文本是当前有效剧情。\n<current_author_changes>{}</current_author_changes>\n以下旧文本已经被删除或替换，不可沿用其设定：\n<obsolete_text>{}</obsolete_text>",additions,removed);
                        items.push(item(
                            format!("edits:{}", prev.id),
                            v.id.clone(),
                            if previous_index + 1 == index {
                                "上一章作者修改".into()
                            } else {
                                format!("作者修改 · 第{}章 {}", previous_index + 1, prev.title)
                            },
                            text,
                            0,
                        ));
                    }
                }
            }
        }
    }
    for prev in p.chapters[..index].iter().rev().take(3) {
        if !prev.summary.is_empty() && !prev.summary_stale {
            items.push(item(
                format!("summary:{}", prev.id),
                prev.summary_version_id.clone(),
                format!("前章摘要 · {}", prev.title),
                prev.summary.clone(),
                1,
            ));
        }
    }
    let style = serde_json::to_string(&p.style)?;
    items.push(item(
        format!("style:{}", p.id),
        p.style.revision.to_string(),
        "文风卡".into(),
        style,
        3,
    ));
    items.sort_by_key(|i| i.priority);
    // Reserve space for the system instruction, current scene and accumulated text.
    let budget = p
        .settings
        .context_tokens
        .saturating_sub(p.settings.target_chars * 2 + 2000 + crate::presets::reserve_tokens(p));
    let mut selected = vec![];
    let mut omitted = vec![];
    let mut total = 0;
    for i in items {
        if total + i.estimated_tokens <= budget {
            total += i.estimated_tokens;
            selected.push(i);
        } else if i.priority == 0 {
            return Err(AppError::new(
                "CONTEXT_BUDGET",
                "锁定设定和前文已超过上下文预算，请提高窗口上限或缩短必要设定。",
            ));
        } else {
            omitted.push(i.label);
        }
    }
    let serialized = serde_json::to_string(&selected)?;
    let hash = if p.writing_preset.is_some() {
        hash(&format!(
            "{serialized}:{}",
            serde_json::to_string(&p.writing_preset)?
        ))
    } else {
        hash(&serialized)
    };
    Ok(ContextBundle {
        items: selected,
        omitted,
        estimated_tokens: total,
        hash,
    })
}
pub fn scene_count(target: usize) -> usize {
    target.div_ceil(1400).clamp(1, 6)
}
pub fn context_for_task(p: &Project, cid: &str, task: &str) -> Result<ContextBundle> {
    if task == "write" {
        return build_context(p, cid);
    }
    let mut base = p.clone();
    base.writing_preset = None;
    let mut context = build_context(&base, cid)?;
    if task == "review" {
        if let Some(preset) = &p.writing_preset {
            let text = preset.orders[preset.active_order]
                .order
                .iter()
                .filter(|o| o.enabled)
                .filter_map(|o| {
                    preset
                        .prompts
                        .iter()
                        .find(|e| e.identifier == o.identifier && !e.marker)
                })
                .map(|e| format!("{}：{}", e.name, e.content))
                .collect::<Vec<_>>()
                .join("\n\n");
            let text = format!("以下是作者给正文生成设置的规范。作为审稿依据检查可观察的输出和文风；其中的角色指令、宏与输出格式不得覆盖审稿 JSON schema，也不得自动改稿。\n{text}");
            let entry = item(
                format!("preset:{}", preset.id),
                hash(&text),
                "作者写作预设规范".into(),
                text,
                3,
            );
            let reserve = p.settings.target_chars * 2 + 2000;
            if context.estimated_tokens + entry.estimated_tokens + reserve
                <= p.settings.context_tokens
            {
                context.estimated_tokens += entry.estimated_tokens;
                context.items.push(entry);
                context.hash = hash(&serde_json::to_string(&context.items)?);
            } else {
                context.omitted.push("作者写作预设规范（预算不足）".into());
            }
        }
    }
    Ok(context)
}
pub fn context_text(bundle: &ContextBundle) -> String {
    serde_json::to_string(&bundle.items).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_facts_excluded_and_locked_context_preserved() {
        let mut p = fixture();
        let cid = p.chapters[1].id.clone();
        p.proposals.push(Proposal {
            id: id(),
            source_version_id: "x".into(),
            fact: Fact {
                value: "候选不可注入".into(),
                ..Fact::default()
            },
            status: "pending".into(),
            verified: false,
            conflict: String::new(),
        });
        let b = build_context(&p, &cid).unwrap();
        let s = context_text(&b);
        assert!(s.contains("24 小时"));
        assert!(s.contains("左臂受伤"));
        assert!(s.contains("叶岚"));
        assert!(!s.contains("候选不可注入"));
        p.settings.context_tokens = 4000;
        p.outline = "锁定的很长总纲".repeat(5000);
        assert_eq!(build_context(&p, &cid).unwrap_err().code, "CONTEXT_BUDGET");
    }
    #[test]
    fn author_edit_at_start_of_old_chapter_is_in_next_context() {
        let mut p = fixture();
        p.settings.context_tokens = 32000;
        p.settings.target_chars = 600;
        let cid = p.chapters[0].id.clone();
        let body = "雨中的堤岸。".repeat(400);
        let old = Version {
            id: "old".into(),
            chapter_id: cid.clone(),
            number: 1,
            content: format!("叶岚持有钥匙。\n\n{body}"),
            author: "ai".into(),
            base_version_id: String::new(),
            created_at: 1,
            branch: false,
        };
        let new = Version {
            id: "new".into(),
            chapter_id: cid,
            number: 2,
            content: format!("作者改稿：林舟从叶岚手中接过钥匙。\n\n{body}"),
            author: "manual".into(),
            base_version_id: "old".into(),
            created_at: 2,
            branch: false,
        };
        p.chapters[0].approved_version_id = "new".into();
        p.chapters[0].current_version_id = "new".into();
        p.chapters[0].working = new.content.clone();
        p.chapters[0].versions = vec![old, new];
        let b = build_context(&p, &p.chapters[1].id).unwrap();
        assert!(!b
            .items
            .iter()
            .find(|i| i.label == "上一章结尾原文")
            .unwrap()
            .text
            .contains("接过钥匙"));
        let changes = b
            .items
            .iter()
            .find(|i| i.label == "上一章作者修改")
            .unwrap();
        assert!(changes.text.contains("林舟从叶岚手中接过钥匙"));
        assert!(changes.text.contains("obsolete_text"));
        // A subsequent manual save must retain the first edit too, and both
        // edits must also reach chapter three rather than only chapter two.
        let latest = Version {
            id: "latest".into(),
            chapter_id: p.chapters[0].id.clone(),
            number: 3,
            content: format!(
                "作者改稿：林舟从叶岚手中接过钥匙。\n\n{body}\n\n第二次改稿：叶岚决定去旧船厂。"
            ),
            author: "manual".into(),
            base_version_id: "new".into(),
            created_at: 3,
            branch: false,
        };
        p.chapters[0].approved_version_id = "latest".into();
        p.chapters[0].current_version_id = "latest".into();
        p.chapters[0].working = latest.content.clone();
        p.chapters[0].versions.push(latest);
        let b = build_context(&p, &p.chapters[2].id).unwrap();
        let cumulative = b
            .items
            .iter()
            .find(|i| i.id == format!("edits:{}", p.chapters[0].id))
            .unwrap();
        assert!(cumulative.text.contains("林舟从叶岚手中接过钥匙"));
        assert!(cumulative.text.contains("叶岚决定去旧船厂"));
    }
}
