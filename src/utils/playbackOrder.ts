import type { RepeatMode } from "../types";

export function recencyWeight(played: number, now = Date.now()): number {
  return Number.isFinite(played) && played > 0
    ? 5 - 4 / (1 + Math.max(0, now - played) / 86_400_000)
    : 5;
}

/** Repeat off advances normally; only wrapping the list requires repeat all. */
export function nextPlaybackIndex(
  length: number,
  index: number,
  repeat: RepeatMode,
  shuffle: boolean,
  random = Math.random,
  lastPlayed: readonly number[] = [],
  now = Date.now(),
): number | null {
  if (length === 0) return null;
  if (repeat === "one") return index;
  if (shuffle && length > 1) {
    // Unplayed and long-unheard songs get higher odds than recent listens.
    const weights = Array.from({ length }, (_, i) => {
      if (i === index) return 0;
      return recencyWeight(lastPlayed[i], now);
    });
    let ticket = random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let i = 0; i < length; i++) {
      ticket -= weights[i];
      if (weights[i] > 0 && ticket < 0) return i;
    }
    return index === length - 1 ? length - 2 : length - 1;
  }
  if (index + 1 < length) return index + 1;
  return repeat === "all" ? 0 : null;
}
