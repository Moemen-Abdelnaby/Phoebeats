import { Track } from '../types';

export type JamAction = { action: string; tracks?: Track[]; index?: number; position?: number; from?: number; to?: number; generation?: number; hostOnly?: boolean; name?: string };
let handler: ((action: JamAction) => void) | null = null;
export function connectJamBridge(next: typeof handler) { handler = next; }
export function isJamActive() { return handler !== null; }
export function jamAction(action: JamAction) {
  if (!handler) return false;
  handler(action);
  return true;
}
