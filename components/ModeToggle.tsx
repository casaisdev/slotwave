"use client";

export type Mode = "replay" | "live";

const TITLES: Record<Mode, string> = {
  live: "follow mainnet as it happens",
  replay: "loop the recorded tape",
};

export default function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  return (
    <div className="flex gap-4 font-mono text-xs lowercase">
      {(["live", "replay"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          title={TITLES[m]}
          onClick={() => onChange(m)}
          className={
            m === mode
              ? "border-b border-signal pb-0.5 text-signal"
              : "border-b border-transparent pb-0.5 text-muted transition-colors hover:text-signal/70"
          }
        >
          {m}
        </button>
      ))}
    </div>
  );
}
