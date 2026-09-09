use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

pub type UpdateState = tokio::sync::Mutex<PendingUpdate>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    phase: &'static str,
    downloaded: u64,
    total: Option<u64>,
}

// Only fixed, user-facing errors cross IPC; URLs and repository names stay native.
#[tauri::command]
pub async fn check_for_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<Option<String>, String> {
    let mut pending = state
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    if pending.bytes.is_some() {
        return Ok(pending.update.as_ref().map(|update| update.version.clone()));
    }
    let update = app
        .updater_builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|_| "Update checking is unavailable. Please try again later.")?
        .check()
        .await
        .map_err(|_| "Couldn't check for updates. Check your connection and try again.")?;
    let version = update.as_ref().map(|update| update.version.clone());
    pending.update = update.map(|mut update| {
        update.timeout = Some(std::time::Duration::from_secs(600));
        update
    });
    Ok(version)
}

#[tauri::command]
pub async fn download_app_update(
    state: State<'_, UpdateState>,
    on_progress: Channel<UpdateProgress>,
) -> Result<(), String> {
    let mut pending = state
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    if pending.bytes.is_some() {
        return Ok(());
    }
    let update = pending
        .update
        .as_ref()
        .ok_or("Check for updates before downloading.")?;
    let mut downloaded = 0u64;
    let mut last_progress = std::time::Instant::now() - std::time::Duration::from_secs(1);
    let bytes = update
        .download(
            |length, total| {
                downloaded += length as u64;
                if last_progress.elapsed() >= std::time::Duration::from_millis(100)
                    || total == Some(downloaded)
                {
                    last_progress = std::time::Instant::now();
                    let _ = on_progress.send(UpdateProgress {
                        phase: "downloading",
                        downloaded,
                        total,
                    });
                }
            },
            || {
                let _ = on_progress.send(UpdateProgress {
                    phase: "verifying",
                    downloaded: 0,
                    total: None,
                });
            },
        )
        .await
        .map_err(|_| "Couldn't download or verify the update. Please try again.")?;
    pending.bytes = Some(bytes);
    Ok(())
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    state: State<'_, UpdateState>,
) -> Result<(), String> {
    let mut pending = state
        .try_lock()
        .map_err(|_| "An update operation is already running.")?;
    let update = pending
        .update
        .clone()
        .ok_or("Check for updates before installing.")?;
    let bytes = pending
        .bytes
        .take()
        .ok_or("Download the update before installing.")?;
    // Windows starts its installer and exits; other platforms return and restart.
    tokio::task::spawn_blocking(move || update.install(bytes))
        .await
        .map_err(|_| "Couldn't install the update. Please download it again and retry.")?
        .map_err(|_| "Couldn't install the update. Please download it again and retry.")?;
    app.restart();
}
