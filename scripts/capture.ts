// Records a real mainnet fixture. Dev tooling, never shipped to the client.
// Usage: npx tsx scripts/capture.ts [--slots 600] [--out public/data/mainnet.jsonl]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fetchSlotRecord, getSlotAt, getSlotLeaders, RpcError } from "../lib/solana";
import type { SlotRecord } from "../lib/types";

function loadEnv(): void {
  if (process.env.SOLANA_RPC_URL) return;
  for (const name of [".env.local", ".env"]) {
    const envPath = join(import.meta.dirname, "..", name);
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match) process.env[match[1]] ??= match[2];
    }
    if (process.env.SOLANA_RPC_URL) return;
  }
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

async function fetchWithRetry(rpcUrl: string, slot: number) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchSlotRecord(rpcUrl, slot);
    } catch (err) {
      if (attempt >= 3) throw err;
      const reason = err instanceof RpcError ? `code ${err.code}` : String(err);
      console.warn(`slot ${slot}: retry ${attempt} (${reason})`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  loadEnv();
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    console.error("SOLANA_RPC_URL is not set (env, .env.local or .env)");
    process.exit(1);
  }

  const slotCount = Number(argValue("--slots", "600"));
  const outPath = argValue(
    "--out",
    join(import.meta.dirname, "..", "public", "data", "mainnet.jsonl"),
  );
  const CONCURRENCY = 4;

  const tip = await getSlotAt(rpcUrl, "finalized");
  const firstSlot = tip - slotCount + 1;
  console.log(`capturing slots ${firstSlot}..${tip} -> ${outPath}`);

  const records = new Array<SlotRecord>(slotCount);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < slotCount) {
      const i = next;
      next += 1;
      records[i] = await fetchWithRetry(rpcUrl, firstSlot + i);
      done += 1;
      if (done % 50 === 0) console.log(`${done}/${slotCount}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  try {
    const leaders = await getSlotLeaders(rpcUrl, firstSlot, slotCount);
    records.forEach((record, i) => {
      if (leaders[i]) record.leader = leaders[i];
    });
  } catch (err) {
    console.warn(`leader schedule unavailable, tape ships without it (${err})`);
  }

  writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const skips = records.filter((r) => r.skipped).length;
  const votes = records.reduce((sum, r) => sum + (r.voteTxCount ?? 0), 0);
  const total = records.reduce((sum, r) => sum + r.txCount, 0);
  console.log(
    `done: ${slotCount} slots, ${skips} skipped, ` +
      `${((votes / Math.max(1, total)) * 100).toFixed(0)}% vote traffic`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
