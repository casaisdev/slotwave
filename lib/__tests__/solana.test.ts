import { describe, expect, it } from "vitest";
import {
  blockToRecord,
  isSkippedSlotError,
  skippedRecord,
  type RpcBlock,
} from "../solana";

describe("blockToRecord", () => {
  const VOTE = "Vote111111111111111111111111111111111111111";

  it("aggregates tx count, failures, compute units and fees", () => {
    const block: RpcBlock = {
      blockTime: 1_755_000_000,
      transactions: [
        { meta: { err: null, fee: 5000, computeUnitsConsumed: 200_000 } },
        { meta: { err: { InstructionError: [0, "Custom"] }, fee: 5000, computeUnitsConsumed: 150_000 } },
        { meta: null },
        { meta: { err: null, fee: 7000 } }, // no CU reported
      ],
    };
    expect(blockToRecord(123, block)).toEqual({
      slot: 123,
      blockTime: 1_755_000_000,
      skipped: false,
      txCount: 4,
      voteTxCount: 0,
      failedTxCount: 1,
      computeUnits: 350_000,
      totalFees: 17_000,
    });
  });

  it("counts validator votes separately from real transactions", () => {
    const block: RpcBlock = {
      blockTime: 1_755_000_000,
      transactions: [
        {
          transaction: { message: { accountKeys: ["SomeWallet", VOTE] } },
          meta: { err: null, fee: 5000, computeUnitsConsumed: 2100 },
        },
        {
          transaction: { message: { accountKeys: [{ pubkey: VOTE }] } },
          meta: { err: null, fee: 5000, computeUnitsConsumed: 2100 },
        },
        {
          transaction: { message: { accountKeys: ["SomeWallet", "SomeDex"] } },
          meta: { err: null, fee: 9000, computeUnitsConsumed: 300_000 },
        },
      ],
    };
    const record = blockToRecord(9, block);
    expect(record.txCount).toBe(3);
    expect(record.voteTxCount).toBe(2);
  });
});

describe("skipped slots", () => {
  it("recognizes the two skipped-slot RPC codes but not block-not-available", () => {
    expect(isSkippedSlotError(-32007)).toBe(true);
    expect(isSkippedSlotError(-32009)).toBe(true);
    expect(isSkippedSlotError(-32004)).toBe(false);
    expect(isSkippedSlotError(null)).toBe(false);
  });

  it("skipped records keep the timeline gap-free with zeros", () => {
    expect(skippedRecord(9)).toMatchObject({ slot: 9, skipped: true, txCount: 0 });
  });
});
