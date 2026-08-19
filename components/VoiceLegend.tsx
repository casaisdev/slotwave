const S = "var(--color-signal)";
const E = "var(--color-event)";
const M = "var(--color-muted)";

const VOICES: { name: string; glyph: React.ReactNode; text: string }[] = [
  {
    name: "notes",
    glyph: (
      <g stroke={S} strokeWidth="1.5" strokeLinecap="round">
        <path d="M10 26V16" />
        <path d="M22 26V12" opacity="0.8" />
        <path d="M34 26V8" />
        <path d="M46 26V14" opacity="0.7" />
        <path d="M54 26V6" />
      </g>
    ),
    text: "each slot plays 1 to 4 pentatonic notes from its real transactions (validator votes are filtered out). busier slots get more notes, higher up the scale.",
  },
  {
    name: "brightness",
    glyph: (
      <g fill="none" strokeWidth="1.5" strokeLinecap="round">
        <path d="M6 22h20c6 0 8-4 10-8" stroke={M} opacity="0.6" />
        <path d="M6 22h32c8 0 12-8 16-16" stroke={S} />
      </g>
    ),
    text: "compute load opens a lowpass filter. an idle chain sounds dull, a congested one sounds bright.",
  },
  {
    name: "bass",
    glyph: (
      <g stroke={S} strokeLinecap="round">
        <path d="M4 24h56" strokeWidth="1" opacity="0.3" />
        <path d="M22 24h20" strokeWidth="3" />
      </g>
    ),
    text: "total fees set the ground note under every slot. heavier fees make a harder floor.",
  },
  {
    name: "crackle",
    glyph: (
      <g fill={S}>
        <rect x="14" y="20" width="2" height="2" />
        <rect x="26" y="24" width="2" height="2" opacity="0.7" />
        <rect x="34" y="18" width="2" height="2" opacity="0.8" />
        <rect x="44" y="23" width="2" height="2" opacity="0.6" />
        <rect x="52" y="20" width="2" height="2" />
      </g>
    ),
    text: "failed transactions fall as small grains under the timeline. you hear them as static.",
  },
  {
    name: "air",
    glyph: (
      <path
        d="M4 20c8-9 16-9 24 0s16 9 24 0"
        stroke={S}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
    ),
    text: "a slow pad breathes underneath with overall activity. congestion opens it up, a skipped slot leaves a hole.",
  },
  {
    name: "skip",
    glyph: (
      <g strokeLinecap="round">
        <g stroke={S} strokeWidth="1.5">
          <path d="M10 26v-10" />
          <path d="M18 26v-13" />
          <path d="M46 26v-12" />
          <path d="M54 26v-9" />
        </g>
        <path d="M32 4v24" stroke={E} strokeWidth="1.5" />
      </g>
    ),
    text: "a leader missed its slot. the tape gaps and a low violet thud marks the silence.",
  },
  {
    name: "spike",
    glyph: (
      <g strokeLinecap="round">
        <g stroke={S} strokeWidth="1.5" opacity="0.7">
          <path d="M10 26v-8" />
          <path d="M20 26v-10" />
          <path d="M44 26v-9" />
          <path d="M54 26v-8" />
        </g>
        <g stroke={E} strokeWidth="1.5">
          <path d="M32 3v25" />
          <path d="M28 7h8" />
        </g>
      </g>
    ),
    text: "compute usage shot far above its recent average, so you get a metallic violet burst.",
  },
];

export default function VoiceLegend() {
  return (
    <section className="w-full border-t border-muted/20 py-10">
      <h2 className="font-mono text-[10px] lowercase tracking-[0.25em] text-muted">
        what you&apos;re hearing
      </h2>
      <div className="mt-8 grid gap-x-10 gap-y-9 sm:grid-cols-2 lg:grid-cols-4">
        {VOICES.map((voice) => (
          <div key={voice.name} className="group flex flex-col gap-3">
            <svg
              viewBox="0 0 64 32"
              className="h-8 w-16 opacity-70 transition-opacity duration-300 group-hover:opacity-100"
              aria-hidden
            >
              {voice.glyph}
            </svg>
            <h3 className="font-mono text-sm lowercase text-ink">{voice.name}</h3>
            <p className="font-sans text-sm leading-relaxed text-muted">
              {voice.text}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
