import { guardApiRequest, tooOld } from "@/lib/api-guard";
import { getFinalizedTip, getSlotRecord } from "@/lib/rpc";

const SLOT_PARAM = /^\d{1,12}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/slot/[slot]">,
) {
  const refused = guardApiRequest(request);
  if (refused) return refused;

  const { slot: slotParam } = await ctx.params;
  if (!SLOT_PARAM.test(slotParam)) {
    return Response.json(
      { error: "invalid slot" },
      { status: 400, headers: NO_STORE },
    );
  }
  const slot = Number(slotParam);

  try {
    // Only finalized slots may be served: an immutable CDN entry for a slot
    // whose skipped/contents verdict could still change would be poison.
    const finalized = await getFinalizedTip();
    if (slot > finalized) {
      return Response.json(
        { error: "slot not finalized yet" },
        { status: 404, headers: NO_STORE },
      );
    }
    if (tooOld(slot, finalized)) {
      return Response.json(
        { error: "slot too old" },
        { status: 404, headers: NO_STORE },
      );
    }
    const record = await getSlotRecord(slot);
    return Response.json(record, {
      headers: { "Cache-Control": "public, s-maxage=31536000, immutable" },
    });
  } catch {
    return Response.json(
      { error: "rpc unavailable" },
      { status: 502, headers: NO_STORE },
    );
  }
}
