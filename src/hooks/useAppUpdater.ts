import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";

export type UpdatePhase = "idle" | "checking" | "current" | "available" | "downloading" | "verifying" | "ready" | "installing" | "error";
export interface AppUpdateState {
  phase: UpdatePhase;
  version: string | null;
  percent: number | null;
  message: string;
}
export function useAppUpdater(autoCheck: boolean) {
  const [state, setState] = useState<AppUpdateState>({ phase: "idle", version: null, percent: null, message: "Check for updates to see if a new version is available." });
  const stateRef = useRef(state);
  const busy = useRef(false);
  const update = useCallback((next: Partial<AppUpdateState>) => {
    stateRef.current = { ...stateRef.current, ...next };
    setState(stateRef.current);
  }, []);
  const check = useCallback(async () => {
    if (busy.current || stateRef.current.phase === "ready") return;
    busy.current = true;
    update({ phase: "checking", message: "Checking for updates…", percent: null });
    try {
      const version = await invoke<string | null>("check_for_update");
      update({ version, phase: version ? "available" : "current", message: version ? `Version ${version} is available.` : "You're up to date." });
    } catch {
      update({ phase: "error", message: "Couldn't check for updates. Check your connection and try again." });
    } finally { busy.current = false; }
  }, [update]);
  useEffect(() => {
    if (autoCheck) void check();
  }, [autoCheck, check]);
  const download = useCallback(async () => {
    if (busy.current || !stateRef.current.version || stateRef.current.phase === "ready") return;
    busy.current = true;
    update({ phase: "downloading", percent: null, message: "Downloading update…" });
    const channel = new Channel<{ phase: "downloading" | "verifying"; downloaded: number; total: number | null }>();
    channel.onmessage = (event) => {
      if (!["downloading", "verifying"].includes(stateRef.current.phase)) return;
      const percent = event.total && event.total > 0 ? Math.min(100, Math.floor(event.downloaded / event.total * 100)) : null;
      update({ phase: event.phase, percent, message: event.phase === "verifying" ? "Verifying update…" : "Downloading update…" });
    };
    try {
      await invoke("download_app_update", { onProgress: channel });
      update({ phase: "ready", percent: 100, message: "Update ready. Restart to install it." });
    } catch {
      update({ phase: "error", percent: null, message: "Couldn't download or verify the update. Please try again." });
    } finally { busy.current = false; }
  }, [update]);
  const install = useCallback(async () => {
    if (busy.current || stateRef.current.phase !== "ready") return;
    busy.current = true;
    update({ phase: "installing", message: "Installing update. The app will restart…" });
    try {
      // Flush existing resume/history handlers before Windows exits for installation.
      window.dispatchEvent(new Event("beforeunload"));
      await invoke("pause_audio").catch(() => {});
      await invoke("install_app_update");
    } catch {
      update({ phase: "error", percent: null, message: "Couldn't install the update. Download it again and retry." });
    } finally { busy.current = false; }
  }, [update]);
  return { state, check, download, install, busy: ["checking", "downloading", "verifying", "installing"].includes(state.phase) };
}
