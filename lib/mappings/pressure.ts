import { clamp01 } from "../mapping";
import type { ChainStats } from "../stats";
import type { SlotRecord } from "../types";

/** Solana block compute-unit limit (100M since SIMD-0286, epoch 1009). */
export const MAX_BLOCK_CU = 100_000_000;

// Real blocks rarely pass ~40% of the limit, so the musical filter maps that
// practical range onto its full sweep; the readout still shows the honest %.
const MUSICAL_UTIL_GAIN = 2.5;

export interface Pressure {
  filterHz: number;
  velocity: number;
}

/** CU utilization opens the lowpass (dull idle → bright load); fees drive velocity. */
export function pressure(record: SlotRecord, stats: ChainStats): Pressure {
  const utilization = clamp01(record.computeUnits / MAX_BLOCK_CU);
  const sweep = clamp01(utilization * MUSICAL_UTIL_GAIN);
  const filterHz = 400 * Math.pow(20, sweep); // 400 Hz closed → 8 kHz open
  const feeRatio = clamp01(stats.totalFees.ratio(record.totalFees) / 2);
  const velocity = 0.3 + 0.6 * feeRatio;
  return { filterHz, velocity };
}
