//! Embedded HTTP hosting. Only the dedicated Jam listener is exposed by a tunnel.
use crate::jam_room::{random_id, File, Room};
use http_body_util::{BodyExt, Full};
use hyper::{body::Bytes, Request, Response};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Semaphore},
    task::{JoinHandle, JoinSet},
};

struct Hosted {
    id: String,
    task: JoinHandle<()>,
    tunnel: Option<crate::jam_tunnel::Tunnel>,
}
impl Drop for Hosted {
    fn drop(&mut self) {
        self.task.abort();
    }
}
static HOST: OnceLock<Mutex<Option<Hosted>>> = OnceLock::new();
fn host() -> &'static Mutex<Option<Hosted>> {
    HOST.get_or_init(|| Mutex::new(None))
}
fn response(status: u16, data: Value) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("content-type", "application/json")
        .header("cache-control", "no-store")
        .body(Full::new(Bytes::from(data.to_string())))
        .unwrap()
}
fn error(status: u16, message: impl AsRef<str>) -> Response<Full<Bytes>> {
    response(status, json!({"error":message.as_ref()}))
}

async fn route(
    req: Request<Bytes>,
    room: Arc<Mutex<Room>>,
    attempts: Arc<Mutex<(Instant, u32)>>,
) -> Response<Full<Bytes>> {
    let method = req.method().clone();
    let path: Vec<String> = req
        .uri()
        .path()
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    if path == ["health"] && method == hyper::Method::GET {
        return response(200, json!({"ok":true}));
    }
    if path.first().map(String::as_str) != Some("rooms") || path.len() < 2 {
        return error(404, "Not found.");
    }
    let token = req
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_string();
    let joining = path.len() == 3 && path[2] == "join" && method == hyper::Method::POST;
    if joining {
        let mut a = attempts.lock().await;
        if a.0.elapsed() > Duration::from_secs(60) {
            *a = (Instant::now(), 0);
        }
        a.1 += 1;
        if a.1 > 30 {
            return error(429, "Too many join attempts. Try again in a minute.");
        }
    }
    let mut r = room.lock().await;
    if path[1] != r.code {
        return error(404, "Jam not found. Check your invite.");
    }
    let member = if joining {
        String::new()
    } else {
        match r.authenticate(&token) {
            Ok(id) => id,
            Err(e) => return error(401, e),
        }
    };
    if path.len() == 2 && method == hyper::Method::GET {
        return response(200, r.snapshot());
    }
    if path.len() == 4 && path[2] == "files" && method == hyper::Method::GET {
        return match r.files.get(&path[3]) {
            Some(f) => match tokio::fs::read(&f.path).await {
                Ok(bytes) => Response::builder()
                    .header("content-type", "application/octet-stream")
                    .header("cache-control", "no-store")
                    .body(Full::new(Bytes::from(bytes)))
                    .unwrap(),
                Err(_) => error(404, "Shared audio is no longer available. Share it again."),
            },
            None => error(404, "File unavailable."),
        };
    }
    if method != hyper::Method::POST || path.len() != 3 {
        return error(404, "Not found.");
    }
    let file_upload = path[2] == "files";
    let ext = req
        .headers()
        .get("x-audio-extension")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_lowercase();
    if file_upload
        && ![
            "mp3", "flac", "wav", "ogg", "opus", "m4a", "aac", "wma", "aiff",
        ]
        .contains(&ext.as_str())
    {
        return error(400, "Unsupported audio file.");
    }
    let bytes = req.into_body();
    if !joining && r.authenticate(&token).is_err() {
        return error(401, "Jam expired during transfer.");
    }
    if file_upload {
        // Retries and alternate local paths must not consume room storage twice.
        // Scope the key to the uploader so existing ownership checks still apply.
        let mut digest = Sha256::new();
        digest.update(member.as_bytes());
        digest.update([0]);
        digest.update(ext.as_bytes());
        digest.update([0]);
        digest.update(&bytes);
        let key = format!("{:x}", digest.finalize())[..36].to_string();
        if r.files.contains_key(&key) {
            return response(200, json!({"key":key,"ext":ext}));
        }
        let used = r.files.values().map(|f| f.size).sum();
        if !crate::jam_room::room_has_capacity(used, bytes.len() as u64) {
            return error(
                413,
                format!("Room storage is full (5 GB): {:.2} GB stored; this file needs {:.1} MB. Already shared songs can still play. Start a new Jam to clear shared audio.", used as f64 / 1073741824.0, bytes.len() as f64 / 1048576.0),
            );
        }
        let path = std::env::temp_dir().join(format!("phoebeats-jam-{key}.audio"));
        let output = match tokio::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .await
        {
            Ok(file) => file,
            Err(e) => return error(507, format!("Could not create temporary Jam audio: {e}")),
        };
        let file = File {
            path,
            size: bytes.len() as u64,
            ext: ext.clone(),
            owner: member,
        };
        // Close the Windows file handle before the cleanup guard on cancellation.
        let mut output = output;
        let result = output.write_all(&bytes).await;
        drop(output);
        if let Err(e) = result {
            return error(
                507,
                format!("Could not store Jam audio. Check free disk space: {e}"),
            );
        }
        r.files.insert(key.clone(), file);
        return response(200, json!({"key":key,"ext":ext}));
    }
    let body: Value = match serde_json::from_slice(&bytes) {
        Ok(b) => b,
        Err(_) => return error(400, "Invalid request."),
    };
    if joining {
        return match r.join(body["name"].as_str().unwrap_or("")) {
            Ok((token, id)) => response(
                200,
                json!({"token":token,"memberId":id,"room":r.snapshot()}),
            ),
            Err(e) => error(400, e),
        };
    }
    if path[2] == "leave" {
        r.leave(&token);
        return response(200, json!({}));
    }
    if path[2] == "command" {
        return match r.command(&member, &body) {
            Ok(value) => response(200, value),
            Err(e) => error(400, e),
        };
    }
    error(404, "Not found.")
}

