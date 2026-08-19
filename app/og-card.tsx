// Shared social-card artwork: the og image (1.91:1) and the Farcaster embed
// (3:2) render the same design at different canvas sizes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const TICKS = [34, 58, 44, 72, 38, 64, 50, 84, 36, 60, 68, 46, 76, 42, 62, 54];
const VIOLET_AT = 7;

export const OG_FONT_FAMILY = "JetBrains Mono";

/** JetBrains Mono Medium (OFL), vendored so builds need no network. */
export function loadOgFont(): Promise<Buffer> {
  return readFile(join(process.cwd(), "app", "og-font.ttf"));
}

export function OgCard() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#0a0e1a",
        gap: 32,
      }}
    >
      <div style={{ display: "flex", alignItems: "center" }}>
        <span
          style={{ fontSize: 128, color: "#e2e8f0", fontFamily: OG_FONT_FAMILY }}
        >
          slot
        </span>
        <svg width="104" height="94" viewBox="0 0 48 49" style={{ marginTop: 18 }}>
          <polyline
            points="2,45 7.5,4 13,45 18.5,4 24,45 29.5,4 35,45 40.5,4 46,45"
            stroke="#22e584"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <span
          style={{ fontSize: 128, color: "#e2e8f0", fontFamily: OG_FONT_FAMILY }}
        >
          ave
        </span>
      </div>
      <div style={{ fontSize: 34, color: "#94a3b8", fontFamily: OG_FONT_FAMILY }}>
        the sound of solana, slot by slot
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 12,
          marginTop: 28,
        }}
      >
        {TICKS.map((height, i) => (
          <div
            key={i}
            style={{
              width: 4,
              height,
              backgroundColor: i === VIOLET_AT ? "#8b5cf6" : "#22e584",
              opacity: i === VIOLET_AT ? 0.95 : 0.75,
            }}
          />
        ))}
      </div>
    </div>
  );
}
