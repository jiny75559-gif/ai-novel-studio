use crate::{engine::AppState, model::*};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::Emitter;

const MAX_PACKAGE: u64 = 120 * 1024 * 1024;
pub const DEFAULT_REPOSITORY: &str = "jiny75559-gif/ai-novel-studio";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateConfig {
    pub repository: String,
}
impl Default for UpdateConfig {
    fn default() -> Self {
        Self {
            repository: DEFAULT_REPOSITORY.into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    pub platform: String,
    pub repository: String,
    pub url: String,
    pub sha256: String,
    pub size: u64,
    pub notes: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: String,
    pub size: u64,
    pub available: bool,
    pub can_install: bool,
    pub local: bool,
}
struct Pending {
    manifest: Manifest,
    staged: Option<PathBuf>,
    local: bool,
}
#[derive(Default)]
pub struct UpdateState(Mutex<Option<Pending>>);
fn err(code: &str, text: &str) -> AppError {
    AppError::new(code, text)
}
pub fn repository(value: &str) -> Result<String> {
    let value = value
        .trim()
        .trim_start_matches("https://github.com/")
        .trim_end_matches('/')
        .trim_end_matches(".git");
    let parts: Vec<_> = value.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|s| {
            s.is_empty()
                || s.len() > 100
                || !s
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
                || [".", ".."].contains(s)
        })
    {
        return Err(err(
            "UPDATE_REPOSITORY",
            "填写 GitHub 仓库链接或 用户名/仓库名。",
        ));
    }
    Ok(value.into())
}
pub fn verify_manifest(bytes: &[u8], signature: &str, pubkey: &str) -> Result<Manifest> {
    if bytes.len() > 64 * 1024 || signature.len() > 4096 {
        return Err(err("UPDATE_INVALID", "更新说明过大。"));
    }
    let decode = |v: &str| -> Result<String> {
        String::from_utf8(
            STANDARD
                .decode(v.trim())
                .map_err(|_| err("UPDATE_SIGNATURE", "更新签名无效。"))?,
        )
        .map_err(|_| err("UPDATE_SIGNATURE", "更新签名无效。"))
    };
    let key = minisign_verify::PublicKey::decode(&decode(pubkey)?)
        .map_err(|_| err("UPDATE_SIGNATURE", "更新发布公钥无效。"))?;
    let sig = minisign_verify::Signature::decode(&decode(signature)?)
        .map_err(|_| err("UPDATE_SIGNATURE", "更新签名无效。"))?;
    key.verify(bytes, &sig, true).map_err(|_| {
        err(
            "UPDATE_SIGNATURE",
            "更新包未通过发布签名校验，请重新下载官方更新包。",
        )
    })?;
    let m: Manifest =
        serde_json::from_slice(bytes).map_err(|_| err("UPDATE_INVALID", "更新说明格式无效。"))?;
    if m.format != "novel-studio-update-v1"
        || m.platform != "windows-x86_64"
        || m.size == 0
        || m.size > MAX_PACKAGE
        || m.sha256.len() != 64
        || !m.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(err("UPDATE_INVALID", "更新包类型、平台或大小不正确。"));
    }
    semver::Version::parse(&m.version).map_err(|_| err("UPDATE_INVALID", "更新版本号无效。"))?;
    let repo = repository(&m.repository)?;
    let url = url::Url::parse(&m.url).map_err(|_| err("UPDATE_INVALID", "更新下载地址无效。"))?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with(&format!("/{repo}/releases/download/"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(err(
            "UPDATE_INVALID",
            "更新下载地址必须是对应 GitHub 仓库的正式发布文件。",
        ));
    }
    Ok(m)
}
pub fn verify_package(m: &Manifest, bytes: &[u8]) -> Result<()> {
    if bytes.len() as u64 != m.size
        || !bytes.starts_with(b"MZ")
        || format!("{:x}", Sha256::digest(bytes)) != m.sha256.to_lowercase()
    {
        return Err(err(
            "UPDATE_CHECKSUM",
            "更新文件不完整或已损坏，未启动安装。请重新下载。",
        ));
    }
    Ok(())
}
fn info(p: &Pending) -> UpdateInfo {
    UpdateInfo {
        version: p.manifest.version.clone(),
        notes: p.manifest.notes.clone(),
        size: p.manifest.size,
        available: semver::Version::parse(&p.manifest.version).ok()
            > semver::Version::parse(env!("CARGO_PKG_VERSION")).ok(),
        can_install: semver::Version::parse(&p.manifest.version).ok()
            >= semver::Version::parse(env!("CARGO_PKG_VERSION")).ok(),
        local: p.local,
    }
}
fn config(state: &AppState) -> Result<UpdateConfig> {
    let path = state.data_dir.join("update-settings.json");
    if !path.exists() {
        return Ok(UpdateConfig::default());
    }
    let bytes = std::fs::read(path)?;
    if bytes.len() > 4096 {
        return Err(err("UPDATE_REPOSITORY", "更新设置无效，请重新保存仓库。"));
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| err("UPDATE_REPOSITORY", "更新设置无效，请重新保存仓库。"))
}
#[tauri::command]
pub fn update_config(state: tauri::State<'_, std::sync::Arc<AppState>>) -> Result<UpdateConfig> {
    config(&state)
}
#[tauri::command]
pub fn save_update_config(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    updates: tauri::State<'_, UpdateState>,
    value: String,
) -> Result<UpdateConfig> {
    let value = UpdateConfig {
        repository: repository(&value)?,
    };
    let path = state.data_dir.join("update-settings.json");
    std::fs::write(
        path,
        serde_json::to_vec(&value).map_err(|_| err("UPDATE_INVALID", "无法保存更新设置。"))?,
    )?;
    *updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))? = None;
    Ok(value)
}
async fn fetch(url: &str, max: u64, app: Option<&tauri::AppHandle>) -> Result<Vec<u8>> {
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(45))
        .timeout(Duration::from_secs(if max <= 64 * 1024 {
            20
        } else {
            1800
        }))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.url().scheme() != "https" || attempt.previous().len() > 5 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| err("NETWORK", "无法创建更新连接。"))?;
    fetch_with_client(&client, url, max, app).await
}
async fn fetch_with_client(
    client: &reqwest::Client,
    url: &str,
    max: u64,
    app: Option<&tauri::AppHandle>,
) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .header("User-Agent", "NovelStudio-Updater")
        .send()
        .await
        .map_err(|_| {
            err(
                "NETWORK",
                "更新服务器暂时无法连接；稍后重试或使用本地更新包。",
            )
        })?;
    if !response.status().is_success() {
        return Err(err(
            "UPDATE_NOT_PUBLISHED",
            "暂未找到可用更新。请确认仓库和发布文件已配置，也可使用本地更新包。",
        ));
    }
    if response.content_length().is_some_and(|len| len > max) {
        return Err(err("UPDATE_INVALID", "更新文件超过大小上限。"));
    }
    let mut bytes = vec![];
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| err("NETWORK", "更新下载中断，当前软件和作品保留，请重试。"))?
    {
        if bytes.len() as u64 + chunk.len() as u64 > max {
            return Err(err("UPDATE_INVALID", "更新文件超过大小上限。"));
        }
        bytes.extend_from_slice(&chunk);
        if last_emit.elapsed().as_millis() > 150 {
            if let Some(app) = app {
                let _ = app.emit("update-progress", bytes.len() as u64);
            }
            last_emit = std::time::Instant::now();
        }
    }
    Ok(bytes)
}

