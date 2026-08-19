import type { SlotRecord } from "./types";

// Shared contract between the live source (client) and the proxy routes
// (server). Windows are fixed-size and aligned so every listener asks for
// identical URLs and the CDN caches each stretch of chain exactly once.
export const WINDOW_SIZE = 8;

// ~2 hours of chain: how far back the proxy serves. Client and server share
// it so a deep link into older history fails fast instead of polling forever.
export const MAX_HISTORY_SLOTS = 18_000;

export function alignWindowStart(slot: number): number {
  return Math.floor(Math.max(0, slot) / WINDOW_SIZE) * WINDOW_SIZE;
}

export interface WindowResponse {
  start: number;
  records: SlotRecord[];
}
