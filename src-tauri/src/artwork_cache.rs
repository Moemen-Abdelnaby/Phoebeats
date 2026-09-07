//! Shared, bounded artwork cache, including negative results. Each key has its
//! own lock so duplicate requests coalesce without serializing unrelated tracks.
use std::{
    collections::VecDeque,
    path::Path,
    sync::{Arc, LazyLock, Mutex},
    time::SystemTime,
};

type Stamp = Option<(u64, Option<SystemTime>)>;
type Slot = Arc<Mutex<Option<Option<String>>>>;
#[derive(Clone, PartialEq)]
struct Key {
    path: std::path::PathBuf,
    file: Stamp,
    directory: Stamp,
    cover: Option<(std::path::PathBuf, Stamp)>,
}
static CACHE: LazyLock<Mutex<VecDeque<(Key, Slot)>>> =
    LazyLock::new(|| Mutex::new(VecDeque::new()));
fn stamp(path: &Path) -> Stamp {
    std::fs::metadata(path)
        .ok()
        .map(|m| (m.len(), m.modified().ok()))
}
pub fn get(
    path: &Path,
    extract: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    let key = Key {
        path: path.to_path_buf(),
        file: stamp(path),
        directory: path.parent().and_then(stamp),
        cover: crate::metadata::find_directory_cover(path).map(|p| {
            let s = stamp(&p);
            (p, s)
        }),
    };
    // Missing files are not cached: they may be restored at any time.
    if key.file.is_none() {
        return extract();
    }
    let slot = {
        let mut cache = CACHE.lock().map_err(|e| e.to_string())?;
        if let Some(index) = cache.iter().position(|(k, _)| k == &key) {
            let entry = cache.remove(index).unwrap();
            let slot = entry.1.clone();
            cache.push_back(entry);
            slot
        } else {
            cache.retain(|(k, _)| k.path != key.path);
            while cache.len() >= 64 {
                cache.pop_front();
            }
            let slot = Arc::new(Mutex::new(None));
            cache.push_back((key, slot.clone()));
            slot
        }
    };
    let mut stored = slot.lock().map_err(|e| e.to_string())?;
    if let Some(result) = &*stored {
        return Ok(result.clone());
    }
    let result = extract()?;
    // At most 32 MiB of retained image strings, without downscaling originals.
    if result.as_ref().map_or(true, |s| s.len() <= 512 * 1024) {
        *stored = Some(result.clone());
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn caches_misses_and_invalidates_changed_files_and_sidecars() {
        let dir = std::env::temp_dir().join(format!(
            "pb-art-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let song = dir.join("song.mp3");
        let cover = dir.join("song.jpg");
        std::fs::write(&song, b"test").unwrap();
        assert_eq!(get(&song, || Ok(None)).unwrap(), None);
        assert_eq!(
            get(&song, || panic!("negative cache missed")).unwrap(),
            None
        );
        std::fs::write(&cover, b"image").unwrap();
        assert_eq!(
            get(&song, || Ok(Some("image".into()))).unwrap().as_deref(),
            Some("image")
        );
        assert_eq!(
            get(&song, || panic!("positive cache missed"))
                .unwrap()
                .as_deref(),
            Some("image")
        );
        std::fs::write(&cover, b"changed image").unwrap();
        assert_eq!(
            get(&song, || Ok(Some("changed".into())))
                .unwrap()
                .as_deref(),
            Some("changed")
        );
        std::fs::write(&song, b"different audio").unwrap();
        assert_eq!(get(&song, || Ok(None)).unwrap(), None);
        std::fs::remove_file(&cover).unwrap();
        std::fs::remove_file(&song).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
