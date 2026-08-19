// Disk archive for fetched windows: every block the RPC provider already
// billed us for becomes a permanent local asset, so dev restarts, replays
// and demos of the same slots never cost another call.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SlotRecord } from "./types";

export function windowFilePath(dir: string, start: number): string {
  return join(dir, `${start}.json`);
}

/** Missing or corrupt files read as null; the caller refetches and rewrites. */
export async function readWindowFile(
  dir: string,
  start: number,
): Promise<SlotRecord[] | null> {
  try {
    const text = await readFile(windowFilePath(dir, start), "utf8");
    const records = JSON.parse(text) as SlotRecord[];
    if (!Array.isArray(records) || records.length === 0) return null;
    return records;
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so a crash never leaves a half-written window. */
export async function writeWindowFile(
  dir: string,
  start: number,
  records: SlotRecord[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = windowFilePath(dir, start);
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(records));
  await rename(tmp, path);
}
