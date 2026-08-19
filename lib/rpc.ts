// Server boundary for the RPC proxy: env access plus small in-memory caches.
// In production the CDN absorbs repeats; these caches make `next dev` (no CDN)
// bearable and keep tip lookups from hitting the provider on every request.
import "server-only";
import { join } from "node:path";
import { readWindowFile, writeWindowFile } from "./archive";
import { WINDOW_SIZE } from "./protocol";
import { fetchSlotRecord, getSlotAt, getSlotLeaders, RpcError } from "./solana";
import type { SlotRecord } from "./types";

export { RpcError };

function rpcUrl(): string {
  const url = process.env.SOLANA_RPC_URL;
  if (!url) throw new RpcError(null, "SOLANA_RPC_URL is not set");
  return url;
}

// Matches /api/tip's s-maxage=3: one upstream getSlot every ~2.5s at most.
const TIP_TTL_MS = 2500;
let tipCache: { value: number; at: number } | null = null;

export async function getFinalizedTip(): Promise<number> {
  if (tipCache && Date.now() - tipCache.at < TIP_TTL_MS) return tipCache.value;
  const finalized = await getSlotAt(rpcUrl(), "finalized");
  tipCache = { value: finalized, at: Date.now() };
  return finalized;
}

const SLOT_CACHE_MAX = 1024;
const slotCache = new Map<number, SlotRecord>();

function remember(record: SlotRecord): void {
  slotCache.set(record.slot, record);
  if (slotCache.size > SLOT_CACHE_MAX) {
    const oldest = slotCache.keys().next().value;
    if (oldest !== undefined) slotCache.delete(oldest);
  }
}

export async function getSlotRecord(slot: number): Promise<SlotRecord> {
  const cached = slotCache.get(slot);
  if (cached) return cached;
  const record = await fetchSlotRecord(rpcUrl(), slot);
  remember(record);
  return record;
}

// Blocks are ~8MB each upstream; a small worker pool keeps a window fetch
// under the provider's rate limit while sustaining the chain's pace. Kept
// modest because concurrent 8MB JSON parses spike the server's memory.
const WINDOW_CONCURRENCY = 3;

// Windows are finalized and immutable, so once fetched they are archived to
// disk: restarts and re-listens never cost another provider call. On
// read-only filesystems (serverless) writes flip themselves off; the CDN
// plays the archive's role there.
const ARCHIVE_DIR = join(process.cwd(), ".cache", "slotwave");
let archiveWritable = true;

// One getSlotLeaders call covers 256 slots (~0.004 calls per slot) and gives
// the music its 4-slot leader phrasing. Failures degrade to "no leader".
const LEADER_CHUNK = 256;
const leaderCache = new Map<number, string[]>();

async function leaderChunk(chunkStart: number): Promise<string[] | null> {
  const cached = leaderCache.get(chunkStart);
  if (cached) return cached;
  try {
    const leaders = await getSlotLeaders(rpcUrl(), chunkStart, LEADER_CHUNK);
    leaderCache.set(chunkStart, leaders);
    if (leaderCache.size > 16) {
      const oldest = leaderCache.keys().next().value;
      if (oldest !== undefined) leaderCache.delete(oldest);
    }
    return leaders;
  } catch {
    return null;
  }
}

async function leadersFor(
  start: number,
  size: number,
): Promise<(string | undefined)[]> {
  const out: (string | undefined)[] = [];
  for (let i = 0; i < size; i++) {
    const slot = start + i;
    const chunkStart = Math.floor(slot / LEADER_CHUNK) * LEADER_CHUNK;
    const chunk = await leaderChunk(chunkStart);
    out.push(chunk?.[slot - chunkStart]);
  }
  return out;
}

export async function getWindowRecords(start: number): Promise<SlotRecord[]> {
  const archived = await readWindowFile(ARCHIVE_DIR, start);
  if (
    archived &&
    archived.length === WINDOW_SIZE &&
    archived[0].slot === start
  ) {
    return archived;
  }

  const records = new Array<SlotRecord>(WINDOW_SIZE);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < WINDOW_SIZE) {
      const i = next;
      next += 1;
      try {
        records[i] = await getSlotRecord(start + i);
      } catch (err) {
        // stop the other workers: the window is already lost, no point
        // spending more provider calls on it
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(WINDOW_CONCURRENCY, WINDOW_SIZE) }, () =>
      worker(),
    ),
  );

  const leaders = await leadersFor(start, WINDOW_SIZE);
  const enriched = records.map((record, i) =>
    leaders[i] ? { ...record, leader: leaders[i] } : record,
  );

  if (archiveWritable) {
    try {
      await writeWindowFile(ARCHIVE_DIR, start, enriched);
    } catch {
      archiveWritable = false;
    }
  }
  return enriched;
}
