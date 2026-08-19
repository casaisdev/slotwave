export type Voice = "signal" | "event" | "bass" | "texture";
export type AnomalyKind = "skip" | "cuSpike";

export interface SoundParams {
  voice: Voice;
  notes: string[];
  /** 0..1 */
  velocity: number;
  /** Lowpass cutoff for the signal chain; 0 for the event voice. */
  filterHz: number;
  /** Seconds. */
  duration: number;
  /** Offset within the slot window, seconds. */
  offset: number;
  kind?: AnomalyKind;
}

/** Solana slot pace, the musical window each record fills. */
export const SLOT_WINDOW_S = 0.4;

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
