import { clamp01, type SoundParams } from "../mapping";
import type { ChainStats } from "../stats";
import type { SlotRecord } from "../types";

/** totalFees → the ground note under each slot: heavier fees, higher & harder. */
export function bass(record: SlotRecord, stats: ChainStats): SoundParams[] {
  const feeRatio = stats.totalFees.ratio(record.totalFees);
  const note = feeRatio < 0.8 ? "E1" : feeRatio < 1.3 ? "B1" : "E2";
  return [
    {
      voice: "bass",
      notes: [note],
      velocity: 0.25 + 0.45 * clamp01(feeRatio / 2),
      filterHz: 0,
      duration: 0.3,
      offset: 0,
    },
  ];
}
