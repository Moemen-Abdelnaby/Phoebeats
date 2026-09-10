//! The room protocol shared by the automatic desktop host and its guests.
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};

pub fn random_id(bytes: usize) -> String {
    let mut data = vec![0; bytes];
    getrandom::getrandom(&mut data).expect("Operating system randomness unavailable");
    data.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn jam_room_disk_capacity_and_cleanup() {
        assert!(room_has_capacity(500 * 1024 * 1024, 100 * 1024 * 1024));
        assert!(room_has_capacity(ROOM_STORAGE_LIMIT - 1, 1));
        assert!(!room_has_capacity(ROOM_STORAGE_LIMIT, 1));
        assert!(!room_has_capacity(u64::MAX, 1));
        let path = std::env::temp_dir().join(format!("phoebeats-jam-test-{}", random_id(18)));
        std::fs::write(&path, b"audio").unwrap();
        let (mut room, _, owner) = Room::new("Host").unwrap();
        room.files.insert(
            "test".into(),
            File {
                path: path.clone(),
                size: 5,
                ext: "mp3".into(),
                owner,
            },
        );
        drop(room);
        assert!(
            !path.exists(),
            "Closing the room must remove its temporary audio"
        );
    }
    #[test]
    fn jam_room_shared_shuffle_and_ready_barrier() {
        let (mut r, _, host) = Room::new("Host").unwrap();
        let (_, friend) = r.join("Friend").unwrap();
        let songs: Vec<Value> = (0..5).map(|i|json!({"title":format!("Song {i}"),"url":format!("https://www.youtube.com/watch?v={i}")})).collect();
        let before = r
            .command(&host, &json!({"action":"play","tracks":songs}))
            .unwrap();
        let generation = before["generation"].as_u64().unwrap();
        assert_eq!(before["waiting"], true);
        assert_eq!(before["playing"], false);
        r.command(&host, &json!({"action":"ready","generation":generation}))
            .unwrap();
        assert!(!r.playing);
        r.command(&friend, &json!({"action":"ready","generation":generation}))
            .unwrap();
        assert!(r.playing);
        r.command(&friend, &json!({"action":"shuffle"})).unwrap();
        assert_eq!(r.queue.len(), 4);
        let after = r.command(&host, &json!({"action":"shuffle"})).unwrap();
        assert_eq!(before["queue"], after["queue"]);
        r.command(&host, &json!({"action":"ended","generation":generation}))
            .unwrap();
        r.command(&host, &json!({"action":"ended","generation":generation}))
            .unwrap();
        assert_eq!(r.current.as_ref().unwrap()["title"], "Song 1");
    }
    #[test]
    fn jam_room_rename_updates_attribution_and_validates_input() {
        let (mut r, _, host) = Room::new("Host").unwrap();
        let (_, friend) = r.join("Friend").unwrap();
        r.command(
            &friend,
            &json!({"action":"play","tracks":[{"title":"Song","url":"https://youtu.be/abc"}]}),
        )
        .unwrap();
        r.command(&host, &json!({"action":"permissions","hostOnly":true}))
            .unwrap();
        let renamed = r
            .command(&friend, &json!({"action":"nickname","name":"  Luna  "}))
            .unwrap();
        assert_eq!(renamed["shared"][0]["sharedBy"], "Luna");
        assert_eq!(renamed["current"]["sharedBy"], "Luna");
        for name in ["", "   ", "na\nme", "a\u{7f}"] {
            assert!(nickname(name).is_err());
        }
        assert!(nickname(&"x".repeat(41)).is_err());
        assert!(r.command(&friend, &json!({"action":"skip"})).is_err());
    }
}
fn shuffle(list: &mut [Value]) {
    for i in (1..list.len()).rev() {
        let bound = (i + 1) as u64;
        let limit = u64::MAX - u64::MAX % bound;
        let selected = loop {
            let mut bytes = [0; 8];
            getrandom::getrandom(&mut bytes).expect("Operating system randomness unavailable");
            let n = u64::from_le_bytes(bytes);
            if n < limit {
                break (n % bound) as usize;
            }
        };
        list.swap(i, selected);
    }
}
pub fn nickname(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 40 || name.chars().any(char::is_control) {
        return Err("Choose a nickname with 1–40 characters.".into());
    }
    Ok(name.to_string())
}
pub struct Member {
    pub id: String,
    pub name: String,
    seen: Instant,
}
pub struct File {
    pub path: std::path::PathBuf,
    pub size: u64,
    pub ext: String,
    pub owner: String,
}
impl Drop for File {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
pub const ROOM_STORAGE_LIMIT: u64 = 5 * 1024 * 1024 * 1024;
pub fn room_has_capacity(used: u64, incoming: u64) -> bool {
    used.checked_add(incoming)
        .is_some_and(|total| total <= ROOM_STORAGE_LIMIT)
}
pub struct Room {
    pub code: String,
    pub host: String,
    owner: String,
    pub members: HashMap<String, Member>,
    pub files: HashMap<String, File>,
    queue: Vec<Value>,
    original: Vec<String>,
    shared: Vec<Value>,
    current: Option<Value>,
    position: f64,
    at: Instant,
    playing: bool,
    shuffled: bool,
    repeat: String,
    host_only: bool,
    revision: u64,
    generation: u64,
    waiting: bool,
    ready: HashSet<String>,
}
impl Room {
    pub fn new(name: &str) -> Result<(Self, String, String), String> {
        let mut room = Self {
            code: random_id(5).to_uppercase(),
            host: String::new(),
            owner: String::new(),
            members: HashMap::new(),
            files: HashMap::new(),
            queue: vec![],
            original: vec![],
            shared: vec![],
            current: None,
            position: 0.,
            at: Instant::now(),
            playing: false,
            shuffled: false,
            repeat: "off".into(),
            host_only: false,
            revision: 0,
            generation: 0,
            waiting: false,
            ready: HashSet::new(),
        };
        let (token, id) = room.join(name)?;
        room.host = id.clone();
        room.owner = id.clone();
        Ok((room, token, id))
    }
    pub fn join(&mut self, name: &str) -> Result<(String, String), String> {
        let name = nickname(name)?;
        self.prune();
        if self.members.len() >= 2 {
            return Err("This Jam already has two people.".into());
        }
        let token = random_id(18);
        let id = random_id(18);
        self.members.insert(
            token.clone(),
            Member {
                id: id.clone(),
                name,
                seen: Instant::now(),
            },
        );
        Ok((token, id))
    }
    pub fn authenticate(&mut self, token: &str) -> Result<String, String> {
        self.prune();
        let m = self
            .members
            .get_mut(token)
            .ok_or("Jam expired or access denied. Join again.")?;
        m.seen = Instant::now();
        Ok(m.id.clone())
    }
    pub fn prune(&mut self) {
        // The owner exists for the lifetime of the embedded host, including
        // Internet helper installation and long local playback operations.
        self.members
            .retain(|_, m| m.id == self.owner || m.seen.elapsed() < Duration::from_secs(45));
        if !self.members.values().any(|m| m.id == self.host) {
            self.host = self
                .members
                .values()
                .next()
                .map(|m| m.id.clone())
                .unwrap_or_default();
        }
        self.ready_to_play();
    }
    pub fn leave(&mut self, token: &str) {
        self.members.remove(token);
        self.prune();
    }
    fn pos(&self) -> f64 {
        self.position
            + if self.playing {
                self.at.elapsed().as_secs_f64()
            } else {
                0.
            }
    }
    pub fn snapshot(&self) -> Value {
        let members: Vec<_> = self
            .members
            .values()
            .map(|m| json!({"id":m.id,"name":m.name}))
            .collect();
        json!({"code":self.code,"host":self.host,"members":members,"queue":self.queue,"current":self.current,"shared":self.shared,"playing":self.playing,"position":self.pos(),
            "shuffle":self.shuffled,"repeat":self.repeat,"hostOnly":self.host_only,"revision":self.revision,"generation":self.generation,"waiting":self.waiting})
    }
    fn buffer(&mut self) {
        self.waiting = self.current.is_some();
        self.ready.clear();
        self.playing = false;
    }
    fn ready_to_play(&mut self) {
        if self.waiting
            && !self.members.is_empty()
            && self.members.values().all(|m| self.ready.contains(&m.id))
        {
            self.waiting = false;
            self.playing = true;
            self.at = Instant::now();
            self.revision += 1;
        }
    }
    fn advance(&mut self, ended: bool) {
        if !(ended && self.repeat == "one" && self.current.is_some()) {
            if self.repeat == "all" {
                if let Some(t) = &self.current {
                    self.queue.push(t.clone());
                }
            }
            self.current = if self.queue.is_empty() {
                None
            } else {
                Some(self.queue.remove(0))
            };
        }
        self.position = 0.;
        self.at = Instant::now();
        self.generation += 1;
        self.buffer();
    }
    fn tracks(&mut self, body: &Value, member: &str, replace: bool) -> Result<Vec<Value>, String> {
        let input = body["tracks"].as_array().ok_or("Choose songs to share.")?;
        if input.len() > 500 || input.len() + if replace { 0 } else { self.queue.len() } > 1000 {
            return Err("Choose up to 500 songs; the queue holds 1000.".into());
        }
        let mut additions = vec![];
        let mut result = vec![];
        for t in input {
            if let Some(existing) = self
                .shared
                .iter()
                .find(|s| t["jamId"].is_string() && s["jamId"] == t["jamId"])
            {
                result.push(existing.clone());
                continue;
            }
            let key = t["fileKey"].as_str().unwrap_or("");
            let ext = if !key.is_empty() {
                let file = self.files.get(key).ok_or("Shared file unavailable.")?;
                if file.owner != member {
                    return Err("File was not shared by you.".into());
                }
                file.ext.clone()
            } else {
                let url = reqwest::Url::parse(t["url"].as_str().unwrap_or(""))
                    .map_err(|_| "Invalid song URL.")?;
                if url.scheme() != "https"
                    || ![
                        "youtube.com",
                        "www.youtube.com",
                        "music.youtube.com",
                        "youtu.be",
                    ]
                    .contains(&url.host_str().unwrap_or(""))
                    || !url.username().is_empty()
                    || url.password().is_some()
                {
                    return Err("Only YouTube tracks or shared audio files are supported.".into());
                }
                String::new()
            };
            if let Some(existing) = self.shared.iter().chain(additions.iter()).find(|s| {
                s["owner"] == member
                    && if key.is_empty() {
                        s["url"] == t["url"]
                    } else {
                        s["fileKey"] == key
                    }
            }) {
                result.push(existing.clone());
                continue;
            }
            let text = |k: &str, default: &str, max: usize| {
                t[k].as_str()
                    .unwrap_or(default)
                    .chars()
                    .take(max)
                    .collect::<String>()
            };
            let name = &self
                .members
                .values()
                .find(|m| m.id == member)
                .ok_or("Member left.")?
                .name;
            let mut track = json!({"id":0,"jamId":random_id(18),"title":text("title","Untitled",250),"artist":text("artist","",250),"duration":text("duration","0:00",20),"cover":"","url":if key.is_empty(){t["url"].as_str().unwrap_or("")}else{""},"owner":member,"sharedBy":name});
            if !key.is_empty() {
                track["fileKey"] = json!(key);
                track["ext"] = json!(ext);
            }
            additions.push(track.clone());
            result.push(track);
        }
        if self.shared.len() + additions.len() > 2000 {
            return Err("Jam song limit reached. Start a new room.".into());
        }
        self.shared.extend(additions);
        Ok(result)
    }
    pub fn command(&mut self, member: &str, body: &Value) -> Result<Value, String> {
        let action = body["action"].as_str().unwrap_or("");
        if action == "nickname" {
            let name = nickname(body["name"].as_str().unwrap_or(""))?;
            self.members
                .values_mut()
                .find(|m| m.id == member)
                .ok_or("Member left.")?
                .name = name.clone();
            for song in self
                .shared
                .iter_mut()
                .chain(self.queue.iter_mut())
                .chain(self.current.iter_mut())
            {
                if song["owner"] == member {
                    song["sharedBy"] = json!(name);
                }
            }
            self.revision += 1;
            return Ok(self.snapshot());
        }
        if action == "ready" {
            if body["generation"].as_u64() == Some(self.generation) {
                self.ready.insert(member.into());
                self.ready_to_play();
            }
            return Ok(self.snapshot());
        }
        if action == "permissions" && member != self.host {
            return Err("Only the host can change permissions.".into());
        }
        if self.host_only && member != self.host && !["add", "next"].contains(&action) {
            return Err("Only the host can control playback.".into());
        }
        match action {
            "play" => {
                let tracks = self.tracks(body, member, true)?;
                let index = (body["index"].as_u64().unwrap_or(0) as usize)
                    .min(tracks.len().saturating_sub(1));
                self.current = tracks.get(index).cloned();
                self.original = tracks
                    .iter()
                    .map(|t| t["jamId"].as_str().unwrap_or("").into())
                    .collect();
                self.queue = if self.shuffled {
                    tracks
                        .into_iter()
                        .enumerate()
                        .filter(|(i, _)| *i != index)
                        .map(|(_, t)| t)
                        .collect()
                } else {
                    tracks.into_iter().skip(index + 1).collect()
                };
                if self.shuffled {
                    shuffle(&mut self.queue);
                }
                self.position = 0.;
                self.at = Instant::now();
                self.generation += 1;
                self.buffer();
            }
            "add" | "next" => {
                let tracks = self.tracks(body, member, false)?;
                for t in &tracks {
                    let id = t["jamId"].as_str().unwrap_or("").to_string();
                    if !self.original.contains(&id) {
                        self.original.push(id);
                    }
                }
                if action == "next" {
                    self.queue.splice(0..0, tracks);
                } else {
                    self.queue.extend(tracks);
                }
            }
            "toggle" => {
                self.waiting = false;
                self.position = self.pos();
                self.at = Instant::now();
                self.playing = self.current.is_some() && !self.playing;
            }
            "seek" => {
                let p = body["position"]
                    .as_f64()
                    .filter(|p| p.is_finite() && *p >= 0.)
                    .ok_or("Invalid position.")?;
                self.position = p;
                self.at = Instant::now();
            }
            "skip" => self.advance(false),
            "ended" => {
                if member == self.host
                    && self.playing
                    && body["generation"].as_u64() == Some(self.generation)
                {
                    self.advance(true);
                }
            }
            "back" => {
                self.position = 0.;
                self.at = Instant::now();
                self.generation += 1;
            }
            "shuffle" => {
                self.shuffled = !self.shuffled;
                if self.shuffled {
                    shuffle(&mut self.queue);
                } else {
                    self.queue.sort_by_key(|t| {
                        self.original
                            .iter()
                            .position(|id| t["jamId"] == *id)
                            .unwrap_or(usize::MAX)
                    });
                }
            }
            "repeat" => {
                self.repeat = match self.repeat.as_str() {
                    "off" => "all",
                    "all" => "one",
                    _ => "off",
                }
                .into()
            }
            "permissions" => self.host_only = body["hostOnly"].as_bool().unwrap_or(false),
            "clear" => self.queue.clear(),
            "remove" => {
                if let Some(i) = body["index"].as_u64() {
                    if (i as usize) < self.queue.len() {
                        self.queue.remove(i as usize);
                    }
                }
            }
            "reorder" => {
                let from = body["from"].as_u64().ok_or("Invalid queue position.")? as usize;
                let to = body["to"].as_u64().ok_or("Invalid queue position.")? as usize;
                if from >= self.queue.len() || to >= self.queue.len() {
                    return Err("Invalid queue position.".into());
                }
                let item = self.queue.remove(from);
                self.queue.insert(to, item);
            }
            _ => return Err("Unknown command.".into()),
        }
        self.revision += 1;
        Ok(self.snapshot())
    }
}
