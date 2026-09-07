import type { LocalTrack } from "../types";

/** Small worker pool; stale scans stop scheduling and never publish results. */
export async function enrichLocalTracks(
  tracks: LocalTrack[],
  enrich: (track: LocalTrack) => Promise<LocalTrack>,
  cancelled: () => boolean,
  publish: (tracks: LocalTrack[]) => void,
) {
  const result = [...tracks];
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (!cancelled()) {
      const index = cursor++;
      if (index >= tracks.length) return;
      if (
        tracks[index].duration !== undefined &&
        tracks[index].duration !== null
      )
        continue;
      try {
        result[index] = await enrich(tracks[index]);
      } catch {
        /* Keep playable filename entry. */
      }
      if (cancelled()) return;
      if (++completed % 8 === 0) publish([...result]);
    }
  };
  await Promise.all(Array.from({ length: 3 }, worker));
  if (!cancelled()) publish(result);
}
