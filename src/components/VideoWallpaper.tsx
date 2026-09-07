import { useEffect, useRef } from "react";
import { startWallpaperPlayback } from "../hooks/wallpaperPlayback";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWallpaperSettings } from "../hooks/wallpaperSettings";

interface VideoWallpaperProps {
  enabled: boolean;
  performanceMode: boolean;
}

export function VideoWallpaper({
  enabled,
  performanceMode,
}: VideoWallpaperProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [wallpaper] = useWallpaperSettings();
  useEffect(() => {
    const restart = () => {
      if (ref.current) {
        ref.current.currentTime = 0;
        ref.current.load();
        window.dispatchEvent(new Event("phoebeats-wallpaper-resume"));
      }
    };
    window.addEventListener("pb-wallpaper-restart", restart);
    return () => window.removeEventListener("pb-wallpaper-restart", restart);
  }, []);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused)
          window.dispatchEvent(new Event("phoebeats-wallpaper-resume"));
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    return startWallpaperPlayback(
      video,
      enabled && !performanceMode && !wallpaper.paused,
    );
  }, [enabled, performanceMode, wallpaper.paused, wallpaper.quality]);

  return (
    <div className="pb-wallpaper" aria-hidden="true" hidden={!enabled}>
      <video
        key={wallpaper.quality}
        ref={ref}
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
        tabIndex={-1}
        poster={`${import.meta.env.BASE_URL}wallpapers/phoebe-poster.jpg`}
      >
        <source
          src={`${import.meta.env.BASE_URL}wallpapers/${wallpaper.quality === "1080p" ? "phoebe-1080p.mp4" : "phoebe.mp4"}`}
          type="video/mp4"
        />
      </video>
      <div
        className="pb-wallpaper-overlay"
        style={{ background: `rgba(4,12,23,${wallpaper.dim})` }}
      />
    </div>
  );
}
