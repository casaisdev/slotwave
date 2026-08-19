import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReplaySource, parseJsonl } from "../sources/replay";
import type { SlotRecord } from "../types";

const record = (slot: number): SlotRecord => ({
  slot,
  blockTime: null,
  skipped: false,
  txCount: 1,
  failedTxCount: 0,
  computeUnits: 1,
  totalFees: 1,
});

describe("parseJsonl", () => {
  it("parses one record per line and ignores blank lines", () => {
    const text = `${JSON.stringify(record(1))}\n\n${JSON.stringify(record(2))}\n`;
    expect(parseJsonl(text).map((r) => r.slot)).toEqual([1, 2]);
  });

  it("drops corrupt or malformed lines instead of throwing", () => {
    const text = [
      JSON.stringify(record(1)),
      "{truncated garbage",
      JSON.stringify({ slot: "not-a-number" }),
      JSON.stringify(record(2)),
    ].join("\n");
    expect(parseJsonl(text).map((r) => r.slot)).toEqual([1, 2]);
  });
});

describe("createReplaySource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("emits records in order at the configured pace", () => {
    const seen: number[] = [];
    const source = createReplaySource([record(1), record(2), record(3)], {
      slotIntervalMs: 400,
    });
    source.start((r) => seen.push(r.slot));

    expect(seen).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(seen).toEqual([1]);
    vi.advanceTimersByTime(800);
    expect(seen).toEqual([1, 2, 3]);
    vi.advanceTimersByTime(2000);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("loops when configured", () => {
    const seen: number[] = [];
    const source = createReplaySource([record(1), record(2)], {
      slotIntervalMs: 100,
      loop: true,
    });
    source.start((r) => seen.push(r.slot));

    vi.advanceTimersByTime(500);
    expect(seen).toEqual([1, 2, 1, 2, 1]);
    source.stop();
  });

  it("stops emitting after stop()", () => {
    const seen: number[] = [];
    const source = createReplaySource([record(1), record(2), record(3)], {
      slotIntervalMs: 100,
    });
    source.start((r) => seen.push(r.slot));

    vi.advanceTimersByTime(100);
    source.stop();
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual([1]);
  });

  it("ignores start() while already running", () => {
    const seen: number[] = [];
    const source = createReplaySource([record(1), record(2)], {
      slotIntervalMs: 100,
    });
    source.start((r) => seen.push(r.slot));
    source.start((r) => seen.push(r.slot * 100));

    vi.advanceTimersByTime(200);
    expect(seen).toEqual([1, 2]);
  });
});