#[cfg(test)]
mod download_tests {
    use super::*;
    use std::{io::Write, net::TcpListener, thread};

    fn server(parts: Vec<(&'static [u8], u64)>) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}/update", listener.local_addr().unwrap());
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request);
            for (bytes, delay) in parts {
                thread::sleep(Duration::from_millis(delay));
                if stream.write_all(bytes).is_err() {
                    break;
                }
            }
        });
        (address, handle)
    }

    fn client(read_ms: u64) -> reqwest::Client {
        reqwest::Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_millis(read_ms))
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap()
    }

    #[tokio::test]
    async fn progressing_download_keeps_all_bytes_across_reads() {
        let (url, handle) = server(vec![
            (b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nab", 0),
            (b"cd", 80),
            (b"ef", 80),
        ]);
        let bytes = fetch_with_client(&client(500), &url, 6, None)
            .await
            .unwrap();
        assert_eq!(bytes, b"abcdef");
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn stalled_download_fails_without_returning_partial_package() {
        let (url, handle) = server(vec![
            (b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nab", 0),
            (b"cdef", 600),
        ]);
        let error = fetch_with_client(&client(100), &url, 6, None)
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "NETWORK");
        assert!(error.user_message.contains("下载中断"));
        handle.join().unwrap();
    }

    #[tokio::test]
    async fn oversized_stream_is_rejected_without_trusting_headers() {
        let (url, handle) = server(vec![(
            b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabcdefg",
            0,
        )]);
        let error = fetch_with_client(&client(500), &url, 6, None)
            .await
            .err()
            .unwrap();
        assert_eq!(error.code, "UPDATE_INVALID");
        handle.join().unwrap();
    }
}
#[tauri::command]
pub async fn check_update(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    updates: tauri::State<'_, UpdateState>,
) -> Result<UpdateInfo> {
    let repo = repository(&config(&state)?.repository)?;
    let base = format!("https://github.com/{repo}/releases/latest/download/update-manifest.json");
    let bytes = fetch(&base, 64 * 1024, None).await?;
    let signature = fetch(&format!("{base}.sig"), 4096, None).await?;
    let m = verify_manifest(
        &bytes,
        std::str::from_utf8(&signature).map_err(|_| err("UPDATE_SIGNATURE", "更新签名无效。"))?,
        include_str!("update-public-key.txt"),
    )?;
    if m.repository != repo {
        return Err(err("UPDATE_INVALID", "更新包不属于选择的仓库。"));
    }
    let pending = Pending {
        manifest: m,
        staged: None,
        local: false,
    };
    let result = info(&pending);
    *updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))? = Some(pending);
    Ok(result)
}
fn stage(state: &AppState, manifest: &Manifest, bytes: &[u8]) -> Result<PathBuf> {
    verify_package(manifest, bytes)?;
    let dir = state.data_dir.join("updates");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("update-{}.exe", id()));
    std::fs::write(&path, bytes)?;
    Ok(path)
}
#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    updates: tauri::State<'_, UpdateState>,
) -> Result<UpdateInfo> {
    let manifest = updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))?
        .as_ref()
        .ok_or_else(|| err("UPDATE_STATE", "先检查更新。"))?
        .manifest
        .clone();
    let bytes = fetch(&manifest.url, manifest.size, Some(&app)).await?;
    let staged = stage(&state, &manifest, &bytes)?;
    let pending = Pending {
        manifest,
        staged: Some(staged),
        local: false,
    };
    let result = info(&pending);
    *updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))? = Some(pending);
    Ok(result)
}
pub fn read_local_package(path: &Path) -> Result<(Manifest, Vec<u8>)> {
    if path.metadata()?.len() > MAX_PACKAGE {
        return Err(err("UPDATE_INVALID", "本地更新包过大。"));
    }
    let mut zip = crate::reading::open_zip(path)?;
    if zip.len() != 3
        || zip
            .file_names()
            .any(|n| !["manifest.json", "manifest.sig", "update.exe"].contains(&n))
    {
        return Err(err("UPDATE_INVALID", "不是本软件的完整更新包。"));
    }
    let mut bytes = vec![];
    zip.by_name("manifest.json")
        .map_err(|_| err("UPDATE_INVALID", "更新说明缺失。"))?
        .take(64 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    let sig = crate::reading::zip_text(&mut zip, "manifest.sig")?;
    let manifest = verify_manifest(&bytes, &sig, include_str!("update-public-key.txt"))?;
    let mut installer = vec![];
    zip.by_name("update.exe")
        .map_err(|_| err("UPDATE_INVALID", "更新安装器缺失。"))?
        .take(MAX_PACKAGE + 1)
        .read_to_end(&mut installer)?;
    verify_package(&manifest, &installer)?;
    Ok((manifest, installer))
}
#[tauri::command]
pub async fn choose_local_update(
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    updates: tauri::State<'_, UpdateState>,
) -> Result<Option<UpdateInfo>> {
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title("选择叙事更新包")
        .add_filter("叙事更新包", &["nsupdate"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let path = file.path().to_path_buf();
    let (manifest, bytes) = tauri::async_runtime::spawn_blocking(move || read_local_package(&path))
        .await
        .map_err(|_| err("UPDATE_INVALID", "本地更新包无法读取。"))??;
    let staged = stage(&state, &manifest, &bytes)?;
    let pending = Pending {
        manifest,
        staged: Some(staged),
        local: true,
    };
    let result = info(&pending);
    *updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))? = Some(pending);
    Ok(Some(result))
}
#[tauri::command]
pub fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<AppState>>,
    updates: tauri::State<'_, UpdateState>,
) -> Result<()> {
    let guard = updates
        .0
        .lock()
        .map_err(|_| err("UPDATE_STATE", "更新状态不可用。"))?;
    let pending = guard
        .as_ref()
        .ok_or_else(|| err("UPDATE_STATE", "先下载或选择更新包。"))?;
    let new = semver::Version::parse(&pending.manifest.version)
        .map_err(|_| err("UPDATE_INVALID", "版本号无效。"))?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|_| err("UPDATE_INVALID", "当前版本号无效。"))?;
    if new < current {
        return Err(err("UPDATE_DOWNGRADE", "更新包版本更旧，未覆盖当前软件。"));
    }
    let path = pending
        .staged
        .as_ref()
        .ok_or_else(|| err("UPDATE_STATE", "更新文件尚未下载。"))?;
    let bytes = std::fs::read(path)?;
    verify_package(&pending.manifest, &bytes)?;
    let conn = state.db.lock()?;
    let running: i64 = conn.query_row("SELECT (SELECT count(*) FROM runs WHERE status='running') + (SELECT count(*) FROM image_jobs WHERE status='running')", [], |r| r.get(0))?;
    if running > 0 {
        return Err(err(
            "UPDATE_BUSY",
            "请等当前生成任务完成，或取消任务后再更新。",
        ));
    }
    let backup = state
        .data_dir
        .join("updates")
        .join(format!("before-update-{}.sqlite3", now()));
    conn.execute("VACUUM INTO ?", [backup.to_string_lossy().as_ref()])?;
    drop(conn);
    let executable = std::env::current_exe()?;
    let install_dir = executable
        .parent()
        .ok_or_else(|| err("UPDATE_INSTALL", "无法识别安装目录。"))?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(path)
            .args(["/S", "/UPDATE", "/R"])
            .arg(format!("/D={}", install_dir.display()))
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|_| err("UPDATE_INSTALL", "无法启动更新安装器，当前软件与作品保留。"))?;
        app.exit(0);
    }
    #[cfg(not(windows))]
    {
        let _ = (app, install_dir);
        return Err(err("UPDATE_INSTALL", "当前更新包只支持 Windows x64。"));
    }
    Ok(())
}
