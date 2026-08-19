import { describe, expect, it } from "vitest";
import { createSession } from "../session";
import type { SlotRecord } from "../types";

const record = (slot: number, overrides: Partial<SlotRecord> = {}): SlotRecord => ({
  slot,
  blockTime: 1_755_000_000,
  skipped: false,
  txCount: 1200,
  failedTxCount: 30,
  computeUnits: 24_000_000,
  totalFees: 7_000_000,
  ...overrides,
});

describe("createSession", () => {
  it("maps each slot exactly once, with sequential indices", () => {
    const session = createSession();
    const a = session.ingest(record(1));
    const b = session.ingest(record(2));
    expect(a.index).toBe(0);
    expect(b.index).toBe(1);
    expect(session.slots).toEqual([a, b]);
    expect(a.events.length).toBeGreaterThan(0);
    expect(a.visuals).toHaveLength(a.events.length);
    expect(a.playedAt).toBeNull();
  });

  it("stored events are stable, a rewound slot replays identically", () => {
    const session = createSession();
    const played = session.ingest(record(1));
    const snapshot = JSON.parse(JSON.stringify(played.events));
    session.ingest(record(2, { txCount: 5000 }));
    session.ingest(record(3, { skipped: true, txCount: 0 }));
    expect(played.events).toEqual(snapshot);
  });

  it("a skipped slot keeps its place in the tape", () => {
    const session = createSession();
    session.ingest(record(1));
    const skipped = session.ingest(record(2, { skipped: true, txCount: 0 }));
    expect(skipped.index).toBe(1);
    expect(skipped.events).toHaveLength(1);
    expect(skipped.events[0].voice).toBe("event");
  });
});
