import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Track } from "../types";
import { cleanArtist } from "../utils";
import { getPlaybackProgress } from "./playbackProgress";

interface DiscordOptions {
  jamPartnerName?: string;
  applicationId?: string;
  enabled: boolean;
  playing: boolean;
  track: Track | null;
  duration: number;
  speed: number;
  showCover: boolean;
  timeDisplay: "remaining" | "elapsed";
  customButton: boolean;
  buttonLabel: string;
  buttonUrl: string;
}

export function useDiscordRpc(options: DiscordOptions) {
  const latest = useRef(options);
  latest.current = options;
  const [status, setStatus] = useState("Waiting for playback");
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let busy = false;
    let lastKey = "";
    let lastStart = 0;
    let lastSuccess = 0;
    let retryAt = 0;
    const tick = async () => {
      if (busy || disposed) return;
      const o = latest.current;
      const active = o.enabled && o.playing && o.track;
      const now = Date.now();
      const partner = Array.from((o.jamPartnerName || "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim()).slice(0, 40).join("");
      const jamState = partner ? `#Phoebeating with ${partner}` : null;
      const speed = Number.isFinite(o.speed) && o.speed > 0 ? o.speed : 1;
      const progress = Math.max(0, getPlaybackProgress());
      const startTimestamp = Math.floor(now / 1000 - progress / speed);
      const key = active
        ? JSON.stringify([
            o.applicationId,
            o.track!.url,
            o.track!.title,
            o.track!.artist,
            /^https?:\/\//i.test(o.track!.cover || "") ? o.track!.cover : null,
            o.duration,
            speed,
            o.showCover,
            o.timeDisplay,
            o.customButton,
            o.buttonLabel,
            o.buttonUrl,
            jamState,
          ])
        : "clear";
      if (
        key === lastKey &&
        (!active ||
          (Math.abs(startTimestamp - lastStart) <= 2 &&
            now - lastSuccess < 15000))
      ) {
        if (!active)
          setStatus(
            o.enabled
              ? "Paused — listening activity hidden"
              : "Disabled — listening activity hidden",
          );
        return;
      }
      if (now < retryAt) return;
      busy = true;
      try {
        if (active) {
          const track = o.track!;
          const webUrl = (url: string) =>
            /^https?:\/\//i.test(url) ? url : null;
          await invoke("update_discord_rpc", {
            applicationId: o.applicationId?.trim() || "1546196215153041448",
            title: track.title,
            artist: cleanArtist(track.artist) || null,
            jamState,
            coverUrl: webUrl(track.cover || ""),
            trackUrl: webUrl(track.url),
            startTimestamp,
            endTimestamp:
              o.duration > 0
                ? Math.floor(
                    now / 1000 + Math.max(0, o.duration - progress) / speed,
                  )
                : null,
            showCover: o.showCover,
            timeDisplay: o.timeDisplay,
            customButtonLabel: o.customButton ? o.buttonLabel : null,
            customButtonUrl: o.customButton ? o.buttonUrl : null,
          });
        } else {
          await invoke("clear_discord_rpc");
        }
        lastKey = key;
        lastStart = startTimestamp;
        lastSuccess = now;
        retryAt = 0;
        if (!disposed)
          setStatus(
            active
              ? partner ? `Connected — jamming with ${partner}` : "Connected — sharing your listening activity"
              : o.enabled
                ? "Paused — listening activity hidden"
                : "Disabled — listening activity hidden",
          );
      } catch (error) {
        retryAt = Date.now() + 5000;
        if (!disposed)
          setStatus(
            `Could not connect to Discord — retrying. ${String(error)}`,
          );
      } finally {
        busy = false;
        // Drain a pause or track change that happened during the IPC call.
        if (!disposed && latest.current !== o) void tick();
      }
    };
    wake.current = () => {
      void tick();
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      wake.current = () => {};
    };
  }, []);

  useEffect(() => {
    wake.current();
  }, [options]);
  return status;
}
