import { guardApiRequest, tooOld } from "@/lib/api-guard";
import { WINDOW_SIZE } from "@/lib/protocol";
import { getFinalizedTip, getWindowRecords } from "@/lib/rpc";

const START_PARAM = /^\d{1,12}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/window/[start]">,
) {
  const refused = guardApiRequest(request);
  if (refused) return refused;

  const { start: startParam } = await ctx.params;
  if (!START_PARAM.test(startParam)) {
    return Response.json(
      { error: "invalid window start" },
      { status: 400, headers: NO_STORE },
    );
  }
  const start = Number(startParam);
  // Only aligned windows exist: every listener asks for identical URLs,
  // so the CDN stores each stretch of chain exactly once.
  if (start % WINDOW_SIZE !== 0) {
    return Response.json(
      { error: `window start must be a multiple of ${WINDOW_SIZE}` },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    // Immutable caching is only safe once the whole window is finalized:
    // a skipped verdict near the head can still change.
    const finalized = await getFinalizedTip();
    if (start + WINDOW_SIZE - 1 > finalized) {
      return Response.json(
        { error: "window not finalized yet" },
        { status: 404, headers: NO_STORE },
      );
    }
    if (tooOld(start, finalized)) {
      return Response.json(
        { error: "window too old" },
        { status: 404, headers: NO_STORE },
      );
    }
    const records = await getWindowRecords(start);
    return Response.json(
      { start, records },
      { headers: { "Cache-Control": "public, s-maxage=31536000, immutable" } },
    );
  } catch {
    return Response.json(
      { error: "rpc unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
