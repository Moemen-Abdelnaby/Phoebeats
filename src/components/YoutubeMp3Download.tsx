import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { normalizeYoutubeLink, normalizeYoutubePlaylistLink } from "../utils/youtubeLink";
type Job = {
  id: string;
  url: string;
  folder: string;
  status: "queued" | "downloading" | "completed" | "error" | "cancelled";
  error?: string;
};
interface Props {
  folder: string;
  progress: Record<string, number>;
  onDownloaded: () => void;
}
export function YoutubeMp3Download({ folder, progress, onDownloaded }: Props) {
  const [links, setLinks] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [message, setMessage] = useState("");
  const [playlistLink, setPlaylistLink] = useState("");
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const playlistLoadingRef = useRef(false);
  const queuePlaylist = async () => {
    if (playlistLoadingRef.current) return;
    if (!("__TAURI_INTERNALS__" in window)) {
      setMessage("Open the Phoebeats desktop app to download.");
      return;
    }
    const url = normalizeYoutubePlaylistLink(playlistLink);
    if (!url || !folder) {
      setMessage("Enter a YouTube playlist link and choose a download folder.");
      return;
    }
    playlistLoadingRef.current = true;
    setLoadingPlaylist(true);
    setMessage("Loading playlist…");
    try {
      const result = await invoke<string>("import_youtube_playlist", { url });
      const urls = [...new Set(result.split(/\r?\n/)
        .map((line) => line.split("====")[0].trim())
        .filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id))
        .map((id) => `https://www.youtube.com/watch?v=${id}`))];
      if (!urls.length) throw new Error("No available videos found in this playlist.");
      setJobs((prev) => [...prev, ...urls
        .filter((video) => !prev.some((j) => j.url === video && ["queued", "downloading"].includes(j.status)))
        .map((video) => ({ id: crypto.randomUUID(), url: video, folder, status: "queued" as const }))]);
      setPlaylistLink("");
      setMessage(`Playlist added to queue (${urls.length} videos found). Videos already queued are skipped; unavailable videos may be skipped or fail.`);
    } catch (error) {
      setMessage(`Could not load playlist: ${String(error)}`);
    } finally {
      playlistLoadingRef.current = false;
      setLoadingPlaylist(false);
    }
  };
  const running = useRef<string | null>(null);
  const completed = useRef(onDownloaded);
  completed.current = onDownloaded;
  useEffect(() => {
    if (running.current) return;
    const job = jobs.find((j) => j.status === "queued");
    if (!job) return;
    running.current = job.id;
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: "downloading" } : j)),
    );
    void invoke("download_song", {
      url: job.url,
      path: job.folder,
      format: "mp3",
      quality: "High",
      embedThumbnail: true,
    })
      .then(() => {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id && j.status !== "cancelled"
              ? { ...j, status: "completed" }
              : j,
          ),
        );
        completed.current();
      })
      .catch((error) =>
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id && j.status !== "cancelled"
              ? { ...j, status: "error", error: String(error) }
              : j,
          ),
        ),
      )
      .finally(() => {
        running.current = null;
        setJobs((prev) => [...prev]);
      });
  }, [jobs]);
  const cancel = async (job: Job) => {
    if (running.current !== job.id) {
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, status: "cancelled" } : j)),
      );
      return;
    }
    setJobs((prev) =>
      prev.map((j) => (j.id === job.id ? { ...j, status: "cancelled" } : j)),
    );
    try {
      // A click can arrive before the native process has registered its PID.
      while (running.current === job.id) {
        await invoke("cancel_download", { url: job.url });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id && running.current === job.id
            ? { ...j, status: "downloading" }
            : j,
        ),
      );
      setMessage(`Could not cancel: ${String(error)}`);
    }
  };
  return (
    <details className="pb-youtube-download">
      <summary>
        YouTube MP3 download queue{" "}
        {jobs.some((j) => j.status === "downloading") ? "· downloading" : ""}
      </summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!("__TAURI_INTERNALS__" in window)) {
            setMessage("Open the Phoebeats desktop app to download.");
            return;
          }
          const inputs = links.split(/\s+/).filter(Boolean);
          const urls = inputs.map(normalizeYoutubeLink);
          if (!folder || !urls.length || urls.some((url) => !url)) {
            setMessage(
              "Enter valid YouTube video links, one per line, and choose a songs folder.",
            );
            return;
          }
          const unique = [...new Set(urls as string[])];
          setJobs((prev) => [
            ...prev,
            ...unique
              .filter(
                (url) =>
                  !prev.some(
                    (j) =>
                      j.url === url &&
                      ["queued", "downloading"].includes(j.status),
                  ),
              )
              .map((url) => ({
                id: crypto.randomUUID(),
                url,
                folder,
                status: "queued" as const,
              })),
          ]);
          setLinks("");
          setMessage("Added to download queue.");
        }}
      >
        <label htmlFor="pb-youtube-link">YouTube links · one per line</label>
        <textarea
          id="pb-youtube-link"
          required
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          rows={3}
        />
        <button type="submit">Queue MP3 downloads</button>
        <small>
          Save to: {folder}. Only download audio you have permission to save.
        </small>
      </form>
      <p role="status">{message}</p>
      <form onSubmit={(e) => { e.preventDefault(); void queuePlaylist(); }}>
        <label htmlFor="pb-youtube-playlist">Download an entire YouTube playlist</label>
        <input id="pb-youtube-playlist" type="url" required value={playlistLink}
          placeholder="https://www.youtube.com/playlist?list=…"
          onChange={(e) => setPlaylistLink(e.target.value)} />
        <button type="submit" disabled={loadingPlaylist}>
          {loadingPlaylist ? "Loading playlist…" : "Queue entire playlist as MP3"}
        </button>
      </form>
      <div className="pb-download-jobs">
        {jobs.map((job) => (
          <div key={job.id} data-status={job.status}>
            <span>{job.url}</span>
            <small>
              {job.status === "downloading"
                ? `${Math.round(progress[job.url] || 0)}% · downloading/converting`
                : job.status}
              {job.error && job.status === "error" ? `: ${job.error}` : ""}
            </small>
            {["queued", "downloading"].includes(job.status) && (
              <button onClick={() => void cancel(job)}>Cancel</button>
            )}
            {["error", "cancelled"].includes(job.status) && (
              <button
                disabled={
                  running.current === job.id ||
                  jobs.some(
                    (j) =>
                      j.id !== job.id &&
                      j.url === job.url &&
                      ["queued", "downloading"].includes(j.status),
                  )
                }
                onClick={() =>
                  setJobs((prev) =>
                    prev.map((j) =>
                      j.id === job.id
                        ? { ...j, status: "queued", error: undefined }
                        : j,
                    ),
                  )
                }
              >
                Retry
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        onClick={() =>
          setJobs((prev) =>
            prev.filter(
              (j) =>
                ["queued", "downloading"].includes(j.status) ||
                running.current === j.id,
            ),
          )
        }
      >
        Clear finished
      </button>
    </details>
  );
}
