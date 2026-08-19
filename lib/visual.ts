import { clamp01, type SoundParams } from "./mapping";
import type { SlotRecord } from "./types";

/** How the stage draws an event, keeps the canvas dumb and this mapping pure. */
export type VisualForm = "tick" | "column" | "grain" | "ground";

export interface VisualParams {
  slot: number;
  /** Theme token: signal = normal flow (green), event = anomaly (violet). */
  color: "signal" | "event";
  form: VisualForm;
  /** 0..1, tick height / mark intensity, from velocity. */
  height: number;
  /** 0..1, brightness, from filter openness. */
  brightness: number;
  /** Seconds within the slot window, same offset the sound plays at. */
  offset: number;
}

const FORM_BY_VOICE: Record<SoundParams["voice"], VisualForm> = {
  signal: "tick",
  event: "column",
  bass: "ground",
  texture: "grain",
};

const SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/** 0..1 across the density ladder (E3..E5): higher note, taller tick. */
export function pitchNorm(note: string): number {
  const match = note.match(/^([A-G])(\d)$/);
  if (!match) return 0.5;
  const midi = (Number(match[2]) + 1) * 12 + SEMITONE[match[1]];
  return clamp01((midi - 52) / 24); // E3 = 52 ... E5 = 76
}

/** Derive a pixel from the exact sound that will play, one source of truth. */
export function toVisual(event: SoundParams, record: SlotRecord): VisualParams {
  if (event.voice === "event") {
    return {
      slot: record.slot,
      color: "event",
      form: "column",
      height: 1,
      brightness: 1,
      offset: event.offset,
    };
  }
  // Velocity lives in a compressed musical range (~0.3..0.9); stretch it so
  // the tape uses its full vertical contrast.
  const velocity = clamp01((event.velocity - 0.25) / 0.65);
  return {
    slot: record.slot,
    color: "signal",
    form: FORM_BY_VOICE[event.voice],
    // Notes climb with their pitch, so a busy slot reads as a small
    // ascending arpeggio instead of a flat clump.
    height:
      event.voice === "signal"
        ? clamp01(velocity * (0.45 + 0.55 * pitchNorm(event.notes[0] ?? "")))
        : clamp01(event.velocity),
    // Inverse of the pressure mapping (filterHz = 400 * 20^utilization);
    // voices without a filter carry their velocity as brightness.
    brightness:
      event.voice === "signal"
        ? clamp01(Math.log(event.filterHz / 400) / Math.log(20))
        : clamp01(event.velocity),
    offset: event.offset,
  };
}
