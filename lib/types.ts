export interface SlotRecord {
  slot: number;
  /** Unix seconds; null when the chain did not report one. */
  blockTime: number | null;
  /** Leader skipped the slot, anomalous event (violet). */
  skipped: boolean;
  txCount: number;
  /**
   * Validator vote transactions inside txCount (~60-70% of Solana traffic).
   * Optional: tapes recorded before this field existed read as 0 votes.
   */
  voteTxCount?: number;
  failedTxCount: number;
  /** Total compute units consumed in the block. */
  computeUnits: number;
  /** Total fees in lamports. */
  totalFees: number;
  /**
   * Block producer identity for this slot. Leaders rotate every 4 slots,
   * giving the chain (and the music) a phrase structure. Optional: older
   * tapes and the single-slot endpoint omit it.
   */
  leader?: string;
}

export interface SlotSource {
  start(onSlot: (record: SlotRecord) => void): void;
  stop(): void;
}

/** Real (non-vote) transactions: the traffic worth listening to. */
export function realTxCount(record: SlotRecord): number {
  return record.txCount - (record.voteTxCount ?? 0);
}

/** Shape guard for tape lines and window payloads at trust boundaries. */
export function isSlotRecord(value: unknown): value is SlotRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.slot === "number" &&
    (typeof r.blockTime === "number" || r.blockTime === null) &&
    typeof r.skipped === "boolean" &&
    typeof r.txCount === "number" &&
    typeof r.failedTxCount === "number" &&
    typeof r.computeUnits === "number" &&
    typeof r.totalFees === "number"
  );
}
