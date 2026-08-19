import { MAX_BLOCK_CU } from "./mappings/pressure";
import { realTxCount, type SlotRecord } from "./types";

export function formatInt(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatSol(lamports: number): string {
  return `${(lamports / 1e9).toFixed(3)} sol`;
}

export function formatCu(computeUnits: number): string {
  const pct = Math.round((computeUnits / MAX_BLOCK_CU) * 100);
  return `${(computeUnits / 1e6).toFixed(1)}m cu · ${pct}%`;
}

/** Real (non-vote) throughput; vote traffic is validator overhead. */
export function formatTps(record: SlotRecord): string {
  if (record.skipped) return "—";
  return formatInt(Math.round(realTxCount(record) / 0.4));
}

export function formatClock(blockTime: number | null): string {
  if (blockTime === null) return "—";
  return new Date(blockTime * 1000).toLocaleTimeString("en-US", {
    hour12: false,
  });
}

export function formatFailedShare(record: SlotRecord): string {
  const real = realTxCount(record);
  if (real === 0) return "—";
  return `${((record.failedTxCount / real) * 100).toFixed(1)}% failed`;
}
