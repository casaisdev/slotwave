import { clamp01, SLOT_WINDOW_S, type SoundParams } from "../mapping";
import { realTxCount, type SlotRecord } from "../types";

/**
 * Failed-transaction share → dusty crackle. 0 grains when healthy, up to 3
 * when a slot is full of failures. Offsets are derived from the slot number so
 * the scatter is deterministic, a rewound slot crackles identically.
 */
export function texture(record: SlotRecord): SoundParams[] {
  // failures land almost entirely on real txs; votes barely ever fail
  const real = realTxCount(record);
  const ratio = real === 0 ? 0 : record.failedTxCount / real;
  const count = ratio < 0.05 ? 0 : ratio < 0.12 ? 1 : ratio < 0.22 ? 2 : 3;
  // ascending order matters: the mono noise synth rejects out-of-order times
  const offsets = Array.from(
    { length: count },
    (_, k) => (((record.slot % 7) + k * 3) % 8) * (SLOT_WINDOW_S / 8),
  ).sort((a, b) => a - b);
  return offsets.map((offset) => ({
    voice: "texture" as const,
    notes: [],
    velocity: 0.15 + 0.5 * clamp01(ratio * 3),
    filterHz: 0,
    duration: 0.02,
    offset,
  }));
}
