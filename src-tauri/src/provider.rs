use crate::model::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::Mutex};
use tokio_util::sync::CancellationToken;

pub struct Secrets(pub Mutex<HashMap<String, String>>);
impl Default for Secrets {
    fn default() -> Self {
        Self::new()
    }
}
impl Secrets {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
    pub fn set(&self, pid: &str, key: &str) -> Result<String> {
        if key.trim().is_empty() {
            return Err(AppError::new("VALIDATION", "API Key 不能为空。"));
        }
        let entry = keyring::Entry::new("com.local.novelstudio", pid);
        let stored = entry.and_then(|e| e.set_password(key)).is_ok();
        self.0
            .lock()
            .map_err(|_| AppError::new("SECRET_ERROR", "密钥缓存不可用。"))?
            .insert(pid.into(), key.into());
        Ok(if stored { "credential" } else { "session" }.into())
    }
    pub fn get(&self, pid: &str) -> Result<String> {
        if let Some(key) = self
            .0
            .lock()
            .map_err(|_| AppError::new("SECRET_ERROR", "密钥缓存不可用。"))?
            .get(pid)
        {
            return Ok(key.clone());
        }
        keyring::Entry::new("com.local.novelstudio", pid)
            .and_then(|e| e.get_password())
            .map_err(|_| {
                AppError::new(
                    "NO_KEY",
                    "密钥未设置或仅保留在上次会话中，请重新填写 API Key。",
                )
            })
    }
    pub fn remove(&self, pid: &str) {
        if let Ok(mut m) = self.0.lock() {
            m.remove(pid);
        }
        if let Ok(e) = keyring::Entry::new("com.local.novelstudio", pid) {
            let _ = e.delete_credential();
        }
    }
}

pub fn endpoint(p: &Provider) -> Result<url::Url> {
    if p.model_id.trim().is_empty() {
        return Err(AppError::new(
            "NO_MODEL_ID",
            "该 API 尚未选择模型。请填写模型 ID，或读取模型列表后选择。",
        ));
    }
    connection_endpoint(p)
}

