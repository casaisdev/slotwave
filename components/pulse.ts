// The wordmark's wave breathes with the audio: the transport stamps a level
// here at each slot's exact audio-clock moment, the Wordmark decays it.
// Mutable module state on purpose; 2.5 writes/sec must not touch React.
export const wavePulse = { level: 0, at: 0 };

export function pushPulse(level: number): void {
  wavePulse.level = Math.min(1, Math.max(0, level));
  wavePulse.at = performance.now();
}
