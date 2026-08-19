import { siteUrl } from "@/lib/site";

// Farcaster Mini App manifest. After deploying, generate the
// accountAssociation for the production domain in Warpcast's developer
// tools and add it here: { header, payload, signature }.
export async function GET() {
  const base = siteUrl();
  const app = {
    version: "1",
    name: "Slotwave",
    homeUrl: base,
    iconUrl: `${base}/brand/icon-1024.png`,
    splashImageUrl: `${base}/brand/splash-200.png`,
    splashBackgroundColor: "#0a0e1a",
    description: "Listen to Solana in real time. Every slot makes a sound.",
    primaryCategory: "music",
    tags: ["solana", "music", "sonification", "blockchain", "live"],
  };
  return Response.json(
    // `miniapp` is the current key; `frame` keeps older validators happy.
    { miniapp: app, frame: app },
    { headers: { "Cache-Control": "public, s-maxage=3600" } },
  );
}