// Respect the OS proxy for internet services. Loopback APIs must stay local,
// including when HTTP_PROXY / HTTPS_PROXY point to an unreachable proxy.
pub fn client_builder(url: &url::Url) -> reqwest::ClientBuilder {
    let builder = reqwest::Client::builder();
    if matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    ) {
        builder.no_proxy()
    } else {
        builder
    }
}
pub fn connection_endpoint(p: &Provider) -> Result<url::Url> {
    let mut url = url::Url::parse(p.base_url.trim())
        .map_err(|_| AppError::new("INVALID_URL", "请输入完整的 HTTPS API 地址。"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query().is_some()
    {
        return Err(AppError::new(
            "INVALID_URL",
            "API 地址不能含账号密码、查询参数或片段。",
        ));
    }
    let local = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
    );
    if url.scheme() != "https" && !(url.scheme() == "http" && local && p.allow_local_http) {
        return Err(AppError::new(
            "INSECURE_URL",
            "默认仅支持 HTTPS。使用本地模型时，请明确允许 HTTP 回环地址。",
        ));
    }
    if p.name.trim().is_empty()
        || !(256..=MAX_OUTPUT_TOKENS).contains(&p.max_tokens)
        || !(10..=600).contains(&p.timeout_seconds)
        || !["max_tokens", "max_completion_tokens", "none"].contains(&p.token_parameter.as_str())
        || p.temperature.is_some_and(|t| !(0.0..=2.0).contains(&t))
        || !["auto", "enabled", "disabled"].contains(&p.thinking_mode.as_str())
    {
        return Err(AppError::new(
            "VALIDATION",
            "请检查模型 ID、输出上限、超时和参数配置。",
        ));
    }
    let path = url.path().trim_end_matches('/');
    if !path.ends_with("/chat/completions") {
        url.set_path(&format!("{path}/chat/completions"));
    }
    Ok(url)
}

pub fn local_without_key(p: &Provider) -> bool {
    p.allow_local_http
        && url::Url::parse(&p.base_url).is_ok_and(|u| {
            matches!(
                u.host_str(),
                Some("localhost" | "127.0.0.1" | "[::1]" | "::1")
            )
        })
}
impl Secrets {
    pub fn for_provider(&self, p: &Provider) -> Result<String> {
        match self.get(&p.id) {
            Ok(key) => Ok(key),
            Err(_) if local_without_key(p) => Ok(String::new()),
            Err(e) => Err(e),
        }
    }
}
pub async fn list_models(p: &Provider, key: &str) -> Result<Vec<String>> {
    let mut url = connection_endpoint(p)?;
    url.set_path(&format!(
        "{}/models",
        url.path()
            .trim_end_matches("/chat/completions")
            .trim_end_matches('/')
    ));
    let client = client_builder(&url)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| AppError::new("NETWORK", "网络客户端初始化失败。"))?;
    let mut request = client.get(url);
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let mut response = request.send().await.map_err(|_| {
        AppError::new(
            "NETWORK",
            "模型列表读取失败；可手动填写服务商提供的模型 ID。",
        )
    })?;
    if !response.status().is_success() {
        return Err(AppError::new(
            "MODEL_LIST",
            "接口未提供可读模型列表。请检查地址和密钥，或手动填写模型 ID。",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| AppError::new("NETWORK", "读取模型列表时连接中断。"))?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "模型列表超过 2 MB。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)?;
    let mut ids: Vec<String> = value["data"]
        .as_array()
        .ok_or_else(|| {
            AppError::new(
                "MODEL_LIST",
                "该接口不支持标准模型列表；请手动填写模型 ID。",
            )
        })?
        .iter()
        .take(10000)
        .filter_map(|v| {
            v["id"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() < 1000)
                .map(str::to_string)
        })
        .collect();
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Err(AppError::new(
            "MODEL_LIST",
            "接口模型列表为空；请手动填写模型 ID。",
        ));
    }
    Ok(ids)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}
pub fn message(role: &str, content: impl Into<String>) -> Message {
    Message {
        role: role.into(),
        content: content.into(),
    }
}
#[derive(Clone, Debug)]
pub struct Completion {
    pub text: String,
    pub finish_reason: String,
    pub input_tokens: usize,
    pub output_tokens: usize,
    pub reasoning_tokens: usize,
    pub has_reasoning: bool,
}

impl Completion {
    pub fn require_answer(&self) -> Result<()> {
        if !self.text.trim().is_empty() {
            return Ok(());
        }
        let message = if self.finish_reason == "length" {
            let usage = if self.output_tokens > 0 {
                if self.reasoning_tokens > 0 {
                    format!(
                        "服务商报告输出 {} tokens、推理 {} tokens",
                        self.output_tokens, self.reasoning_tokens
                    )
                } else {
                    format!("服务商报告输出 {} tokens", self.output_tokens)
                }
            } else {
                "服务商未报告输出用量".into()
            };
            format!("模型因长度限制结束，尚未返回最终正文（{usage}）。请核对 API 配置的输出上限和模型容量，或在支持时关闭思考后手动重试；增大上下文不会增加输出预算。")
        } else if self.has_reasoning {
            "模型只返回了推理内容，没有最终正文；推理不会写入正文或记忆。请检查思考模式与输出上限，手动重试。".into()
        } else {
            "模型返回空的最终正文。若开启了 JSON object，可关闭该选项后手动重试；空响应不会作为成功结果提交。".into()
        };
        Err(AppError::new(
            if self.finish_reason == "length" {
                "OUTPUT_TRUNCATED"
            } else if self.has_reasoning {
                "REASONING_ONLY"
            } else {
                "EMPTY_RESPONSE"
            },
            &message,
        ))
    }
}

pub fn official_deepseek(p: &Provider) -> bool {
    url::Url::parse(&p.base_url).is_ok_and(|url| url.host_str() == Some("api.deepseek.com"))
}

// Automatic mode changes only structured extraction on the official endpoint.
// Ordinary writing retains the service default; other providers receive no extra field.
pub fn thinking_type(p: &Provider, structured: bool) -> Option<&str> {
    match p.thinking_mode.as_str() {
        "enabled" => Some("enabled"),
        "disabled" => Some("disabled"),
        _ if structured && official_deepseek(p) => Some("disabled"),
        _ => None,
    }
}

pub async fn complete(
    p: &Provider,
    key: &str,
    messages: Vec<Message>,
    json_output: bool,
    cancel: &CancellationToken,
) -> Result<Completion> {
    complete_with_parameters(
        p,
        key,
        messages,
        json_output,
        &crate::presets::PresetParameters::default(),
        cancel,
    )
    .await
}

pub async fn complete_with_parameters(
    p: &Provider,
    key: &str,
    messages: Vec<Message>,
    json_output: bool,
    parameters: &crate::presets::PresetParameters,
    cancel: &CancellationToken,
) -> Result<Completion> {
    let response = request_completion(p, key, messages, json_output, parameters, cancel).await?;
    response.require_answer()?;
    Ok(response)
}

pub fn completion_body(
    p: &Provider,
    messages: Vec<Message>,
    json_output: bool,
    parameters: &crate::presets::PresetParameters,
) -> Result<Value> {
    parameters.validate()?;
    let mut body = json!({"model":p.model_id,"messages":messages,"stream":false});
    for (key, value) in parameters.fields().as_object().unwrap() {
        body[key] = value.clone();
    }
    if p.token_parameter != "none" {
        body[&p.token_parameter] = json!(p.max_tokens);
    }
    if let Some(temp) = p.temperature {
        body["temperature"] = json!(temp);
    }
    if json_output && p.json_mode {
        body["response_format"] = json!({"type":"json_object"});
    }
    if let Some(mode) = thinking_type(p, json_output) {
        body["thinking"] = json!({"type":mode});
    }
    Ok(body)
}

// The task engine accounts for usage before rejecting an empty final answer.
pub async fn request_completion(
    p: &Provider,
    key: &str,
    messages: Vec<Message>,
    json_output: bool,
    parameters: &crate::presets::PresetParameters,
    cancel: &CancellationToken,
) -> Result<Completion> {
    let url = endpoint(p)?;
    let client = client_builder(&url)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(p.timeout_seconds))
        .build()
        .map_err(|_| AppError::new("NETWORK", "网络客户端初始化失败。"))?;
    let body = completion_body(p, messages, json_output, parameters)?;
    let mut request = client.post(url).json(&body);
    if !key.is_empty() {
        request = request.bearer_auth(key);
    }
    let mut response = tokio::select! { _=cancel.cancelled()=>return Err(AppError::new("CANCELLED","任务已取消；服务商可能已计费。")), r=request.send()=>r.map_err(|e|if e.is_timeout(){AppError::new("TIMEOUT","请求超时，已保留片段。重试可能重复计费，请手动恢复。")}else{AppError::new("NETWORK","网络连接失败。已保留片段，请检查连接后手动恢复。")})? };
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        return Err(match status { 401|403=>AppError::new("AUTH_INVALID","鉴权失败，请检查 API Key 和服务商权限。"),429=>AppError::new("RATE_LIMIT","服务商限流。请稍后重试或换模型。"),400|404|422=>AppError::new("MODEL_PARAMETERS","服务商不接受模型名、接口路径或参数。请检查配置；可关闭 temperature、JSON 模式或输出参数。"),300..=399=>AppError::new("REDIRECT_BLOCKED","接口返回了重定向，为保护密钥已停止。请填写最终 API 地址。"),_=>AppError::new("PROVIDER_ERROR","服务商暂时无法完成请求。请稍后手动重试。") });
    }
    if response
        .content_length()
        .is_some_and(|n| n > 5 * 1024 * 1024)
    {
        return Err(AppError::new("TOO_LARGE", "模型响应超过 5 MB。"));
    }
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! { _=cancel.cancelled()=>return Err(AppError::new("CANCELLED","任务已取消。")),r=response.chunk()=>r.map_err(|e|if e.is_timeout(){AppError::new("TIMEOUT","读取模型响应超时；已保留任务和已完成片段，请按服务速度调整超时后手动重试。")}else{AppError::new("NETWORK","读取响应时连接中断。")})? };
        let Some(chunk) = chunk else { break };
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err(AppError::new("TOO_LARGE", "模型响应超过 5 MB。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::new("UNSUPPORTED_RESPONSE", "服务商返回的响应不是有效 JSON。"))?;
    let choice = value["choices"]
        .as_array()
        .and_then(|a| a.first())
        .ok_or_else(|| AppError::new("UNSUPPORTED_RESPONSE", "模型响应缺少 choices。"))?;
    if choice["message"]["refusal"]
        .as_str()
        .is_some_and(|s| !s.is_empty())
        || choice["finish_reason"] == "content_filter"
    {
        return Err(AppError::new(
            "MODEL_REFUSAL",
            "模型拒绝生成本次内容，请查看服务商使用规则。",
        ));
    }
    let content = match &choice["message"]["content"] {
        Value::String(text) => text.trim().to_string(),
        Value::Null => String::new(),
        _ => {
            return Err(AppError::new(
                "UNSUPPORTED_RESPONSE",
                "该接口没有返回文本格式的最终正文。",
            ))
        }
    };
    let reason = choice["finish_reason"]
        .as_str()
        .ok_or_else(|| {
            AppError::new(
                "UNSUPPORTED_RESPONSE",
                "响应缺少 finish_reason，不能判断是否完整。",
            )
        })?
        .to_string();
    Ok(Completion {
        text: content,
        finish_reason: reason,
        input_tokens: value["usage"]["prompt_tokens"].as_u64().unwrap_or(0) as usize,
        output_tokens: value["usage"]["completion_tokens"].as_u64().unwrap_or(0) as usize,
        reasoning_tokens: value["usage"]["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as usize,
        has_reasoning: choice["message"]["reasoning_content"]
            .as_str()
            .is_some_and(|s| !s.trim().is_empty()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(url: &str) -> Provider {
        Provider {
            base_url: url.into(),
            model_id: "test".into(),
            ..Provider::default()
        }
    }
    #[test]
    fn endpoint_normalization_and_security() {
        assert_eq!(
            endpoint(&p("https://example.com/v1/")).unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint(&p("https://example.com/v1/chat/completions"))
                .unwrap()
                .as_str(),
            "https://example.com/v1/chat/completions"
        );
        for url in [
            "http://example.com",
            "http://127.0.0.1:9000",
            "https://user:pass@example.com",
            "file:///etc/passwd",
            "https://example.com?key=bad",
        ] {
            assert!(endpoint(&p(url)).is_err());
        }
        let mut local = p("http://127.0.0.1:9000/v1");
        local.allow_local_http = true;
        assert!(endpoint(&local).is_ok());
    }
    #[tokio::test]
    async fn real_http_mapping_and_truncation() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        for (status, body, expected) in [
            (401, "{}", "AUTH_INVALID"),
            (429, "{}", "RATE_LIMIT"),
            (
                200,
                r#"{"choices":[{"message":{"content":"半章"},"finish_reason":"length"}]}"#,
                "length",
            ),
            (
                200,
                r#"{"choices":[{"message":{"content":""},"finish_reason":"stop"}]}"#,
                "EMPTY_RESPONSE",
            ),
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap();
            std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut b = [0; 8192];
                let _ = stream.read(&mut b);
                let text=format!("HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                stream.write_all(text.as_bytes()).unwrap();
            });
            let mut config = p(&format!("http://{addr}/v1"));
            config.allow_local_http = true;
            let result = complete(
                &config,
                "test-secret",
                vec![message("user", "test")],
                false,
                &CancellationToken::new(),
            )
            .await;
            if status == 200 && expected == "length" {
                assert_eq!(result.unwrap().finish_reason, "length");
            } else {
                assert_eq!(result.unwrap_err().code, expected);
            }
        }
    }
}
