import type { RepeatMode } from "../types";

/** Repeat off advances normally; only wrapping the list requires repeat all. */
export function nextPlaybackIndex(
  length: number,
  index: number,
  repeat: RepeatMode,
  shuffle: boolean,
  random = Math.random,
): number | null {
  if (length === 0) return null;
  if (repeat === "one") return index;
  if (shuffle && length > 1) {
    // Choose any other track without a potentially unbounded retry loop.
    const next = Math.floor(random() * (length - 1));
    return next >= index ? next + 1 : next;
  }
  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : null;
}
