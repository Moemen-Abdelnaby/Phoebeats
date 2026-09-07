import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Track } from "../types";

/** Local library artwork is lazy-loaded, so saved playlist covers may be empty. */
export function LocalPlaylistArtwork({ track }: { track: Track }) {
  const [cover, setCover] = useState(track.cover || "");
  const [retry, setRetry] = useState(false);
  useEffect(() => {
    let active = true;
    setCover(retry ? "" : track.cover || "");
    if (!track.cover || retry) {
      void invoke<string | null>("get_audio_cover", {
        path: track.url.slice("local://".length),
      })
        .then((value) => {
          if (active) setCover(value || "");
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [track.url, track.cover, retry]);
  if (!cover) return null;
  return (
    <img
      src={cover}
      alt=""
      loading="lazy"
      decoding="async"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "cover",
      }}
      onError={() => {
        setCover("");
        if (!retry) setRetry(true);
      }}
    />
  );
}
