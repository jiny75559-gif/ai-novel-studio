use crate::{context::*, engine::writing_preview, model::*};
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsAdvice {
    pub scenes: usize,
    pub chars_per_scene: usize,
    pub estimated_request_tokens: usize,
    pub suggested_context_tokens: usize,
    pub timeout_seconds: u64,
    pub output_tokens: usize,
    pub problems: Vec<String>,
    pub warnings: Vec<String>,
}

// Check later requests too: the growing chapter is sent for continuity.
// These are estimates at the target length; the actual request is checked again before HTTP.
pub fn largest_writing_request(p: &Project, cid: &str, context: &ContextBundle) -> Result<usize> {
    let scenes = scene_count(p.settings.target_chars);
    let per_scene = p.settings.target_chars.div_ceil(scenes);
    let mut largest = 0;
    for index in 0..scenes {
        let prior = "文".repeat(per_scene * index);
        let preview = writing_preview(p, cid, context, index, &prior)?;
        largest = largest.max(preview.estimated_tokens);
    }
    Ok(largest)
}

pub fn advice(p: &Project, base_provider: Option<&Provider>, cid: &str) -> SettingsAdvice {
    let scenes = scene_count(p.settings.target_chars);
    let mut result = SettingsAdvice {
        scenes,
        chars_per_scene: p.settings.target_chars.div_ceil(scenes),
        estimated_request_tokens: 0,
        suggested_context_tokens: 0,
        timeout_seconds: 0,
        output_tokens: 0,
        problems: vec![],
        warnings: vec![],
    };
    if scenes > p.settings.max_calls {
        result.problems.push(format!("目标 {} 汉字会拆成 {} 个场景，至少需要 {} 次正文调用；当前上限只有 {} 次。请提高调用上限或降低目标字数。", p.settings.target_chars, scenes, scenes, p.settings.max_calls));
    }
    let Some(base_provider) = base_provider else {
        result
            .warnings
            .push("选择主 AI 后可检查输出上限、请求超时和上下文预算。".into());
        return result;
    };
    let provider = p
        .writing_preset
        .as_ref()
        .map(|s| s.effective_provider(base_provider))
        .unwrap_or_else(|| base_provider.clone());
    result.timeout_seconds = provider.timeout_seconds;
    result.output_tokens = provider.max_tokens;
    if provider.timeout_seconds < 120 {
        result.warnings.push(format!("每次请求超时只有 {} 秒，每个场景目标约 {} 汉字，慢模型或推理模型容易超时。建议在主 AI 配置中使用 120～300 秒，按服务实际速度调整；超时按单次请求计算，增加单章调用上限不会延长它。", provider.timeout_seconds, result.chars_per_scene));
    }
    if provider.token_parameter != "none" && provider.max_tokens < result.chars_per_scene * 2 {
        result.warnings.push(format!("有效输出上限 {} tokens 对单场景约 {} 汉字可能偏小；按保守估算建议约 {} tokens 或降低章节目标。预设启用参数时，以预设为准。", provider.max_tokens, result.chars_per_scene, result.chars_per_scene * 2));
    }
    if provider.token_parameter == "none" {
        result.warnings.push("该模型不发送输出上限参数，实际响应长度由服务决定；上下文检查仍会按配置的输出预算预留。".into());
    }
    match build_context(p, cid).and_then(|c| largest_writing_request(p, cid, &c)) {
        Ok(input) => {
            result.estimated_request_tokens = input.saturating_add(provider.max_tokens);
            if result.estimated_request_tokens > p.settings.context_tokens {
                result.problems.push(format!("按目标字数估算，后续场景输入与输出共需约 {} tokens，超过当前 {} tokens 的上下文窗口。请减少目标字数/资料，或仅在模型真实支持时提高窗口。", result.estimated_request_tokens, p.settings.context_tokens));
            } else if result.estimated_request_tokens > p.settings.context_tokens * 85 / 100 {
                result.warnings.push("预计请求已接近上下文上限。模型写得比目标长或增加资料后可能超限，建议保留余量。".into());
            }
        }
        Err(e) => result.problems.push(e.user_message),
    }
    // Show a useful recommendation even when the configured window cannot fit locked data.
    let mut roomy = p.clone();
    roomy.settings.context_tokens = MAX_CONTEXT_TOKENS;
    if let Ok(context) = build_context(&roomy, cid) {
        if let Ok(input) = largest_writing_request(&roomy, cid, &context) {
            let total = input.saturating_add(provider.max_tokens);
            result.suggested_context_tokens = total.saturating_add(total / 5).div_ceil(1000) * 1000;
            if result.estimated_request_tokens == 0 {
                result.estimated_request_tokens = total;
            }
        }
    }
    result
}
