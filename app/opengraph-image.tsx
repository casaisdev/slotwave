import { ImageResponse } from "next/og";
import { loadOgFont, OG_FONT_FAMILY, OgCard } from "./og-card";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Slotwave, the sound of Solana";

export default async function Image() {
  const font = await loadOgFont();
  return new ImageResponse(<OgCard />, {
    ...size,
    fonts: [{ name: OG_FONT_FAMILY, data: font, style: "normal" as const }],
  });
}