// One request per connection. httparse validates the HTTP header syntax; body
// sizes, duplicate framing headers and chunk lengths are checked before allocation.
async fn read_request(
    stream: &mut TcpStream,
    room: &Arc<Mutex<Room>>,
    uploads: &Arc<Semaphore>,
) -> Result<Request<Bytes>, String> {
    let mut input = Vec::new();
    let end = loop {
        if let Some(i) = input.windows(4).position(|w| w == b"\r\n\r\n") {
            break i + 4;
        }
        if input.len() >= 16384 {
            return Err("Request headers are too large.".into());
        }
        let mut chunk = [0; 2048];
        let n = stream.read(&mut chunk).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("Connection closed.".into());
        }
        input.extend_from_slice(&chunk[..n]);
    };
    let mut headers = [httparse::EMPTY_HEADER; 64];
    if end > 16384 {
        return Err("Request headers are too large.".into());
    }
    let mut parsed = httparse::Request::new(&mut headers);
    if !parsed
        .parse(&input[..end])
        .map_err(|_| "Invalid HTTP request.")?
        .is_complete()
    {
        return Err("Incomplete HTTP request.".into());
    }
    let method = parsed.method.unwrap_or("");
    let path = parsed.path.unwrap_or("");
    if !["GET", "POST"].contains(&method) || !path.starts_with('/') {
        return Err("Unsupported request.".into());
    }
    let mut builder = Request::builder().method(method).uri(path);
    let mut length = None;
    let mut transfer = None;
    let mut token = String::new();
    for h in parsed.headers.iter() {
        let value = std::str::from_utf8(h.value).map_err(|_| "Invalid header.")?;
        if h.name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return Err("Duplicate content length.".into());
            }
            length = Some(
                value
                    .parse::<usize>()
                    .map_err(|_| "Invalid content length.")?,
            );
        }
        if h.name.eq_ignore_ascii_case("transfer-encoding") {
            if transfer.is_some() || !value.eq_ignore_ascii_case("chunked") {
                return Err("Invalid transfer encoding.".into());
            }
            transfer = Some(true);
        }
        if h.name.eq_ignore_ascii_case("authorization") {
            token = value.strip_prefix("Bearer ").unwrap_or("").into();
        }
        builder = builder.header(h.name, h.value);
    }
    if length.is_some() && transfer.is_some() {
        return Err("Ambiguous request framing.".into());
    }
    let file = method == "POST" && path.ends_with("/files");
    let max = if file {
        100 * 1024 * 1024
    } else {
        2 * 1024 * 1024
    };
    if length.unwrap_or(0) > max {
        return Err("Request is too large.".into());
    }
    let _permit = if file {
        room.lock().await.authenticate(&token)?;
        Some(
            uploads
                .try_acquire()
                .map_err(|_| "Another audio transfer is in progress. Try again shortly.")?,
        )
    } else {
        None
    };
    let pending = input[end..].to_vec();
    let mut reader = BufReader::new(std::io::Cursor::new(pending).chain(stream));
    let mut body = Vec::new();
    if transfer.is_some() {
        loop {
            let mut line = Vec::new();
            (&mut reader)
                .take(128)
                .read_until(b'\n', &mut line)
                .await
                .map_err(|e| e.to_string())?;
            if !line.ends_with(b"\r\n") {
                return Err("Invalid chunk header.".into());
            }
            let line = std::str::from_utf8(&line[..line.len() - 2])
                .map_err(|_| "Invalid chunk header.")?;
            let count = usize::from_str_radix(line.split(';').next().unwrap_or(""), 16)
                .map_err(|_| "Invalid chunk size.")?;
            if count == 0 {
                break;
            }
            if count > max - body.len() {
                return Err("Request is too large.".into());
            }
            let offset = body.len();
            body.resize(offset + count, 0);
            reader
                .read_exact(&mut body[offset..])
                .await
                .map_err(|e| e.to_string())?;
            let mut crlf = [0; 2];
            reader
                .read_exact(&mut crlf)
                .await
                .map_err(|e| e.to_string())?;
            if crlf != *b"\r\n" {
                return Err("Invalid chunk ending.".into());
            }
        }
    } else {
        body.resize(length.unwrap_or(0), 0);
        reader
            .read_exact(&mut body)
            .await
            .map_err(|e| e.to_string())?;
    }
    builder.body(Bytes::from(body)).map_err(|e| e.to_string())
}
async fn connection(
    mut stream: TcpStream,
    room: Arc<Mutex<Room>>,
    attempts: Arc<Mutex<(Instant, u32)>>,
    uploads: Arc<Semaphore>,
) {
    let result = match read_request(&mut stream, &room, &uploads).await {
        Ok(req) => route(req, room, attempts).await,
        Err(e) => error(400, e),
    };
    let status = result.status();
    let content_type = result
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let bytes = result.into_body().collect().await.unwrap().to_bytes();
    let header = format!("HTTP/1.1 {} {}\r\nContent-Length: {}\r\nContent-Type: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",status.as_u16(),status.canonical_reason().unwrap_or("Response"),bytes.len(),content_type);
    if stream.write_all(header.as_bytes()).await.is_ok() {
        let _ = stream.write_all(&bytes).await;
    }
    let _ = stream.shutdown().await;
}

