// Regenerates public/data/sample.jsonl. Run manually: npx tsx scripts/gen-fixture.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SlotRecord } from "../lib/types";

// Deterministic PRNG so the fixture is reproducible.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x510f);
const SLOT_COUNT = 300;
const FIRST_SLOT = 300_000_000;
const FIRST_BLOCK_TIME = 1_755_000_000;

const records: SlotRecord[] = [];

for (let i = 0; i < SLOT_COUNT; i++) {
  const slot = FIRST_SLOT + i;
  const blockTime = FIRST_BLOCK_TIME + Math.round(i * 0.4);

  if (rand() < 0.03) {
    records.push({
      slot,
      blockTime: null,
      skipped: true,
      txCount: 0,
      failedTxCount: 0,
      computeUnits: 0,
      totalFees: 0,
    });
    continue;
  }

  // Two slow activity waves plus noise, so busy and quiet stretches alternate.
  const wave =
    0.5 +
    0.3 * Math.sin((i / SLOT_COUNT) * Math.PI * 4) +
    0.2 * Math.sin((i / SLOT_COUNT) * Math.PI * 9);
  const activity = Math.min(1, Math.max(0.05, wave + (rand() - 0.5) * 0.3));

  const txCount = Math.round(400 + activity * 1600 + rand() * 200);
  const voteTxCount = Math.round(txCount * (0.6 + rand() * 0.15));
  const failedTxCount = Math.round((txCount - voteTxCount) * (0.1 + rand() * 0.2));
  // A sustained compute-unit spike around slot 200, the anomaly the mapper must catch.
  const spike = i >= 198 && i <= 205 ? 2.4 : 1;
  const computeUnits = Math.round(
    txCount * (18_000 + rand() * 8_000) * spike,
  );
  const totalFees = Math.round(txCount * (5_000 + rand() * 4_000));

  records.push({
    slot,
    blockTime,
    skipped: false,
    txCount,
    voteTxCount,
    failedTxCount,
    computeUnits,
    totalFees,
  });
}

const outPath = join(import.meta.dirname, "..", "public", "data", "sample.jsonl");
writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`wrote ${records.length} records to ${outPath}`);
