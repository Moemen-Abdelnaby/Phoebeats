/** Keep decorative playback recoverable after a WebView suspension. */
export function startWallpaperPlayback(
  video: HTMLVideoElement,
  enabled: boolean,
) {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false;
  let reloads = 0;
  let pending = false;
  let attemptStarted = 0;
  let lastTime = video.currentTime;
  let lastMovement = Date.now();
  const allowed = () => enabled && !motion.matches && !document.hidden;
  const sync = (force = false) => {
    if (disposed) return;
    if (!allowed()) {
      video.pause();
      lastMovement = Date.now();
      return;
    }
    if (video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      lastMovement = Date.now();
      reloads = 0;
    }
    const stalled = Date.now() - lastMovement >= 4500;
    if (force) {
      pending = false;
      video.pause();
    }
    // A suspended WebView can leave play() pending; allow another attempt later.
    if (!stalled && pending && Date.now() - attemptStarted < 4000) return;
    if (video.error || stalled) {
      if (reloads >= 3) return; // Missing/unsupported assets must not reload forever.
      reloads++;
      pending = false;
      lastMovement = Date.now();
      video.load();
    }
    if (!video.paused && !video.ended) return;
    if (video.ended) video.currentTime = 0;
    pending = true;
    attemptStarted = Date.now();
    void video
      .play()
      .then(() => {
        if (!disposed && !allowed()) video.pause();
      })
      .catch(() => {
        // The next visibility/focus event or watchdog tick retries playback.
      })
      .finally(() => {
        pending = false;
      });
  };
  const resume = () => sync(true);
  const check = () => sync();
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  window.addEventListener("phoebeats-wallpaper-resume", resume);
  motion.addEventListener("change", check);
  video.addEventListener("canplay", check);
  const timer = window.setInterval(sync, 1500);
  sync();
  return () => {
    disposed = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pageshow", resume);
    window.removeEventListener("phoebeats-wallpaper-resume", resume);
    motion.removeEventListener("change", check);
    video.removeEventListener("canplay", check);
    video.pause();
  };
}
