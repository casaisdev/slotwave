import {
  alignWindowStart,
  MAX_HISTORY_SLOTS,
  WINDOW_SIZE,
  type WindowResponse,
} from "../protocol";
import { isSlotRecord, type SlotRecord, type SlotSource } from "../types";

// Minimal shape of fetch the source needs, injectable for tests.
export type FetchLike = (
  url: string,
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface LiveOptions {
  /**
   * /api/tip anchor pace. Between anchors the finalized tip is extrapolated
   * locally (Solana finalizes ~1 slot per 400ms); the server's 404 on
   * non-finalized windows makes optimism safe, so anchors can be sparse.
   */
  tipIntervalMs?: number;
  /** Local pump pace: costs nothing unless a full window became available. */
  pumpIntervalMs?: number;
  /** How many slots behind the finalized tip to start (instant sound). */
  primeBacklog?: number;
  /**
   * Land the tape on this slot instead of near the tip (deep links). The
   * catch-up jump is disabled: staying in the past is the caller's intent.
   */
  startAt?: number | null;
  /** Falling further behind than this jumps forward: live plays the present. */
  maxLag?: number;
  /** Consecutive network failures before giving up via onError. */
  maxFailures?: number;
  /** Window requests kept in flight; the buffer absorbs the rest. */
  concurrency?: number;
  /**
   * Return true to hold fetching (backlog full, or nobody is listening).
   * Polling continues, so fetching resumes on its own when this clears.
   */
  hold?: () => boolean;
  /** Called once when the source gives up; it has already stopped itself. */
  onError?: (error: Error) => void;
  fetchLike?: FetchLike;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
  now?: () => number;
}

const SLOT_MS = 400;
// Extrapolate short of reality: the server's own tip view is cached ~2.5s
// (~6 slots) and finalization arrives with jitter, so a generous margin
// keeps "not finalized yet" refusals rare.
const EXTRAPOLATION_SAFETY_SLOTS = 8;
// After a 404 (our estimate outran the server), back off briefly.
const NOT_FINALIZED_COOLDOWN_MS = 1500;
// After a server error, wait before retrying instead of hammering it.
const FAILURE_COOLDOWN_MS = 2000;
// A 404 with an old anchor means our extrapolation is drifting: re-anchor
// with a real tip instead of guessing further.
const ANCHOR_STALE_MS = 3000;
// Until the first anchor lands, retry it quickly so startup failures
// surface fast; afterwards the sparse cadence takes over.
const FIRST_ANCHOR_RETRY_MS = 2000;

export function createLiveSource(options: LiveOptions = {}): SlotSource {
  const {
    tipIntervalMs = 12_000,
    pumpIntervalMs = 1000,
    // ~13s behind the tip: enough finalized windows exist ahead to keep the
    // fetch pipeline saturated, so playback never starves at the head
    primeBacklog = 32,
    startAt = null,
    maxLag = 150,
    // generous: a dev-server worker restart or a provider hiccup lasts a few
    // seconds, and falling back to replay is a one-way door for the listener
    maxFailures = 8,
    // 3 windows in flight: enough pipeline depth to outpace the chain even
    // when a single window fetch takes longer than its 3.2s of content
    concurrency = 3,
    hold = () => false,
    onError,
    fetchLike = (url) => fetch(url),
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    now = () => Date.now(),
  } = options;

  let running = false;
  let tipTimer: unknown = null;
  let pumpTimer: unknown = null;
  let anchoring = false;
  let anchor: { tip: number; at: number } | null = null;
  // ordered pipeline: `nextEmit` is the window owed to the listener next,
  // `nextFetch` the next one to launch; up to `concurrency` stay in flight
  let nextEmit: number | null = null;
  let nextFetch: number | null = null;
  let inFlight = new Map<
    number,
    Promise<{ status: number; records: SlotRecord[] }>
  >();
  let cooldownUntil = 0;
  let failures = 0;
  let pumping = false;
  let emit: (record: SlotRecord) => void = () => {};

  const stop = () => {
    running = false;
    if (tipTimer !== null) cancel(tipTimer);
    if (pumpTimer !== null) cancel(pumpTimer);
    tipTimer = null;
    pumpTimer = null;
  };

  const fail = (err: unknown) => {
    failures += 1;
    if (failures >= maxFailures && running) {
      stop();
      onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  const estimatedTip = (): number => {
    if (!anchor) return 0;
    const drift = Math.floor((now() - anchor.at) / SLOT_MS);
    return anchor.tip + Math.max(0, drift - EXTRAPOLATION_SAFETY_SLOTS);
  };

  const fetchWindow = async (start: number) => {
    const response = await fetchLike(`/api/window/${start}`);
    if (response.status !== 200) {
      return { status: response.status, records: [] as SlotRecord[] };
    }
    const body = (await response.json()) as WindowResponse;
    // a malformed payload is a failure, not something to play
    const records = Array.isArray(body?.records)
      ? body.records.filter(isSlotRecord)
      : [];
    if (records.length !== WINDOW_SIZE) {
      return { status: 502, records: [] as SlotRecord[] };
    }
    return { status: 200, records };
  };

  // network errors resolve as status 0 so an in-flight promise never rejects
  const launch = (start: number) => {
    inFlight.set(
      start,
      fetchWindow(start).catch(() => ({
        status: 0,
        records: [] as SlotRecord[],
      })),
    );
  };

  // Ordered pipeline loop: windows are fetched ahead while the head of the
  // line is emitted the moment it lands, so batches never leave gaps in the
  // tape. Only pump mutates the cursors, and it is single-flight.
  const pump = async () => {
    if (pumping || !running || anchor === null) return;
    if (now() < cooldownUntil) return;
    pumping = true;
    try {
      while (running) {
        const tip = estimatedTip();
        if (nextEmit === null) {
          // a deep link into the future can never be served: land at the
          // present instead of polling for slots that don't exist yet
          const target =
            startAt !== null
              ? Math.min(startAt, tip - primeBacklog)
              : tip - primeBacklog;
          nextEmit = alignWindowStart(target);
          nextFetch = nextEmit;
        } else if (startAt === null && !hold() && tip - nextEmit > maxLag) {
          // far behind (throttled tab): play the present, drop the backlog.
          // While held this stays frozen: pausing is the listener's intent.
          nextEmit = alignWindowStart(tip - primeBacklog);
          nextFetch = nextEmit;
          inFlight.clear();
        }
        if (!hold()) {
          // the head must always be in flight (it may have 404ed earlier)
          if (
            !inFlight.has(nextEmit) &&
            nextEmit + WINDOW_SIZE - 1 <= tip
          ) {
            launch(nextEmit);
            if (nextFetch !== null && nextFetch <= nextEmit) {
              nextFetch = nextEmit + WINDOW_SIZE;
            }
          }
          while (
            inFlight.size < concurrency &&
            nextFetch !== null &&
            nextFetch + WINDOW_SIZE - 1 <= tip
          ) {
            launch(nextFetch);
            nextFetch += WINDOW_SIZE;
          }
        }
        const headPromise = inFlight.get(nextEmit);
        if (!headPromise) return; // nothing playable yet; pump ticks retry
        const result = await headPromise;
        if (!running) return;
        inFlight.delete(nextEmit);
        // our estimate (or fresher anchor) outran the server's tip
        if (result.status === 404) {
          // ...unless we asked for history the server refuses to serve
          if (anchor && anchor.tip - nextEmit > MAX_HISTORY_SLOTS - WINDOW_SIZE) {
            stop();
            onError?.(new Error("requested slot is beyond serveable history"));
            return;
          }
          cooldownUntil = now() + NOT_FINALIZED_COOLDOWN_MS;
          if (anchor && now() - anchor.at > ANCHOR_STALE_MS) {
            fetchAnchor().catch(() => {}); // corrective, never fatal
          }
          return;
        }
        if (result.status !== 200) {
          cooldownUntil = now() + FAILURE_COOLDOWN_MS;
          fail(new Error(`window ${nextEmit}: HTTP ${result.status || "network"}`));
          return;
        }
        failures = 0;
        for (const record of result.records) emit(record);
        nextEmit += WINDOW_SIZE;
      }
    } catch (err) {
      fail(err);
    } finally {
      pumping = false;
    }
  };

  const pumpLoop = () => {
    if (!running) return;
    pumpTimer = schedule(pumpLoop, pumpIntervalMs);
    void pump();
  };

  const fetchAnchor = async () => {
    if (anchoring || !running) return;
    anchoring = true;
    try {
      const response = await fetchLike("/api/tip");
      if (response.status !== 200) {
        throw new Error(`tip: HTTP ${response.status}`);
      }
      const { finalized } = (await response.json()) as { finalized: number };
      failures = 0;
      anchor = { tip: finalized, at: now() };
    } finally {
      anchoring = false;
    }
  };

  const pollTip = async () => {
    if (!running) return;
    try {
      await fetchAnchor();
      void pump();
    } catch (err) {
      fail(err);
    }
    if (running) {
      tipTimer = schedule(
        pollTip,
        anchor ? tipIntervalMs : Math.min(tipIntervalMs, FIRST_ANCHOR_RETRY_MS),
      );
    }
  };

  return {
    start(onSlot) {
      if (running) return;
      running = true;
      emit = onSlot;
      anchor = null;
      nextEmit = null;
      nextFetch = null;
      inFlight = new Map();
      cooldownUntil = 0;
      failures = 0;
      pumping = false;
      void pollTip();
      pumpTimer = schedule(pumpLoop, pumpIntervalMs);
    },
    stop,
  };
}
