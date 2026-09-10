use tauri::Manager;
use serde_json::{json, Value};
use std::time::Duration;

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(Duration::from_secs(120)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e| e.to_string())
}
fn endpoint(server: &str, path: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(server).map_err(|_| "Invalid Jam server address")?;
    if !["http", "https"].contains(&url.scheme()) || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("Use an HTTP or HTTPS Jam server address without credentials or query parameters".into());
    }
    if !path.starts_with("rooms") || path.contains("..") || path.contains('?') || path.contains('#') { return Err("Invalid Jam endpoint".into()); }
    Ok(format!("{}/{}", server.trim_end_matches('/'), path))
}
async fn checked(response: reqwest::Response) -> Result<reqwest::Response, String> {
    if response.status().is_success() { return Ok(response); }
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(json!({}));
    Err(body["error"].as_str().map(str::to_string).unwrap_or(format!("Jam service returned {status}")))
}
#[tauri::command]
pub async fn jam_request(server: String, path: String, token: Option<String>, body: Option<Value>) -> Result<Value, String> {
    let c = client()?; let url = endpoint(&server, &path)?;
    let mut req = if let Some(body) = body { c.post(url).json(&body) } else { c.get(url) };
    if let Some(token) = token { req = req.bearer_auth(token); }
    checked(req.send().await.map_err(|e| e.to_string())?).await?.json().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn jam_upload(server: String, code: String, token: String, path: String) -> Result<Value, String> {
    let path = std::path::PathBuf::from(path);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "wma", "aiff"].contains(&ext.as_str()) { return Err("Unsupported audio file".into()); }
    let meta = tokio::fs::metadata(&path).await.map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > 100 * 1024 * 1024 { return Err("Choose an audio file under 100 MB".into()); }
    let bytes = tokio::fs::read(path).await.map_err(|e| e.to_string())?;
    if bytes.len() > 100 * 1024 * 1024 { return Err("Choose an audio file under 100 MB".into()); }
    let response = client()?.post(endpoint(&server, &format!("rooms/{code}/files"))?).bearer_auth(token).header("x-audio-extension", ext).body(bytes).send().await.map_err(|e| e.to_string())?;
    checked(response).await?.json().await.map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn jam_download(app: tauri::AppHandle, server: String, code: String, token: String, key: String, ext: String, save: bool) -> Result<String, String> {
    if key.len() != 36 || !key.chars().all(|c| c.is_ascii_hexdigit()) || !["mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "wma", "aiff"].contains(&ext.as_str()) { return Err("Invalid shared file".into()); }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cache = root.join("jam-cache"); let saved = root.join("jam-saved");
    tokio::fs::create_dir_all(&cache).await.map_err(|e| e.to_string())?;
    let filename = format!("{key}.{ext}"); let cached_path = cache.join(&filename); let saved_path = saved.join(&filename);
    if saved_path.exists() { return Ok(saved_path.to_string_lossy().into()); }
    if !cached_path.exists() {
        let mut response = checked(client()?.get(endpoint(&server, &format!("rooms/{code}/files/{key}"))?).bearer_auth(token).send().await.map_err(|e| e.to_string())?).await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > 100 * 1024 * 1024 { return Err("Shared file is too large".into()); }
            bytes.extend_from_slice(&chunk);
        }
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
        let temporary = cache.join(format!("{key}-{nonce}.part"));
        tokio::fs::write(&temporary, bytes).await.map_err(|e| e.to_string())?;
        if let Err(error) = tokio::fs::rename(&temporary, &cached_path).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            if !cached_path.exists() { return Err(error.to_string()); }
        }
    }
    if save { tokio::fs::create_dir_all(saved).await.map_err(|e| e.to_string())?; tokio::fs::copy(&cached_path, &saved_path).await.map_err(|e| e.to_string())?; Ok(saved_path.to_string_lossy().into()) }
    else { Ok(cached_path.to_string_lossy().into()) }
}
