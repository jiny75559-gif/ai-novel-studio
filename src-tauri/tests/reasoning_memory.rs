use novel_studio_lib::{db::Database, engine::*, model::*, presets::PresetParameters, provider::*};
use serde_json::{json, Value};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::{Arc, Mutex},
};

struct Mock {
    url: String,
    requests: Arc<Mutex<Vec<Value>>>,
}
fn mock(responses: Vec<Value>) -> Mock {
    let server = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/v1", server.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(vec![]));
    let captured = requests.clone();
    std::thread::spawn(move || {
        for body in responses {
            let (mut stream, _) = server.accept().unwrap();
            let mut input = vec![];
            loop {
                let mut chunk = [0; 8192];
                let n = stream.read(&mut chunk).unwrap();
                assert!(n > 0);
                input.extend_from_slice(&chunk[..n]);
                if let Some(end) = input.windows(4).position(|s| s == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&input[..end]);
                    let len: usize = headers
                        .lines()
                        .find_map(|s| {
                            s.to_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|s| s.trim().parse().ok())
                        })
                        .unwrap();
                    if input.len() >= end + 4 + len {
                        captured
                            .lock()
                            .unwrap()
                            .push(serde_json::from_slice(&input[end + 4..end + 4 + len]).unwrap());
                        break;
                    }
                }
            }
            let body = body.to_string();
            write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    Mock { url, requests }
}
fn response(text: Value, reason: &str, thinking: &str) -> Value {
    json!({"choices":[{"message":{"content":text,"reasoning_content":thinking},"finish_reason":reason}],"usage":{"prompt_tokens":5629,"completion_tokens":4096,"completion_tokens_details":{"reasoning_tokens":4000}}})
}
fn setup(mock: &Mock) -> (Arc<AppState>, Project) {
    setup_target(mock, 3000, 500_000)
}
fn setup_target(mock: &Mock, target: usize, context: usize) -> (Arc<AppState>, Project) {
    let db = Database::open(Path::new(":memory:")).unwrap();
    let provider = Provider {
        base_url: mock.url.clone(),
        model_id: "deepseek-fixture".into(),
        allow_local_http: true,
        ..Provider::default()
    };
    db.store_provider(&provider).unwrap();
    let mut p = fixture();
    p.settings.writer_id = provider.id;
    p.settings.auto_review = false;
    p.settings.context_tokens = context;
    p.settings.target_chars = target;
    let p = db.create(p).unwrap();
    let cid = p.chapters[0].id.clone();
    let p = db
        .save_working(
            &p.id,
            &cid,
            0,
            "叶岚将铜钥匙交给林舟。两人离开灯塔。".into(),
        )
        .unwrap();
    let p = db
        .save_version(&p.id, &cid, p.chapters[0].edit_revision, "")
        .unwrap();
    let p = db
        .approve(&p.id, &cid, &p.chapters[0].current_version_id, "人工核实")
        .unwrap();
    (
        Arc::new(AppState {
            db,
            secrets: Secrets::new(),
            cancellations: Mutex::new(Default::default()),
            data_dir: std::env::temp_dir(),
        }),
        p,
    )
}
async fn run_memory(state: &Arc<AppState>, p: &Project) -> Run {
    let rid = id();
    let r = prepare_run(state, &p.id, &p.chapters[0].id, "remember", &rid, "", "").unwrap();
    execute(state.clone(), rid).await;
    state.db.run(&r.id).unwrap()
}

#[test]
fn thinking_policy_is_scoped_to_structured_official_requests_and_explicit_choice() {
    let mut p = Provider {
        base_url: "https://api.deepseek.com/v1".into(),
        model_id: "custom-id".into(),
        ..Provider::default()
    };
    let body = |p: &Provider, json| {
        completion_body(
            p,
            vec![message("user", "json")],
            json,
            &PresetParameters::default(),
        )
        .unwrap()
    };
    assert_eq!(body(&p, true)["thinking"], json!({"type":"disabled"}));
    assert!(body(&p, false).get("thinking").is_none());
    for host in [
        "https://api.deepseek.com.evil.test/v1",
        "https://deepseek-relay.test/v1",
        "http://localhost:8787/v1",
    ] {
        p.base_url = host.into();
        assert!(body(&p, true).get("thinking").is_none());
    }
    p.thinking_mode = "enabled".into();
    assert_eq!(body(&p, true)["thinking"]["type"], "enabled");
    p.thinking_mode = "disabled".into();
    assert_eq!(body(&p, false)["thinking"]["type"], "disabled");
    assert_eq!(body(&p, true)["model"], "custom-id");
}

#[tokio::test]
async fn null_reasoning_only_truncation_keeps_usage_without_publishing_thoughts_or_memory() {
    let m = mock(vec![response(
        Value::Null,
        "length",
        "private reasoning is not a memory",
    )]);
    let (s, p) = setup(&m);
    let run = run_memory(&s, &p).await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.unwrap().code, "OUTPUT_TRUNCATED");
    assert_eq!(run.input_tokens, 5629);
    assert_eq!(run.output_tokens, 4096);
    assert_eq!(run.reasoning_tokens, 4000);
    assert_eq!(run.calls, 1);
    assert!(!serde_json::to_string(&s.db.run(&run.id).unwrap())
        .unwrap()
        .contains("private reasoning"));
    let saved = s.db.load(&p.id).unwrap();
    assert!(saved.proposals.is_empty());
    assert_eq!(saved.chapters[0].summary, p.chapters[0].summary);
    assert_eq!(m.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn empty_json_stop_keeps_usage_and_can_manually_retry_without_losing_versions() {
    let valid=json!({"summary":"钥匙交接，两人离开。","facts":[{"category":"item","subjectId":"","predicate":"归属","value":"林舟持有铜钥匙","certainty":"confirmed","visibility":"reader_known","startOrder":2,"endOrder":null,"excerpt":"叶岚将铜钥匙交给林舟。"}]}).to_string();
    let m = mock(vec![
        response(json!(""), "stop", ""),
        response(json!(valid), "stop", "reasoning is ignored"),
    ]);
    let (s, p) = setup(&m);
    let failed = run_memory(&s, &p).await;
    assert_eq!(failed.error.unwrap().code, "EMPTY_RESPONSE");
    assert_eq!(failed.output_tokens, 4096);
    assert_eq!(m.requests.lock().unwrap().len(), 1);
    let successful = run_memory(&s, &p).await;
    assert_eq!(successful.status, "succeeded");
    let saved = s.db.load(&p.id).unwrap();
    assert_eq!(
        saved.chapters[0].versions.len(),
        p.chapters[0].versions.len()
    );
    assert_eq!(saved.proposals.len(), 1);
    assert_eq!(saved.proposals[0].status, "pending");
    assert!(saved.proposals[0].verified);
    assert_eq!(saved.facts.len(), p.facts.len());
    let requests = m.requests.lock().unwrap();
    let prompt = requests[1]["messages"][0]["content"].as_str().unwrap();
    assert!(prompt.contains("summary 最多 300"));
    assert!(prompt.contains("facts 最多 8"));
    assert!(prompt.contains("禁止抄写整段"));
}

#[tokio::test]
async fn partial_json_is_preserved_and_never_repaired_as_complete_after_length_stop() {
    let m = mock(vec![response(json!("{\"summary\":\"未完成"), "length", "")]);
    let (s, p) = setup(&m);
    let run = run_memory(&s, &p).await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.unwrap().code, "OUTPUT_TRUNCATED");
    assert_eq!(run.segments.len(), 1);
    assert!(run.segments[0].text.contains("未完成"));
    assert!(s.db.load(&p.id).unwrap().proposals.is_empty());
    assert_eq!(m.requests.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn reasoning_only_stop_is_explicit_and_not_treated_as_success() {
    let m = mock(vec![response(json!(""), "stop", "only thought")]);
    let (s, p) = setup(&m);
    let run = run_memory(&s, &p).await;
    assert_eq!(run.status, "failed");
    assert_eq!(run.error.unwrap().code, "REASONING_ONLY");
    assert_eq!(run.reasoning_tokens, 4000);
}

#[test]
fn larger_real_model_capacity_is_accepted_and_legacy_config_defaults_are_compatible() {
    let mut p = fixture();
    p.settings.context_tokens = 500_000;
    assert!(p.validate().is_ok());
    p.settings.context_tokens = MAX_CONTEXT_TOKENS + 1;
    assert!(p.validate().is_err());
    let provider: Provider = serde_json::from_value(
        json!({"baseUrl":"https://api.deepseek.com","modelId":"service-model","maxTokens":65536}),
    )
    .unwrap();
    assert_eq!(provider.thinking_mode, "auto");
    assert!(endpoint(&provider).is_ok());
    let params = PresetParameters {
        max_tokens: Some(65536),
        ..Default::default()
    };
    assert!(params.validate().is_ok());
}

#[tokio::test]
async fn future_large_writing_target_does_not_block_short_confirmed_chapter_memory() {
    let m = mock(vec![response(
        json!("{\"summary\":\"两人离开灯塔。\",\"facts\":[]}"),
        "stop",
        "",
    )]);
    let (s, p) = setup_target(&m, 8000, 16000);
    let preview = preflight(&s, &p.id, &p.chapters[0].id, "remember").unwrap();
    assert_eq!(preview.max_calls, 2);
    assert_eq!(run_memory(&s, &p).await.status, "succeeded");
}

#[test]
fn default_memory_start_is_normalized_before_checking_end_order() {
    let m = mock(vec![]);
    let (s, p) = setup(&m);
    let r = prepare_run(&s, &p.id, &p.chapters[0].id, "remember", &id(), "", "").unwrap();
    let candidate = json!({"summary":"摘要","facts":[{"category":"item","subjectId":"","predicate":"归属","value":"林舟持有铜钥匙","certainty":"confirmed","visibility":"reader_known","startOrder":0,"endOrder":1,"excerpt":"叶岚将铜钥匙交给林舟。"}]});
    assert_eq!(
        memory_output(candidate, &r.snapshot).unwrap_err().code,
        "INVALID_SCHEMA"
    );
}

#[tokio::test]
async fn timeout_after_successful_headers_is_reported_as_timeout() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0; 8192];
        let _ = stream.read(&mut bytes);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n",
            )
            .unwrap();
        stream.flush().unwrap();
        std::thread::sleep(std::time::Duration::from_secs(12));
    });
    let config = Provider {
        base_url: format!("http://{address}/v1"),
        model_id: "test".into(),
        allow_local_http: true,
        timeout_seconds: 10,
        ..Provider::default()
    };
    let result = complete(
        &config,
        "",
        vec![message("user", "test")],
        false,
        &tokio_util::sync::CancellationToken::new(),
    )
    .await;
    assert_eq!(result.unwrap_err().code, "TIMEOUT");
}
