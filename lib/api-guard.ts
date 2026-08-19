// App-level policy for the proxy routes: one shared per-IP budget plus the
// history window that bounds how much chain anyone can mine through us.
import { clientKey, createRateLimiter, originAllowed } from "./guard";
import { MAX_HISTORY_SLOTS } from "./protocol";

// A legitimate listener needs ~19 window requests/min; 60/min is generous.
const limiter = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

const NO_STORE = { "Cache-Control": "no-store" };

/** Returns a refusal response, or null when the request may proceed. */
export function guardApiRequest(request: Request): Response | null {
  if (!originAllowed(request)) {
    return Response.json(
      { error: "foreign origin" },
      { status: 403, headers: NO_STORE },
    );
  }
  if (!limiter.take(clientKey(request))) {
    return Response.json(
      { error: "rate limited" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "10" } },
    );
  }
  return null;
}

export function tooOld(slot: number, finalizedTip: number): boolean {
  return finalizedTip - slot > MAX_HISTORY_SLOTS;
}
