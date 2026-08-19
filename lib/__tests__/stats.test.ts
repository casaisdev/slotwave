import { describe, expect, it } from "vitest";
import { createChainStats, RollingStats, updateChainStats } from "../stats";
import type { SlotRecord } from "../types";

describe("RollingStats", () => {
  it("tracks the mean of a constant series with zero std", () => {
    const stats = new RollingStats(64);
    for (let i = 0; i < 20; i++) stats.push(100);
    expect(stats.mean).toBe(100);
    expect(stats.std).toBe(0);
    expect(stats.zScore(100)).toBe(0);
  });

  it("reads z 0 while uncalibrated", () => {
    const stats = new RollingStats(64);
    stats.push(100);
    stats.push(500);
    expect(stats.zScore(10_000)).toBe(0);
  });

  it("flags a spike against a noisy baseline", () => {
    const stats = new RollingStats(64);
    for (let i = 0; i < 64; i++) stats.push(100 + (i % 2 ? 10 : -10));
    expect(Math.abs(stats.zScore(100))).toBeLessThan(1);
    expect(stats.zScore(300)).toBeGreaterThan(2.5);
  });

  it("ratio is 1 while empty and relative afterwards", () => {
    const stats = new RollingStats(64);
    expect(stats.ratio(1234)).toBe(1);
    for (let i = 0; i < 30; i++) stats.push(1000);
    expect(stats.ratio(2000)).toBeCloseTo(2, 1);
  });
});

describe("updateChainStats", () => {
  it("ignores skipped slots so zeros don't drag the window", () => {
    const stats = createChainStats();
    const base: SlotRecord = {
      slot: 1,
      blockTime: 0,
      skipped: false,
      txCount: 1000,
      failedTxCount: 10,
      computeUnits: 20_000_000,
      totalFees: 5_000_000,
    };
    for (let i = 0; i < 10; i++) updateChainStats(stats, base);
    updateChainStats(stats, { ...base, skipped: true, txCount: 0 });
    expect(stats.txCount.mean).toBe(1000);
    expect(stats.txCount.count).toBe(10);
  });
});
