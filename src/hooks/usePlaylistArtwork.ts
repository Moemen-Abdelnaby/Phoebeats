import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Playlist } from "../types";
export function usePlaylistArtwork(playlists: Playlist[]) {
  const [covers, setCovers] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const sources = [
      ...new Set(
        playlists
          .filter(
            (p) =>
              !p.customCover &&
              p.tracks[0]?.url.startsWith("local://") &&
              !p.tracks[0].cover,
          )
          .map((p) => p.tracks[0].url),
      ),
    ];
    void (async () => {
      for (const url of sources) {
        if (cancelled) return;
        if (covers[url] !== undefined) continue;
        const cover = await invoke<string | null>("get_audio_cover", {
          path: url.slice(8),
        }).catch(() => null);
        if (!cancelled) setCovers((prev) => ({ ...prev, [url]: cover || "" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playlists]);
  return useCallback(
    (p: Playlist) =>
      p.customCover || p.tracks[0]?.cover || covers[p.tracks[0]?.url] || null,
    [covers],
  );
}
