import { useEffect, useState } from "react";
import { loadLS, saveLS } from "../utils";
export interface WallpaperSettings {
  paused: boolean;
  dim: number;
  quality: "original" | "1080p";
}
export function readWallpaperSettings(): WallpaperSettings {
  const v = loadLS<Partial<WallpaperSettings>>("pb_wallpaper", {});
  return {
    paused: v?.paused === true,
    dim: Number.isFinite(v?.dim)
      ? Math.max(0, Math.min(0.85, Number(v.dim)))
      : 0.12,
    quality: v?.quality === "original" ? "original" : "1080p",
  };
}
export function useWallpaperSettings() {
  const [settings, setSettings] = useState(readWallpaperSettings);
  useEffect(() => {
    const update = () => setSettings(readWallpaperSettings());
    window.addEventListener("pb-wallpaper-settings", update);
    return () => window.removeEventListener("pb-wallpaper-settings", update);
  }, []);
  return [
    settings,
    (next: WallpaperSettings) => {
      saveLS("pb_wallpaper", next);
      window.dispatchEvent(new Event("pb-wallpaper-settings"));
    },
  ] as const;
}
