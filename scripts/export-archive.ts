// Concatenates the dev window archive into a replay tape.
// Usage: npx tsx scripts/export-archive.ts [--out public/data/archive.jsonl]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SlotRecord } from "../lib/types";

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const archiveDir = join(import.meta.dirname, "..", ".cache", "slotwave");
const outPath = argValue(
  "--out",
  join(import.meta.dirname, "..", "public", "data", "archive.jsonl"),
);

let starts: number[];
try {
  starts = readdirSync(archiveDir)
    .filter((name) => /^\d+\.json$/.test(name))
    .map((name) => Number(name.replace(".json", "")))
    .sort((a, b) => a - b);
} catch {
  console.error(`no archive at ${archiveDir} yet; listen in live mode first`);
  process.exit(1);
}

const bySlot = new Map<number, SlotRecord>();
for (const start of starts) {
  try {
    const records = JSON.parse(
      readFileSync(join(archiveDir, `${start}.json`), "utf8"),
    ) as SlotRecord[];
    for (const record of records) bySlot.set(record.slot, record);
  } catch {
    console.warn(`skipping corrupt window ${start}`);
  }
}

const slots = [...bySlot.keys()].sort((a, b) => a - b);
if (slots.length === 0) {
  console.error("archive is empty");
  process.exit(1);
}

const lines = slots.map((slot) => JSON.stringify(bySlot.get(slot)));
writeFileSync(outPath, lines.join("\n") + "\n");

const gaps = slots.filter((slot, i) => i > 0 && slot !== slots[i - 1] + 1).length;
console.log(
  `wrote ${slots.length} slots (${slots[0]}..${slots[slots.length - 1]}, ` +
    `${gaps} gap${gaps === 1 ? "" : "s"}) to ${outPath}`,
);
