"use client";

import ModeToggle, { type Mode } from "./ModeToggle";
import type { Status } from "./Stage";

interface TransportBarProps {
  status: Status;
  mode: Mode;
  volume: number;
  lagRef: React.RefObject<HTMLSpanElement | null>;
  onMode: (mode: Mode) => void;
  onPlayPause: () => void;
  onBack: () => void;
  onForward: () => void;
  onToEdge: () => void;
  onVolume: (db: number) => void;
  onExport: () => void;
  exporting: boolean;
  onShare: () => void;
}

const EYEBROW =
  "font-mono text-[10px] lowercase tracking-[0.25em] text-muted";

export default function TransportBar({
  status,
  mode,
  volume,
  lagRef,
  onMode,
  onPlayPause,
  onBack,
  onForward,
  onToEdge,
  onVolume,
  onExport,
  exporting,
  onShare,
}: TransportBarProps) {
  const active = status === "playing" || status === "paused";
  const seekClass = active
    ? "text-muted transition-colors hover:text-signal"
    : "pointer-events-none text-muted/40";
  const outputClass = (enabled: boolean) =>
    enabled
      ? "text-muted transition-colors hover:text-signal"
      : "pointer-events-none text-muted/40";

  return (
    <div className="mt-4 grid w-full grid-cols-1 gap-y-4 border-y border-muted/20 py-3 font-mono text-xs lowercase sm:grid-cols-[auto_1fr_auto] sm:gap-y-0">
      <div className="flex flex-col gap-2 sm:pr-6">
        <span className={EYEBROW}>source</span>
        <div className="flex items-center gap-4">
          <ModeToggle mode={mode} onChange={onMode} />
          <button
            type="button"
            onClick={onToEdge}
            title={
              mode === "live"
                ? "jump to the newest slot"
                : "jump to the end of the tape"
            }
            className={`flex items-center gap-1.5 tabular-nums ${
              active
                ? "cursor-pointer text-muted/70 transition-colors hover:text-signal"
                : "pointer-events-none text-muted/70"
            }`}
          >
            {status !== "idle" && (
              <span
                aria-hidden
                className={
                  status === "playing" ? "text-signal" : "text-muted/50"
                }
              >
                ●
              </span>
            )}
            <span ref={lagRef} data-testid="lag" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:border-l sm:border-muted/20 sm:px-6">
        <span className={EYEBROW}>transport</span>
        <div className="flex items-center gap-3 sm:justify-center sm:gap-5">
          <button
            type="button"
            onClick={onBack}
            title="skip back 30 seconds"
            className={seekClass}
          >
            ‹ 30s
          </button>
          <button
            type="button"
            onClick={onPlayPause}
            title={status === "playing" ? "pause (space)" : "play (space)"}
            className={`min-w-28 border border-muted/40 px-4 py-1.5 text-center transition-colors ${
              status === "loading"
                ? "pointer-events-none text-muted"
                : "text-signal hover:border-signal"
            }`}
          >
            {status === "playing"
              ? "pause"
              : status === "paused"
                ? "resume"
                : status === "loading"
                  ? "tuning in…"
                  : "start"}
          </button>
          <button
            type="button"
            onClick={onForward}
            title="skip forward 30 seconds"
            className={seekClass}
          >
            30s ›
          </button>
          <button
            type="button"
            onClick={onToEdge}
            title={
              mode === "live"
                ? "jump to the newest slot"
                : "jump to the end of the tape"
            }
            className={seekClass}
          >
            {mode === "live" ? "» now" : "» end"}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:border-l sm:border-muted/20 sm:pl-6">
        <span className={EYEBROW}>output</span>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onShare}
            title="copy a link that lands the tape on the current slot"
            className={outputClass(active)}
          >
            share
          </button>
          <button
            type="button"
            onClick={onExport}
            title="save the last minute of tape as a wav file"
            className={outputClass(active && !exporting)}
          >
            {exporting ? "rendering…" : "wav"}
          </button>
          <label className="flex items-center gap-2 text-muted">
            vol
            <input
              type="range"
              min={-40}
              max={0}
              step={1}
              value={volume}
              onChange={(e) => onVolume(Number(e.target.value))}
              className="w-24 accent-signal"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
