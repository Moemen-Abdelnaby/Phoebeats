import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ListMusic,
  Settings,
  Shuffle,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Heart,
} from "lucide-react";
import type { Track, RepeatMode } from "../../types";
import brand from "../../assets/brand-icon.png";
import { formatTime, loadLS, saveLS } from "../../utils";
import { usePlaybackProgress } from "../../hooks/playbackProgress";

type Props = {
  nickname?: string;
  currentTrack: Track | null;
  getTrackCover: (track: Track | null) => string;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  isTrackLiked: (url: string) => boolean;
  toggleLikeTrack: (track: Track) => void;
  toggleShuffle: () => void;
  shuffle: boolean;
  handleSkipBack: () => void;
  handleSkipForward: () => void;
  togglePlayPause: () => void;
  repeatMode: RepeatMode;
  cycleRepeat: () => void;
  progressRef: React.RefObject<HTMLDivElement | null>;
  trackDurationSeconds: number;
  updateProgressFromEvent?: (clientX: number) => void;
  showToast?: (message: string) => void;
  toggleMute: () => void;
  volume: number;
  setVolume: (volume: number) => void;
  panelOpen: boolean;
  onOpenPlaylists: () => void;
  onOpenSettings: () => void;
};

export function CompactPlayer(props: Props) {
  const [controlsVisible, setControlsVisible] = useState(
    () => !loadLS("pb_playerCollapsed", false),
  );
  const progressSeconds = usePlaybackProgress(controlsVisible);
  const p = { ...props, progressSeconds };
  const [showGreeting, setShowGreeting] = useState(false);
  useEffect(() => {
    if (!controlsVisible) return;
    const timer = window.setInterval(() => setShowGreeting((value) => !value), 8000);
    return () => window.clearInterval(timer);
  }, [controlsVisible]);
  const localHour = new Date().getHours();
  const greeting = localHour < 12
    ? "Good morning"
    : localHour < 18
      ? "Good afternoon"
      : "Good evening";
  const headerLabel = showGreeting
    ? `${greeting}${p.nickname ? `, ${p.nickname}` : ""}`
    : p.nickname || "Phoebeats";
  const [position, setPosition] = useState(() => {
    const value = loadLS<{ right?: number; top?: number } | null>(
      "pb_playerPosition",
      null,
    );
    return {
      right: Number.isFinite(value?.right) ? Number(value?.right) : 32,
      top: Number.isFinite(value?.top) ? Number(value?.top) : 24,
    };
  });
  useEffect(() => {
    saveLS("pb_playerCollapsed", !controlsVisible);
  }, [controlsVisible]);
  useEffect(() => {
    saveLS("pb_playerPosition", position);
  }, [position]);
  const fitPosition = (right: number, top: number) => ({
    right: Math.max(
      8,
      Math.min(
        Number.isFinite(right) ? right : 32,
        Math.max(8, window.innerWidth - 350),
      ),
    ),
    top: Math.max(
      8,
      Math.min(
        Number.isFinite(top) ? top : 24,
        Math.max(8, window.innerHeight - 300),
      ),
    ),
  });
  useEffect(() => {
    const fit = () => setPosition((p) => fitPosition(p.right, p.top));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const cover = p.getTrackCover(p.currentTrack);
  const trackUrl = p.currentTrack?.url || "";
  const [artwork, setArtwork] = useState({ url: "", cover: "" });
  useEffect(() => {
    let active = true;
    setArtwork({ url: trackUrl, cover });
    if (!cover && trackUrl.startsWith("local://")) {
      void invoke<string | null>("get_audio_cover", {
        path: trackUrl.slice("local://".length),
      })
        .then((image) => {
          if (active) setArtwork({ url: trackUrl, cover: image || "" });
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [trackUrl, cover]);
  const songImage = (artwork.url === trackUrl ? artwork.cover : cover) || brand;
  return (
    <section
      className="pb-mini-player"
      aria-label="Music player"
      data-collapsed={!controlsVisible}
      style={{ right: position.right, top: position.top }}
    >
      <header className="pb-mini-header">
        <button
          aria-label="Open playlists"
          title="Open playlists"
          aria-expanded={p.panelOpen}
          onClick={p.onOpenPlaylists}
        >
          <ListMusic size={19} />
        </button>
        <span
          className="pb-mini-nickname"
          title={`${headerLabel} · Drag to move player`}
          style={{ cursor: "grab", touchAction: "none" }}
          onPointerDown={(e) => {
            const startX = e.clientX,
              startY = e.clientY,
              start = position;
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            const move = (event: PointerEvent) =>
              setPosition(
                fitPosition(
                  start.right - (event.clientX - startX),
                  start.top + event.clientY - startY,
                ),
              );
            const stop = () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerup", stop);
              target.removeEventListener("pointercancel", stop);
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", stop);
            target.addEventListener("pointercancel", stop);
          }}
        >
          {headerLabel}
        </span>
        <button
          className="pb-mini-toggle"
          aria-label={
            controlsVisible ? "Hide player controls" : "Show player controls"
          }
          title={
            controlsVisible ? "Hide player controls" : "Show player controls"
          }
          aria-expanded={controlsVisible}
          onClick={() => setControlsVisible((v) => !v)}
        >
          <img src={brand} alt="" />
        </button>
      </header>
      {controlsVisible && (
        <>
          <div className="pb-mini-track">
            <img
              src={songImage}
              alt=""
              onError={() => setArtwork({ url: trackUrl, cover: "" })}
            />
            <div>
              <strong title={p.currentTrack?.title}>{p.currentTrack?.title || "Choose a song"}</strong>
              <span>
                {p.isLoadingTrack
                  ? "Loading…"
                  : p.currentTrack?.artist ||
                    "Open a playlist or your songs folder"}
              </span>
            </div>
            <button
              aria-label={
                p.currentTrack && p.isTrackLiked(p.currentTrack.url)
                  ? "Unlike"
                  : "Like"
              }
              disabled={!p.currentTrack}
              data-favorite={!!p.currentTrack && p.isTrackLiked(p.currentTrack.url)}
              aria-pressed={!!p.currentTrack && p.isTrackLiked(p.currentTrack.url)}
              onClick={() =>
                p.currentTrack && p.toggleLikeTrack(p.currentTrack)
              }
            >
              <Heart
                size={17}
                fill={
                  p.currentTrack && p.isTrackLiked(p.currentTrack.url)
                    ? "var(--pb-gold)"
                    : "none"
                }
              />
            </button>
          </div>
          <div className="pb-mini-transport">
            <button
              aria-label="Shuffle"
              aria-pressed={p.shuffle}
              onClick={p.toggleShuffle}
            >
              <Shuffle size={17} />
            </button>
            <button
              aria-label="Previous track"
              disabled={!p.currentTrack}
              onClick={p.handleSkipBack}
            >
              <SkipBack size={21} />
            </button>
            <button
              className="pb-mini-play"
              aria-label={p.isPlaying ? "Pause" : "Play"}
              disabled={!p.currentTrack || p.isLoadingTrack}
              onClick={p.togglePlayPause}
            >
              {p.isPlaying ? <Pause size={23} /> : <Play size={23} />}
            </button>
            <button
              aria-label="Next track"
              disabled={!p.currentTrack}
              onClick={p.handleSkipForward}
            >
              <SkipForward size={21} />
            </button>
            <button
              aria-label={`Repeat: ${p.repeatMode}`}
              aria-pressed={p.repeatMode !== "off"}
              onClick={p.cycleRepeat}
            >
              {p.repeatMode === "one" ? (
                <Repeat1 size={17} />
              ) : (
                <Repeat size={17} />
              )}
            </button>
          </div>
          <div className="pb-mini-progress" ref={p.progressRef}>
            <input
              type="range"
              aria-label="Seek"
              min={0}
              max={Math.max(1, p.trackDurationSeconds)}
              step={0.1}
              value={Math.min(p.progressSeconds, p.trackDurationSeconds || 0)}
              disabled={!p.currentTrack || !p.trackDurationSeconds}
              style={
                {
                  "--pb-fill": `${p.trackDurationSeconds ? (p.progressSeconds / p.trackDurationSeconds) * 100 : 0}%`,
                } as React.CSSProperties
              }
              onChange={(e) => {
                const rect = p.progressRef.current?.getBoundingClientRect();
                if (rect && p.trackDurationSeconds)
                  p.updateProgressFromEvent?.(
                    rect.left +
                      (Number(e.target.value) / p.trackDurationSeconds) *
                        rect.width,
                  );
                void invoke("seek_audio", {
                  time: Number(e.target.value),
                }).catch(() => p.showToast?.("Could not seek this track"));
              }}
            />
            <div>
              <span>{formatTime(p.progressSeconds)}</span>
              <span>{formatTime(p.trackDurationSeconds)}</span>
            </div>
          </div>
        </>
      )}
      <footer className="pb-mini-footer">
        <button
          aria-label="Open settings"
          title="Settings"
          onClick={p.onOpenSettings}
        >
          <Settings size={17} />
        </button>
        {controlsVisible && (
          <div className="pb-mini-volume">
            <button
              aria-label={p.volume ? "Mute" : "Unmute"}
              onClick={p.toggleMute}
            >
              {p.volume ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={100}
              value={p.volume}
              style={{ "--pb-fill": `${p.volume}%` } as React.CSSProperties}
              onChange={(e) => {
                const volume = Number(e.target.value);
                p.setVolume(volume);
                void invoke("set_volume", { volume }).catch(() => {});
              }}
            />
          </div>
        )}
      </footer>
    </section>
  );
}
