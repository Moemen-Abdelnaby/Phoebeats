use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock, Weak,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::{Child, Command},
    task::JoinHandle,
};

static STOPPING: AtomicBool = AtomicBool::new(false);
static PROCESS: OnceLock<Mutex<Weak<Mutex<Child>>>> = OnceLock::new();
pub struct Tunnel {
    pub url: String,
    child: Arc<Mutex<Child>>,
    reader: JoinHandle<()>,
}
impl Tunnel {
    pub fn running(&mut self) -> bool {
        self.child
            .lock()
            .is_ok_and(|mut child| matches!(child.try_wait(), Ok(None)))
    }
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        self.reader.abort();
        if let Ok(mut child) = self.child.lock() {
            let _ = child.start_kill();
        }
    }
}
pub fn shutdown() {
    STOPPING.store(true, Ordering::SeqCst);
    if let Some(process) = PROCESS
        .get()
        .and_then(|slot| slot.lock().ok())
        .and_then(|weak| weak.upgrade())
    {
        if let Ok(mut child) = process.lock() {
            let _ = child.start_kill();
        }
    }
}
fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn asset_name() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => Ok("cloudflared-windows-amd64.exe"),
        ("linux", "x86_64") => Ok("cloudflared-linux-amd64"),
        ("linux", "aarch64") => Ok("cloudflared-linux-arm64"),
        _ => Err("Automatic internet hosting supports Windows x64 and Linux x64/ARM64.".into()),
    }
}
async fn install(root: &Path) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|e| e.to_string())?;
    let name = asset_name()?;
    let client = reqwest::Client::builder()
        .user_agent("Phoebeats-Jam")
        .https_only(true)
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let release: Value = client
        .get("https://api.github.com/repos/cloudflare/cloudflared/releases/latest")
        .send()
        .await
        .map_err(|e| format!("Could not prepare Internet Jam: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    let asset = release["assets"]
        .as_array()
        .and_then(|a| a.iter().find(|a| a["name"] == name))
        .ok_or("Internet helper is unavailable for this platform.")?;
    let expected = asset["digest"]
        .as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .filter(|s| s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()))
        .ok_or("Internet helper has no verified checksum. Please try again later.")?;
    let url = asset["browser_download_url"]
        .as_str()
        .filter(|u| u.starts_with("https://github.com/cloudflare/cloudflared/releases/download/"))
        .ok_or("Invalid internet helper download.")?;
    let path = root.join(format!(
        "{}-{}{}",
        name.trim_end_matches(".exe"),
        &expected[..12],
        if cfg!(windows) { ".exe" } else { "" }
    ));
    if let Ok(bytes) = tokio::fs::read(&path).await {
        if checksum(&bytes) == expected {
            return Ok(path);
        }
    }
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 160 * 1024 * 1024 {
            return Err("Internet helper download is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if checksum(&bytes) != expected {
        return Err("Internet helper verification failed. Try again.".into());
    }
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(path)
}
fn tunnel_url(line: &str) -> Option<String> {
    line.split_whitespace().find_map(|word| {
        let url = reqwest::Url::parse(word).ok()?;
        let host = url.host_str()?;
        if url.scheme() == "https"
            && host.ends_with(".trycloudflare.com")
            && host.split('.').count() == 3
            && url.port().is_none()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none()
        {
            Some(format!("https://{host}"))
        } else {
            None
        }
    })
}
pub async fn start(root: &Path, server: &str) -> Result<Tunnel, String> {
    let binary = install(root).await?;
    if STOPPING.load(Ordering::SeqCst) {
        return Err("App is shutting down.".into());
    }
    let config = root.join("quick-tunnel.yml");
    tokio::fs::write(&config, "# Phoebeats temporary Jam tunnel\n")
        .await
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(binary);
    command
        .arg("tunnel")
        .arg("--config")
        .arg(&config)
        .args(["--no-autoupdate", "--protocol", "http2", "--url", server])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start Internet Jam: {e}"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not read internet connection status.")?;
    let child = Arc::new(Mutex::new(child));
    *PROCESS
        .get_or_init(|| Mutex::new(Weak::new()))
        .lock()
        .map_err(|e| e.to_string())? = Arc::downgrade(&child);
    if STOPPING.load(Ordering::SeqCst) {
        if let Ok(mut child) = child.lock() {
            let _ = child.start_kill();
        }
        return Err("App is shutting down.".into());
    }
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let reader = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut sent = false;
        while let Ok(Some(line)) = lines.next_line().await {
            if !sent {
                if let Some(url) = tunnel_url(&line) {
                    let _ = tx.send(url).await;
                    sent = true;
                }
            }
        }
    });
    let mut tunnel = Tunnel {
        url: String::new(),
        child,
        reader,
    };
    let url = tokio::time::timeout(Duration::from_secs(60), rx.recv())
        .await
        .ok()
        .flatten()
        .ok_or("Internet connection could not start. Check your connection and try again.")?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;
    // A printed hostname alone does not mean its route is reachable yet.
    for _ in 0..15 {
        if !tunnel.running() {
            return Err("The internet connection stopped. Try again.".into());
        }
        if let Ok(r) = client.get(format!("{url}/health")).send().await {
            if r.status().is_success()
                && r.json::<Value>()
                    .await
                    .ok()
                    .is_some_and(|v| v["ok"] == true)
            {
                tunnel.url = url;
                return Ok(tunnel);
            }
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    Err("Internet Jam is not reachable yet. Try again in a moment.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_accept_tunnel_origin() {
        assert_eq!(
            tunnel_url("INF | https://quiet-music-room.trycloudflare.com |"),
            Some("https://quiet-music-room.trycloudflare.com".into())
        );
        for s in [
            "https://trycloudflare.com",
            "https://evil.trycloudflare.com.bad.test",
            "https://x.trycloudflare.com/path",
            "https://user@x.trycloudflare.com",
            "http://x.trycloudflare.com",
        ] {
            assert!(tunnel_url(s).is_none());
        }
    }
}
