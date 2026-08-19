// Raw Solana JSON-RPC, only the two methods Slotwave needs, no SDK.
// Pure of environment: callers supply the RPC URL (server proxy or capture script).
import type { SlotRecord } from "./types";

export class RpcError extends Error {
  constructor(
    readonly code: number | null,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

// -32007/-32009: slot was skipped or missing from ledger, a real chain event.
// -32004: block not yet available, transient, must NOT be treated as skipped.
export function isSkippedSlotError(code: number | null): boolean {
  return code === -32007 || code === -32009;
}

interface RpcEnvelope<T> {
  result?: T;
  error?: { code: number; message: string };
}

async function rpc<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new RpcError(null, `RPC HTTP ${response.status}`);
  }
  const envelope = (await response.json()) as RpcEnvelope<T>;
  if (envelope.error) {
    throw new RpcError(envelope.error.code, envelope.error.message);
  }
  if (envelope.result === undefined) {
    throw new RpcError(null, "RPC returned no result");
  }
  return envelope.result;
}

export type Commitment = "confirmed" | "finalized";

export function getSlotAt(
  rpcUrl: string,
  commitment: Commitment,
): Promise<number> {
  return rpc<number>(rpcUrl, "getSlot", [{ commitment }]);
}

/** One call covers up to 5000 slots of the current epoch's leader schedule. */
export function getSlotLeaders(
  rpcUrl: string,
  startSlot: number,
  limit: number,
): Promise<string[]> {
  return rpc<string[]>(rpcUrl, "getSlotLeaders", [startSlot, limit]);
}

const VOTE_PROGRAM_ID = "Vote111111111111111111111111111111111111111";

interface BlockTx {
  transaction?: {
    message?: {
      accountKeys?: (string | { pubkey?: string })[];
    };
  };
  meta: {
    err: unknown;
    fee: number;
    computeUnitsConsumed?: number;
  } | null;
}

function isVoteTx(tx: BlockTx): boolean {
  const keys = tx.transaction?.message?.accountKeys;
  if (!keys) return false;
  return keys.some(
    (key) => (typeof key === "string" ? key : key?.pubkey) === VOTE_PROGRAM_ID,
  );
}

export interface RpcBlock {
  blockTime: number | null;
  transactions: BlockTx[];
}

export function blockToRecord(slot: number, block: RpcBlock): SlotRecord {
  let voteTxCount = 0;
  let failedTxCount = 0;
  let computeUnits = 0;
  let totalFees = 0;
  for (const tx of block.transactions) {
    if (isVoteTx(tx)) voteTxCount += 1;
    if (!tx.meta) continue;
    if (tx.meta.err !== null) failedTxCount += 1;
    computeUnits += tx.meta.computeUnitsConsumed ?? 0;
    totalFees += tx.meta.fee;
  }
  return {
    slot,
    blockTime: block.blockTime ?? null,
    skipped: false,
    txCount: block.transactions.length,
    voteTxCount,
    failedTxCount,
    computeUnits,
    totalFees,
  };
}

export function skippedRecord(slot: number): SlotRecord {
  return {
    slot,
    blockTime: null,
    skipped: true,
    txCount: 0,
    failedTxCount: 0,
    computeUnits: 0,
    totalFees: 0,
  };
}

/** Fetch one finalized slot as a SlotRecord; skipped slots become records too. */
export async function fetchSlotRecord(
  rpcUrl: string,
  slot: number,
): Promise<SlotRecord> {
  try {
    const block = await rpc<RpcBlock>(rpcUrl, "getBlock", [
      slot,
      {
        commitment: "finalized",
        transactionDetails: "full",
        maxSupportedTransactionVersion: 0,
        rewards: false,
      },
    ]);
    return blockToRecord(slot, block);
  } catch (err) {
    if (err instanceof RpcError && isSkippedSlotError(err.code)) {
      return skippedRecord(slot);
    }
    throw err;
  }
}
