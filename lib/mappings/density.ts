import { clamp01, SLOT_WINDOW_S } from "../mapping";
import type { ChainStats } from "../stats";
import { realTxCount, type SlotRecord } from "../types";

// E minor pentatonic, density can stack adjacent degrees without dissonance.
const LADDER = [
  "E3", "G3", "A3", "B3", "D4",
  "E4", "G4", "A4", "B4", "D5", "E5",
];

export interface DensityNote {
  note: string;
  offset: number;
}

/**
 * Leaders rotate every 4 slots; hashing the leader into a small ladder shift
 * gives each rotation its own harmonic color, so the chain's real phrase
 * structure becomes audible. Tapes without leader data shift by 0.
 */
function leaderShift(leader: string | undefined): number {
  if (!leader) return 0;
  let hash = 0;
  for (let i = 0; i < leader.length; i++) {
    hash = (hash * 31 + leader.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 3;
}

/** Real (non-vote) txs → notes per slot (1–4) and how high on the ladder they sit. */
export function density(record: SlotRecord, stats: ChainStats): DensityNote[] {
  const ratio = stats.txCount.ratio(realTxCount(record));
  const count = ratio < 0.7 ? 1 : ratio < 1.05 ? 2 : ratio < 1.4 ? 3 : 4;
  const base = Math.min(
    LADDER.length - 4,
    Math.round(clamp01((ratio - 0.4) / 1.2) * (LADDER.length - 4)) +
      leaderShift(record.leader),
  );

  return Array.from({ length: count }, (_, k) => ({
    note: LADDER[base + k],
    offset: (k * SLOT_WINDOW_S * 0.85) / count,
  }));
}
