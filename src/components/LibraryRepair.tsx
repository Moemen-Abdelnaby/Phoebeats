import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Playlist } from "../types";
export function LibraryRepair({
  playlists,
  onRelink,
}: {
  playlists: Playlist[];
  onRelink: (oldUrl: string, newUrl: string) => void;
}) {
  const [missing, setMissing] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <details className="pb-library-repair">
      <summary>Repair missing playlist songs</summary>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("Checking saved file locations…");
          try {
            const paths = [
              ...new Set(
                playlists
                  .flatMap((p) => p.tracks)
                  .filter((t) => t.url.startsWith("local://"))
                  .map((t) => t.url.slice(8)),
              ),
            ];
            const result = await invoke<string[]>("find_missing_files", {
              paths,
            });
            setMissing(result);
            setMessage(
              result.length
                ? `${result.length} missing or unavailable files. Locate each replacement below.`
                : "All playlist files are available.",
            );
          } catch (error) {
            setMessage(String(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        Check files
      </button>
      <p role="status">{message}</p>
      <div>
        {missing.map((path) => (
          <div key={path}>
            <span>{path}</span>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const replacement = await open({
                    multiple: false,
                    directory: false,
                    filters: [
                      {
                        name: "Audio",
                        extensions: [
                          "mp3",
                          "flac",
                          "wav",
                          "ogg",
                          "m4a",
                          "aac",
                          "opus",
                          "wma",
                        ],
                      },
                    ],
                  });
                  if (typeof replacement === "string") {
                    onRelink(`local://${path}`, `local://${replacement}`);
                    setMissing((prev) => prev.filter((p) => p !== path));
                    setMessage(
                      "Updated all matching playlist entries. No file was moved.",
                    );
                  }
                } catch (error) {
                  setMessage(String(error));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Locate file…
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