pub async fn serve(listener: TcpListener, room: Room) {
    let room = Arc::new(Mutex::new(room));
    let attempts = Arc::new(Mutex::new((Instant::now(), 0)));
    let uploads = Arc::new(Semaphore::new(2));
    let connections = Arc::new(Semaphore::new(32));
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let Ok((stream,_)) = accepted else { break };
                let Ok(permit) = connections.clone().try_acquire_owned() else { continue };
                let (room,attempts,uploads) = (room.clone(),attempts.clone(),uploads.clone());
                tasks.spawn(async move {
                    let _permit = permit;
                    let _ = tokio::time::timeout(Duration::from_secs(125),connection(stream,room,attempts,uploads)).await;
                });
            }
            _ = tasks.join_next(), if !tasks.is_empty() => {}
        }
    }
}
fn lan_address() -> Result<std::net::IpAddr, String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    // UDP connect selects a route; no packet is sent.
    socket
        .connect("192.0.2.1:80")
        .map_err(|_| "Connect to Wi-Fi or Ethernet before starting a local Jam.")?;
    let ip = socket.local_addr().map_err(|e| e.to_string())?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return Err("No local network address was found.".into());
    }
    Ok(ip)
}
#[tauri::command]
pub async fn jam_host_start(
    app: tauri::AppHandle,
    mode: String,
    name: String,
    on_progress: tauri::ipc::Channel<String>,
) -> Result<Value, String> {
    if !["local", "internet"].contains(&mode.as_str()) {
        return Err("Choose Local or Internet.".into());
    }
    let _ = on_progress.send("Starting the local Jam server...".into());
    let (room, token, member) = Room::new(&name)?;
    let mut slot = host().lock().await;
    if slot.is_some() {
        return Err("End your current hosted Jam first.".into());
    }
    let ip = if mode == "local" {
        Some(lan_address()?)
    } else {
        None
    };
    let listener = TcpListener::bind(if mode == "local" {
        "0.0.0.0:0"
    } else {
        "127.0.0.1:0"
    })
    .await
    .map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let server = format!("http://127.0.0.1:{port}");
    let snapshot = room.snapshot();
    let mut hosted = Hosted {
        id: random_id(18),
        task: tokio::spawn(serve(listener, room)),
        tunnel: None,
    };
    let public_server = if let Some(ip) = ip {
        format!("http://{ip}:{port}")
    } else {
        let root = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("jam-tools");
        let tunnel = crate::jam_tunnel::start(&root, &server, on_progress).await?;
        let url = tunnel.url.clone();
        hosted.tunnel = Some(tunnel);
        url
    };
    let result = json!({"server":server,"publicServer":public_server,"hostId":hosted.id,"mode":mode,"token":token,"memberId":member,"room":snapshot});
    *slot = Some(hosted);
    Ok(result)
}
#[tauri::command]
pub async fn jam_host_stop(host_id: String) -> Result<(), String> {
    let mut slot = host().lock().await;
    if slot.as_ref().is_some_and(|h| h.id == host_id) {
        slot.take();
    }
    Ok(())
}
#[tauri::command]
pub async fn jam_host_status(host_id: String) -> bool {
    let mut slot = host().lock().await;
    if let Some(h) = slot.as_mut().filter(|h| h.id == host_id) {
        if h.task.is_finished() {
            return false;
        }
        if let Some(t) = &mut h.tunnel {
            return t.running();
        }
        return true;
    }
    false
}
pub fn shutdown() {
    crate::jam_tunnel::shutdown();
    if let Ok(mut slot) = host().try_lock() {
        slot.take();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn jam_upload_retries_reuse_storage_even_when_full() {
        let (room, token, _) = Room::new("Host").unwrap();
        let code = room.code.clone();
        let room = Arc::new(Mutex::new(room));
        let attempts = Arc::new(Mutex::new((Instant::now(), 0)));
        let upload = |bytes: &'static str| {
            Request::builder()
                .method("POST")
                .uri(format!("/rooms/{code}/files"))
                .header("authorization", format!("Bearer {token}"))
                .header("x-audio-extension", "mp3")
                .body(Bytes::from_static(bytes.as_bytes()))
                .unwrap()
        };
        let first = route(upload("audio"), room.clone(), attempts.clone()).await;
        assert_eq!(first.status(), 200);
        let first: Value =
            serde_json::from_slice(&first.into_body().collect().await.unwrap().to_bytes()).unwrap();
        let key = first["key"].as_str().unwrap();
        for _ in 0..3 {
            let repeated = route(upload("audio"), room.clone(), attempts.clone()).await;
            assert_eq!(repeated.status(), 200);
            let repeated: Value =
                serde_json::from_slice(&repeated.into_body().collect().await.unwrap().to_bytes())
                    .unwrap();
            assert_eq!(repeated, first);
        }
        {
            let mut room = room.lock().await;
            assert_eq!(room.files.len(), 1);
            assert_eq!(room.files[key].size, 5);
            // Exercise the full-room boundary without allocating five gigabytes.
            room.files.get_mut(key).unwrap().size = crate::jam_room::ROOM_STORAGE_LIMIT;
        }
        assert_eq!(
            route(upload("audio"), room.clone(), attempts.clone())
                .await
                .status(),
            200
        );
        let rejected = route(upload("different audio"), room.clone(), attempts.clone()).await;
        assert_eq!(rejected.status(), 413);
        assert_eq!(room.lock().await.files.len(), 1);
        let request = Request::builder()
            .uri(format!("/rooms/{code}/files/{key}"))
            .header("authorization", format!("Bearer {token}"))
            .body(Bytes::new())
            .unwrap();
        let downloaded = route(request, room.clone(), attempts).await;
        assert_eq!(downloaded.status(), 200);
        assert_eq!(
            &downloaded.into_body().collect().await.unwrap().to_bytes()[..],
            b"audio"
        );
    }
    #[tokio::test]
    async fn jam_guest_pause_resume_preserves_room_and_shared_audio() {
        let (server, code, host_token, task) = setup().await;
        let client = reqwest::Client::new();
        let root = format!("{server}/rooms/{code}");
        async fn post(client: &reqwest::Client, url: &str, token: &str, body: Value) -> Value {
            client
                .post(url)
                .bearer_auth(token)
                .json(&body)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap()
        }
        let host: Value = client
            .get(&root)
            .bearer_auth(&host_token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let guest = post(
            &client,
            &format!("{root}/join"),
            "",
            json!({"name":"Guest"}),
        )
        .await;
        let guest_token = guest["token"].as_str().unwrap();
        let file: Value = client
            .post(format!("{root}/files"))
            .bearer_auth(&host_token)
            .header("x-audio-extension", "mp3")
            .body("shared audio")
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        let command_url = format!("{root}/command");
        let started = post(
            &client,
            &command_url,
            &host_token,
            json!({"action":"play","tracks":[
                {"title":"Local song","fileKey":file["key"]},
                {"title":"Next song","url":"https://youtu.be/abc"}
            ]}),
        )
        .await;
        for token in [&host_token[..], guest_token] {
            post(
                &client,
                &command_url,
                token,
                json!({"action":"ready","generation":started["generation"]}),
            )
            .await;
        }
        post(
            &client,
            &command_url,
            &host_token,
            json!({"action":"seek","position":30}),
        )
        .await;
        for playing in [false, true, false, true] {
            let changed = post(
                &client,
                &command_url,
                guest_token,
                json!({"action":"toggle"}),
            )
            .await;
            assert_eq!(changed["playing"], playing);
            assert_eq!(changed["waiting"], false);
            assert_eq!(changed["host"], host["host"]);
            assert_eq!(changed["members"].as_array().unwrap().len(), 2);
            assert_eq!(changed["current"], started["current"]);
            assert_eq!(changed["shared"], started["shared"]);
            assert_eq!(changed["queue"], started["queue"]);
            assert_eq!(changed["generation"], started["generation"]);
            assert!(changed["position"].as_f64().unwrap() >= 30.0);
            for token in [&host_token[..], guest_token] {
                let snapshot: Value = client
                    .get(&root)
                    .bearer_auth(token)
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap()
                    .json()
                    .await
                    .unwrap();
                assert_eq!(snapshot["playing"], playing);
                let audio = client
                    .get(format!("{root}/files/{}", file["key"].as_str().unwrap()))
                    .bearer_auth(token)
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap();
                assert_eq!(&audio[..], b"shared audio");
            }
        }
        post(
            &client,
            &command_url,
            &host_token,
            json!({"action":"permissions","hostOnly":true}),
        )
        .await;
        assert_eq!(
            client
                .post(&command_url)
                .bearer_auth(guest_token)
                .json(&json!({"action":"toggle"}))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        let snapshot: Value = client
            .get(&root)
            .bearer_auth(guest_token)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(snapshot["playing"], true);
        assert_eq!(snapshot["members"].as_array().unwrap().len(), 2);
        task.abort();
        let _ = task.await;
    }
    async fn setup() -> (String, String, String, JoinHandle<()>) {
        let (room, token, _) = Room::new("Host").unwrap();
        let code = room.code.clone();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let server = format!("http://{}", listener.local_addr().unwrap());
        (server, code, token, tokio::spawn(serve(listener, room)))
    }
    #[tokio::test]
    async fn jam_host_invite_nicknames_permissions_and_shutdown() {
        let (server, code, token, task) = setup().await;
        let client = reqwest::Client::new();
        let root = format!("{server}/rooms/{code}");
        assert_eq!(client.get(&root).send().await.unwrap().status(), 401);
        let joined: Value = client
            .post(format!("{root}/join"))
            .json(&json!({"name":"Friend"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let friend = joined["token"].as_str().unwrap();
        assert!(joined["room"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["name"] == "Friend"));
        client
            .post(format!("{root}/command"))
            .bearer_auth(&token)
            .json(&json!({"action":"permissions","hostOnly":true}))
            .send()
            .await
            .unwrap();
        let renamed: Value = client
            .post(format!("{root}/command"))
            .bearer_auth(friend)
            .json(&json!({"action":"nickname","name":"Moon","memberId":joined["room"]["host"]}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let members = renamed["members"].as_array().unwrap();
        assert!(members.iter().any(|m| m["name"] == "Host"));
        assert!(members.iter().any(|m| m["name"] == "Moon"));
        assert_eq!(
            client
                .post(format!("{root}/command"))
                .bearer_auth(friend)
                .json(&json!({"action":"skip"}))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        assert_eq!(
            client
                .post(format!("{root}/command"))
                .bearer_auth(friend)
                .json(&json!({"action":"nickname","name":"   "}))
                .send()
                .await
                .unwrap()
                .status(),
            400
        );
        task.abort();
        let _ = task.await;
        assert!(client.get(format!("{server}/health")).send().await.is_err());
    }
    #[tokio::test]
    async fn jam_host_audio_transfer_and_chunked_http() {
        let (server, code, token, task) = setup().await;
        let client = reqwest::Client::new();
        let root = format!("{server}/rooms/{code}");
        let uploaded: Value = client
            .post(format!("{root}/files"))
            .bearer_auth(&token)
            .header("x-audio-extension", "mp3")
            .body("audio bytes")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let key = uploaded["key"].as_str().unwrap();
        let stored_path = std::env::temp_dir().join(format!("phoebeats-jam-{key}.audio"));
        assert_eq!(tokio::fs::read(&stored_path).await.unwrap(), b"audio bytes");
        let downloaded = client
            .get(format!("{root}/files/{key}"))
            .bearer_auth(&token)
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(&downloaded[..], b"audio bytes");
        let address = server.trim_start_matches("http://");
        let mut socket = TcpStream::connect(address).await.unwrap();
        let body = r#"{"name":"Chunked friend"}"#;
        let request = format!("POST /rooms/{code}/join HTTP/1.1\r\nHost: {address}\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n",body.len());
        socket.write_all(request.as_bytes()).await.unwrap();
        let mut result = String::new();
        socket.read_to_string(&mut result).await.unwrap();
        assert!(result.starts_with("HTTP/1.1 200"));
        assert!(result.contains("Chunked friend"));
        let mut bad = TcpStream::connect(address).await.unwrap();
        bad.write_all(format!("POST /rooms/{code}/join HTTP/1.1\r\nHost: {address}\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n").as_bytes()).await.unwrap();
        let mut result = String::new();
        bad.read_to_string(&mut result).await.unwrap();
        assert!(result.starts_with("HTTP/1.1 400"));
        task.abort();
        let _ = task.await;
    }
}
