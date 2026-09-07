import { useWallpaperSettings } from "../hooks/wallpaperSettings";
export function WallpaperControls() {
  const [settings, save] = useWallpaperSettings();
  return (
    <section className="pb-feature-card">
      <h3>Wallpaper</h3>
      <button onClick={() => save({ ...settings, paused: !settings.paused })}>
        {settings.paused ? "Resume wallpaper" : "Pause wallpaper"}
      </button>
      <button
        onClick={() => window.dispatchEvent(new Event("pb-wallpaper-restart"))}
      >
        Restart wallpaper
      </button>
      <label>
        Dimming{" "}
        <input
          aria-label="Wallpaper dimming"
          type="range"
          min={0}
          max={85}
          value={Math.round(settings.dim * 100)}
          onChange={(e) =>
            save({ ...settings, dim: Number(e.target.value) / 100 })
          }
        />
      </label>
      <label>
        Video quality{" "}
        <select
          value={settings.quality}
          onChange={(e) =>
            save({
              ...settings,
              quality: e.target.value as "original" | "1080p",
            })
          }
        >
          <option value="1080p">1080p · lower GPU usage</option>
          <option value="original">Original · 4K</option>
        </select>
      </label>
    </section>
  );
}
