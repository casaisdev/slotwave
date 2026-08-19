import type { SoundParams } from "./mapping";
import { mapSlot } from "./mappings";
import { createChainStats } from "./stats";
import { updateChainStats } from "./stats";
import type { SlotRecord } from "./types";
import { toVisual, type VisualParams } from "./visual";

/**
 * One slot as it entered the session: mapped exactly once against the stats
 * of its moment, so pause/rewind/replay re-plays the identical sounds.
 */
export interface PlayedSlot {
  index: number;
  record: SlotRecord;
  events: SoundParams[];
  visuals: VisualParams[];
  /** performance.now() of the last time this slot was sonified; null = never. */
  playedAt: number | null;
}

export interface Session {
  readonly slots: PlayedSlot[];
  ingest(record: SlotRecord): PlayedSlot;
}

export function createSession(): Session {
  const stats = createChainStats();
  const slots: PlayedSlot[] = [];
  return {
    slots,
    ingest(record) {
      const events = mapSlot(record, stats);
      updateChainStats(stats, record);
      const played: PlayedSlot = {
        index: slots.length,
        record,
        events,
        visuals: events.map((event) => toVisual(event, record)),
        playedAt: null,
      };
      slots.push(played);
      return played;
    },
  };
}
