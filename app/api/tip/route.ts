import { guardApiRequest } from "@/lib/api-guard";
import { getFinalizedTip } from "@/lib/rpc";

export async function GET(request: Request) {
  const refused = guardApiRequest(request);
  if (refused) return refused;

  try {
    const finalized = await getFinalizedTip();
    return Response.json(
      { finalized },
      {
        headers: {
          "Cache-Control": "public, s-maxage=3, stale-while-revalidate=3",
        },
      },
    );
  } catch {
    return Response.json(
      { error: "rpc unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
