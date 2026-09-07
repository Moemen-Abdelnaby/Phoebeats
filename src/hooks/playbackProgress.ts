import { useCallback, useSyncExternalStore } from "react";

let seconds = 0;
const listeners = new Set<() => void>();
export const getPlaybackProgress = () => seconds;
export function publishPlaybackProgress(value: number) {
  if (seconds === value) return;
  seconds = value;
  listeners.forEach((listener) => listener());
}
export function usePlaybackProgress(enabled = true) {
  return useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        if (!enabled) return () => {};
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      [enabled],
    ),
    getPlaybackProgress,
  );
}
