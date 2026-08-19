import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WINDOW_SIZE } from "../protocol";
import { createLiveSource, type FetchLike } from "../sources/live";
import type { SlotRecord } from "../types";

const record = (slot: number): SlotRecord => ({
  slot,
  blockTime: null,
  skipped: false,
  txCount: 100,
  failedTxCount: 0,
  computeUnits: 1,
  totalFees: 1,
});

const ok = (body: unknown) => ({ status: 200, json: async () => body });
const status = (code: number) => ({ status: code, json: async () => ({}) });

const windowBody = (start: number) => ({
  start,
  records: Array.from({ length: WINDOW_SIZE }, (_, i) => record(start + i)),
});

/**
 * fetch stub: /api/tip reports the client-visible tip; windows are served
 * when fully below the server tip (defaults to the same value).
 */
const chainFetch =
  (tip: () => number, serverTip?: () => number, log?: string[]): FetchLike =>
  async (url) => {
    log?.push(url);
    if (url === "/api/tip") return ok({ finalized: tip() });
    const start = Number(url.split("/").pop());
    if (start % WINDOW_SIZE !== 0) return status(400);
    if (start + WINDOW_SIZE - 1 > (serverTip ?? tip)()) return status(404);
    return ok(windowBody(start));
  };

describe("createLiveSource", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("primes an aligned window behind the tip and emits slots in order", async () => {
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => 1000),
      tipIntervalMs: 1000,
      primeBacklog: 12,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    // aligned start: floor((1000 - 12) / 8) * 8 = 984; 1000 is not fully
    // coverable (1000 + 7 > 1000), so two windows land: 984..991, 992..999
    expect(seen[0]).toBe(984);
    expect(seen).toEqual(
      Array.from({ length: 16 }, (_, i) => 984 + i),
    );
    source.stop();
  });

  it("extrapolates the tip between sparse anchor polls", async () => {
    let tip = 999;
    const urls: string[] = [];
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => tip, undefined, urls),
      tipIntervalMs: 60_000,
      primeBacklog: 8,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toHaveLength(16); // 984..999 from the single anchor
    tip = 1007; // the chain moves on; no anchor poll for a minute
    // 8-slot safety margin: the estimate reaches 1007 after ~6.4s of drift
    await vi.advanceTimersByTimeAsync(7000);
    expect(seen).toHaveLength(24); // 1000..1007 reached by local extrapolation
    expect(urls.filter((u) => u === "/api/tip")).toHaveLength(1);
    source.stop();
  });

  it("startAt lands the tape on a requested past slot", async () => {
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => 10_000),
      tipIntervalMs: 1000,
      startAt: 9000,
      // hold once a window is in so the test stays small
      hold: () => seen.length >= 8,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    expect(seen[0]).toBe(9000); // the aligned window containing the target
    source.stop();
  });

  it("a future startAt lands at the present instead of hanging", async () => {
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => 1000),
      tipIntervalMs: 1000,
      primeBacklog: 8,
      startAt: 999_999, // far ahead of the chain
      hold: () => seen.length >= 8,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    expect(seen[0]).toBe(992); // aligned window near the tip, not a hang
    source.stop();
  });

  it("does not drop the backlog while the listener holds the tape", async () => {
    let tip = 999;
    let held = false;
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => tip),
      tipIntervalMs: 1000,
      primeBacklog: 8,
      maxLag: 50,
      hold: () => held,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    const before = seen.length;
    held = true;
    tip = 1500; // the chain races far past maxLag while held
    await vi.advanceTimersByTimeAsync(3000);
    held = false;
    await vi.advanceTimersByTimeAsync(1100);
    // once released it may jump to the present, but the jump must not have
    // happened silently during the hold
    expect(seen.length).toBeGreaterThan(before);
    expect(seen.some((s) => s >= 1468)).toBe(true);
    source.stop();
  });

  it("gives up fast when the requested slot is beyond serveable history", async () => {
    const onError = vi.fn();
    const tip = 100_000;
    const source = createLiveSource({
      // server refuses anything older than ~18k slots behind the tip
      fetchLike: async (url) => {
        if (url === "/api/tip") return ok({ finalized: tip });
        const start = Number(url.split("/").pop());
        if (tip - start > 18_000) return status(404);
        return ok(windowBody(start));
      },
      tipIntervalMs: 1000,
      startAt: tip - 50_000,
      onError,
    });
    source.start(() => {});

    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledTimes(1);
    source.stop();
  });

  it("re-anchors instead of guessing when a stalled chain 404s us", async () => {
    const urls: string[] = [];
    const seen: number[] = [];
    const onError = vi.fn();
    const source = createLiveSource({
      // the chain (and server tip) sit still at 999 the whole time
      fetchLike: chainFetch(() => 999, undefined, urls),
      tipIntervalMs: 60_000,
      primeBacklog: 8,
      onError,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(30_000);
    expect(seen).toHaveLength(16); // nothing new exists, nothing new plays
    expect(onError).not.toHaveBeenCalled();
    const tips = urls.filter((u) => u === "/api/tip").length;
    const retries = urls.filter((u) => u === "/api/window/1000").length;
    expect(tips).toBeGreaterThan(1); // 404s triggered corrective anchors
    expect(retries).toBeLessThan(8); // bounded probing, not a request storm
    source.stop();
  });

  it("keeps following the tip as it advances", async () => {
    let tip = 999;
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => tip),
      tipIntervalMs: 1000,
      primeBacklog: 8,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    tip = 1007;
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen).toEqual(Array.from({ length: 24 }, (_, i) => 984 + i));
    source.stop();
  });

  it("waits without failing while the server's tip lags ours", async () => {
    const onError = vi.fn();
    let serverTip = 991;
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => 999, () => serverTip),
      tipIntervalMs: 1000,
      primeBacklog: 8,
      onError,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(3500);
    expect(seen).toEqual(Array.from({ length: 8 }, (_, i) => 984 + i));
    expect(onError).not.toHaveBeenCalled();

    serverTip = 999;
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toHaveLength(16);
    source.stop();
  });

  it("hold() stops window fetching and it resumes when released", async () => {
    let held = false;
    let tip = 999;
    const urls: string[] = [];
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => tip, undefined, urls),
      tipIntervalMs: 1000,
      primeBacklog: 8,
      hold: () => held,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    const before = seen.length;
    expect(before).toBeGreaterThan(0);

    held = true;
    tip = 1015;
    await vi.advanceTimersByTimeAsync(3000);
    expect(seen).toHaveLength(before);
    expect(urls.filter((u) => u === "/api/tip").length).toBeGreaterThan(2);

    held = false;
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen.length).toBeGreaterThan(before);
    source.stop();
  });

  it("jumps forward instead of draining a huge backlog", async () => {
    let tip = 999;
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: chainFetch(() => tip),
      tipIntervalMs: 1000,
      primeBacklog: 8,
      maxLag: 150,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10);
    tip = 5000; // e.g. the tab was asleep for half an hour
    await vi.advanceTimersByTimeAsync(1100);
    expect(seen.some((s) => s >= 4984)).toBe(true);
    expect(seen.filter((s) => s > 1100 && s < 4980)).toEqual([]);
    source.stop();
  });

  it("gives up through onError after consecutive failures, then stays stopped", async () => {
    const onError = vi.fn();
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: async () => status(502),
      tipIntervalMs: 1000,
      maxFailures: 3,
      onError,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(10_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("a transient failure does not trip the fallback", async () => {
    let calls = 0;
    const onError = vi.fn();
    const seen: number[] = [];
    const source = createLiveSource({
      fetchLike: async (url) => {
        if (url === "/api/tip" && calls++ === 0) return status(502);
        return chainFetch(() => 999)(url);
      },
      tipIntervalMs: 1000,
      primeBacklog: 8,
      maxFailures: 3,
      onError,
    });
    source.start((r) => seen.push(r.slot));

    await vi.advanceTimersByTimeAsync(2500);
    expect(onError).not.toHaveBeenCalled();
    expect(seen).toContain(992);
    source.stop();
  });
});
