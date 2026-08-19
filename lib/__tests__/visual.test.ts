import { describe, expect, it } from "vitest";
import type { SoundParams } from "../mapping";
import type { SlotRecord } from "../types";
import { pitchNorm, toVisual } from "../visual";

const record: SlotRecord = {
  slot: 42,
  blockTime: 0,
  skipped: false,
  txCount: 1000,
  failedTxCount: 0,
  computeUnits: 20_000_000,
  totalFees: 5_000_000,
};

const signalEvent = (filterHz: number, velocity = 0.6): SoundParams => ({
  voice: "signal",
  notes: ["E4"],
  velocity,
  filterHz,
  duration: 0.07,
  offset: 0.1,
});

describe("toVisual", () => {
  it("recovers filter openness as brightness (inverse of pressure)", () => {
    expect(toVisual(signalEvent(400), record).brightness).toBeCloseTo(0);
    expect(toVisual(signalEvent(8000), record).brightness).toBeCloseTo(1);
  });

  it("signal ticks scale with velocity and pitch, same offset as the sound", () => {
    const vp = toVisual(signalEvent(2000, 0.45), record);
    expect(vp).toMatchObject({ slot: 42, color: "signal", form: "tick", offset: 0.1 });
    expect(vp.height).toBeGreaterThan(0);
    expect(vp.height).toBeLessThan(1);
    // louder is taller
    expect(toVisual(signalEvent(2000, 0.85), record).height).toBeGreaterThan(
      toVisual(signalEvent(2000, 0.45), record).height,
    );
    // higher note is taller: a busy slot draws as a rising arpeggio
    const low = toVisual({ ...signalEvent(2000, 0.6), notes: ["E3"] }, record);
    const high = toVisual({ ...signalEvent(2000, 0.6), notes: ["E5"] }, record);
    expect(high.height).toBeGreaterThan(low.height);
  });

  it("pitchNorm spans the density ladder", () => {
    expect(pitchNorm("E3")).toBe(0);
    expect(pitchNorm("E5")).toBe(1);
    expect(pitchNorm("A4")).toBeGreaterThan(pitchNorm("A3"));
    expect(pitchNorm("garbage")).toBe(0.5);
  });

  it("each voice takes its own drawing form", () => {
    const base = { notes: [], velocity: 0.5, filterHz: 0, duration: 0.1, offset: 0 };
    expect(toVisual({ ...base, voice: "bass" }, record).form).toBe("ground");
    expect(toVisual({ ...base, voice: "texture" }, record).form).toBe("grain");
  });

  it("anomalies render full-strength violet", () => {
    const vp = toVisual(
      {
        voice: "event",
        kind: "skip",
        notes: ["E1"],
        velocity: 0.9,
        filterHz: 0,
        duration: 0.35,
        offset: 0,
      },
      { ...record, skipped: true },
    );
    expect(vp).toMatchObject({ color: "event", height: 1, brightness: 1 });
  });
});
