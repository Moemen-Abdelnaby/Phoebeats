use std::path::Path;

/// Preserve EXTINF metadata and resolve files relative to the playlist, not the
/// application's working directory. Do not require files to exist at import time.
pub fn import_lines(content: &str, playlist: &Path) -> Result<Vec<String>, String> {
    content
        .trim_start_matches('\u{feff}')
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| {
            if line.starts_with('#') || line.starts_with("local://") {
                return Ok(line.to_string());
            }
            if line.to_ascii_lowercase().starts_with("file://") {
                let path = reqwest::Url::parse(line)
                    .map_err(|e| e.to_string())?
                    .to_file_path()
                    .map_err(|_| "Invalid file URL in playlist".to_string())?;
                return Ok(format!("local://{}", path.to_string_lossy()));
            }
            if line.contains("://") {
                return Ok(line.to_string());
            }
            let path = Path::new(line);
            let resolved = if path.is_absolute() {
                path.to_path_buf()
            } else {
                playlist.parent().unwrap_or(Path::new(".")).join(path)
            };
            Ok(format!("local://{}", resolved.to_string_lossy()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_metadata_urls_and_resolves_relative_files() {
        let root = std::env::temp_dir();
        let lines = import_lines("\u{feff}#EXTM3U\r\n#EXTINF:90,Artist - Song\r\nsong.mp3\r\nhttps://example.com/song\nlocal://existing.mp3\n", &root.join("list.m3u8")).unwrap();
        assert_eq!(lines[0], "#EXTM3U");
        assert_eq!(lines[1], "#EXTINF:90,Artist - Song");
        assert_eq!(
            lines[2],
            format!("local://{}", root.join("song.mp3").to_string_lossy())
        );
        assert_eq!(lines[3], "https://example.com/song");
        assert_eq!(lines[4], "local://existing.mp3");
        assert!(import_lines("\n", &root.join("empty.m3u"))
            .unwrap()
            .is_empty());
    }
    #[test]
    fn accepts_absolute_paths_and_encoded_file_urls() {
        let path = std::env::temp_dir().join("song with spaces.mp3");
        let uri = reqwest::Url::from_file_path(&path).unwrap();
        let playlist = path.with_extension("m3u");
        let expected = format!("local://{}", path.to_string_lossy());
        assert_eq!(
            import_lines(uri.as_str(), &playlist).unwrap(),
            vec![expected.clone()]
        );
        assert_eq!(
            import_lines(&path.to_string_lossy(), &playlist).unwrap(),
            vec![expected]
        );
    }
}
