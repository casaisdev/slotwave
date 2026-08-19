import { describe, expect, it } from "vitest";
import { SLOT_WINDOW_S } from "../mapping";
import { anomaly, CU_SPIKE_Z } from "../mappings/anomaly";
import { density } from "../mappings/density";
import { mapSlot } from "../mappings";
import { pressure } from "../mappings/pressure";
import { createChainStats, updateChainStats, type ChainStats } from "../stats";
import type { SlotRecord } from "../types";

const record = (overrides: Partial<SlotRecord> = {}): SlotRecord => ({
  slot: 1,
  blockTime: 0,
  skipped: false,
  txCount: 1000,
  failedTxCount: 20,
  computeUnits: 20_000_000,
  totalFees: 6_000_000,
  ...overrides,
});

/** Stats calibrated on a steady baseline of the given record. */
const calibrated = (base: SlotRecord, n = 64): ChainStats => {
  const stats = createChainStats();
  for (let i = 0; i < n; i++) updateChainStats(stats, base);
  return stats;
};

describe("density", () => {
  it("quiet slots produce fewer, lower notes than busy slots", () => {
    const stats = calibrated(record());
    const quiet = density(record({ txCount: 300 }), stats);
    const busy = density(record({ txCount: 2500 }), stats);
    expect(quiet.length).toBe(1);
    expect(busy.length).toBe(4);
  });

  it("the leader colors the ladder, deterministically", () => {
    const stats = calibrated(record());
    const a1 = density(record({ leader: "LeaderAaaa" }), stats);
    const a2 = density(record({ leader: "LeaderAaaa" }), stats);
    const b = density(record({ leader: "LeaderBbbb" }), stats);
    const none = density(record(), stats);
    expect(a1).toEqual(a2); // same leader, same phrase
    expect(a1.map((n) => n.note)).not.toEqual(b.map((n) => n.note));
    expect(none.length).toBeGreaterThan(0); // tapes without leaders still play
  });

  it("spreads offsets inside the slot window", () => {
    const stats = calibrated(record());
    const notes = density(record({ txCount: 2500 }), stats);
    const offsets = notes.map((n) => n.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(Math.max(...offsets)).toBeLessThan(SLOT_WINDOW_S);
  });
});

describe("pressure", () => {
  it("higher compute load opens the filter", () => {
    const stats = calibrated(record());
    const idle = pressure(record({ computeUnits: 5_000_000 }), stats);
    const loaded = pressure(record({ computeUnits: 45_000_000 }), stats);
    expect(loaded.filterHz).toBeGreaterThan(idle.filterHz);
  });

  it("velocity stays in a musical range", () => {
    const stats = calibrated(record());
    const low = pressure(record({ totalFees: 0 }), stats);
    const high = pressure(record({ totalFees: 1e12 }), stats);
    expect(low.velocity).toBeGreaterThanOrEqual(0.3);
    expect(high.velocity).toBeLessThanOrEqual(0.9);
  });
});

describe("anomaly", () => {
  it("a skipped slot always fires the skip thud", () => {
    const events = anomaly(record({ skipped: true }), createChainStats());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ voice: "event", kind: "skip" });
  });

  it("a CU spike beyond the z threshold fires a burst; baseline does not", () => {
    const base = record();
    const stats = calibrated(base);
    // Give the window a little variance so std is non-zero.
    updateChainStats(stats, record({ computeUnits: 21_000_000 }));
    updateChainStats(stats, record({ computeUnits: 19_000_000 }));
    expect(anomaly(base, stats)).toHaveLength(0);
    const spike = anomaly(record({ computeUnits: 60_000_000 }), stats);
    expect(spike[0]).toMatchObject({ voice: "event", kind: "cuSpike" });
    expect(CU_SPIKE_Z).toBe(2.5);
  });
});

describe("mapSlot", () => {
  it("a skipped slot maps to only the event voice", () => {
    const events = mapSlot(record({ skipped: true }), createChainStats());
    expect(events).toHaveLength(1);
    expect(events[0].voice).toBe("event");
  });

  it("a normal slot carries signal notes plus a bass ground", () => {
    const stats = calibrated(record());
    const events = mapSlot(record(), stats);
    const signal = events.filter((e) => e.voice === "signal");
    expect(signal.length).toBeGreaterThan(0);
    expect(new Set(signal.map((e) => e.velocity)).size).toBe(1);
    expect(new Set(signal.map((e) => e.filterHz)).size).toBe(1);
    expect(events.filter((e) => e.voice === "bass")).toHaveLength(1);
    expect(events.some((e) => e.voice === "event")).toBe(false);
  });

  it("failed-heavy slots add texture grains; clean slots stay quiet", () => {
    const stats = calibrated(record());
    const clean = mapSlot(record({ failedTxCount: 10 }), stats);
    const dirty = mapSlot(record({ failedTxCount: 300 }), stats);
    expect(clean.filter((e) => e.voice === "texture")).toHaveLength(0);
    expect(dirty.filter((e) => e.voice === "texture").length).toBeGreaterThan(0);
  });

  it("texture grains come in ascending time order (mono synths require it)", () => {
    const stats = calibrated(record());
    // slot 12 % 7 = 5 used to scatter as 5, 0, 3 before sorting
    const events = mapSlot(
      record({ slot: 12, failedTxCount: 300 }),
      stats,
    ).filter((e) => e.voice === "texture");
    expect(events).toHaveLength(3);
    const offsets = events.map((e) => e.offset);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
  });

  it("is pure: same input, same output", () => {
    const stats = calibrated(record());
    const a = mapSlot(record({ txCount: 1800 }), stats);
    const b = mapSlot(record({ txCount: 1800 }), stats);
    expect(a).toEqual(b);
  });
});
