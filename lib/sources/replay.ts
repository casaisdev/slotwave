import { isSlotRecord, type SlotRecord, type SlotSource } from "../types";

export interface ReplayOptions {
  /** Pace between emitted slots. Solana averages ~400ms. */
  slotIntervalMs?: number;
  /** Restart from the first record after the last one. */
  loop?: boolean;
  /** Injectable timers so pacing is unit-testable without real time. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (id: unknown) => void;
}

/** One record per line; corrupt or malformed lines are dropped with a warning
 * instead of killing the whole tape. */
export function parseJsonl(text: string): SlotRecord[] {
  const records: SlotRecord[] = [];
  let dropped = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isSlotRecord(parsed)) records.push(parsed);
      else dropped += 1;
    } catch {
      dropped += 1;
    }
  }
  if (dropped > 0) {
    console.warn(`parseJsonl: dropped ${dropped} corrupt line(s)`);
  }
  return records;
}

export function createReplaySource(
  records: SlotRecord[],
  options: ReplayOptions = {},
): SlotSource {
  const {
    slotIntervalMs = 400,
    loop = false,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  } = options;

  let timer: unknown = null;
  let running = false;

  return {
    start(onSlot) {
      if (running || records.length === 0) return;
      running = true;
      let index = 0;

      const tick = () => {
        if (!running) return;
        onSlot(records[index]);
        index += 1;
        if (index >= records.length) {
          if (!loop) {
            running = false;
            return;
          }
          index = 0;
        }
        timer = schedule(tick, slotIntervalMs);
      };

      timer = schedule(tick, slotIntervalMs);
    },
    stop() {
      running = false;
      if (timer !== null) {
        cancel(timer);
        timer = null;
      }
    },
  };
}
