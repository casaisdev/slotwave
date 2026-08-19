import { siteUrl } from "@/lib/site";

// Farcaster Mini App manifest. The accountAssociation is a public proof,
// signed with the owner's Farcaster custody key, that this account owns
// slotwave.martincasais.com; regenerate it if the domain ever changes.
const accountAssociation = {
  header:
    "eyJmaWQiOjI4NTA4OTUsInR5cGUiOiJjdXN0b2R5Iiwia2V5IjoiMHhjOGRiMDA4NDAzMjVCREVmMkU4OTQ0MTE5RTIwRWQ1ZDJEZjVDMUY0In0",
  payload: "eyJkb21haW4iOiJzbG90d2F2ZS5tYXJ0aW5jYXNhaXMuY29tIn0",
  signature:
    "7v1ZlyKdfN5z9khlPD/zSXvfucJuBhs6XD5t6jApw/91o8nX0bIDh644kQYNuZC67SVF9J9cM5ZB0ZFxKpoRYxs=",
};

export async function GET() {
  const base = siteUrl();
  const app = {
    version: "1",
    name: "Slotwave",
    homeUrl: base,
    iconUrl: `${base}/brand/icon-1024.png`,
    splashImageUrl: `${base}/brand/splash-200.png`,
    splashBackgroundColor: "#0a0e1a",
    subtitle: "listen to solana live",
    description: "Listen to Solana in real time. Every slot makes a sound.",
    tagline: "the sound of solana",
    primaryCategory: "music",
    tags: ["solana", "music", "sonification", "blockchain", "live"],
    heroImageUrl: `${base}/opengraph-image`,
    ogTitle: "Slotwave",
    ogDescription: "Listen to Solana in real time. Every slot makes a sound.",
    ogImageUrl: `${base}/opengraph-image`,
    // manifest-level default embed, for surfaces that don't read page meta
    imageUrl: `${base}/embed-image`,
    buttonTitle: "listen",
  };
  return Response.json(
    // `miniapp` is the current key; `frame` keeps older validators happy.
    { accountAssociation, miniapp: app, frame: app },
    { headers: { "Cache-Control": "public, s-maxage=3600" } },
  );
}
