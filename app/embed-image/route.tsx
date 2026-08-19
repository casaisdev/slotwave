import { ImageResponse } from "next/og";
import { loadOgFont, OG_FONT_FAMILY, OgCard } from "../og-card";

// Farcaster cast embeds want a 3:2 image (the og image is 1.91:1).
const WIDTH = 1200;
const HEIGHT = 800;

export async function GET() {
  const font = await loadOgFont();
  return new ImageResponse(<OgCard />, {
    width: WIDTH,
    height: HEIGHT,
    fonts: [{ name: OG_FONT_FAMILY, data: font, style: "normal" as const }],
  });
}
