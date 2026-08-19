import type { SoundParams } from "../mapping";
import type { ChainStats } from "../stats";
import type { SlotRecord } from "../types";
import { anomaly } from "./anomaly";
import { bass } from "./bass";
import { density } from "./density";
import { pressure } from "./pressure";
import { texture } from "./texture";

/**
 * Pure composition: one slot record in, scheduled sound params out.
 * Caller updates ChainStats afterwards so a spike is judged against the past,
 * not against itself.
 */
export function mapSlot(record: SlotRecord, stats: ChainStats): SoundParams[] {
  const events = anomaly(record, stats);

  if (!record.skipped) {
    const { filterHz, velocity } = pressure(record, stats);
    for (const { note, offset } of density(record, stats)) {
      events.push({
        voice: "signal",
        notes: [note],
        velocity,
        filterHz,
        duration: 0.07,
        offset,
      });
    }
    events.push(...bass(record, stats));
    events.push(...texture(record));
  }

  return events;
}
