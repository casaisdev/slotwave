import type { SoundParams } from "../mapping";
import type { ChainStats } from "../stats";
import type { SlotRecord } from "../types";

export const CU_SPIKE_Z = 2.5;

/** Skips and CU spikes, always the event voice (violet). */
export function anomaly(record: SlotRecord, stats: ChainStats): SoundParams[] {
  if (record.skipped) {
    return [
      {
        voice: "event",
        kind: "skip",
        notes: ["E1"],
        velocity: 0.9,
        filterHz: 0,
        duration: 0.35,
        offset: 0,
      },
    ];
  }

  if (stats.computeUnits.zScore(record.computeUnits) > CU_SPIKE_Z) {
    return [
      {
        voice: "event",
        kind: "cuSpike",
        notes: ["E2"],
        velocity: 0.7,
        filterHz: 0,
        duration: 0.15,
        offset: 0.05,
      },
    ];
  }

  return [];
}
