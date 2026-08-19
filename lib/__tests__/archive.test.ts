import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readWindowFile, windowFilePath, writeWindowFile } from "../archive";
import type { SlotRecord } from "../types";

const record = (slot: number): SlotRecord => ({
  slot,
  blockTime: 1_755_000_000,
  skipped: false,
  txCount: 1000,
  failedTxCount: 20,
  computeUnits: 20_000_000,
  totalFees: 5_000_000,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slotwave-archive-"));
});

describe("window archive", () => {
  it("round-trips a window through disk", async () => {
    const records = Array.from({ length: 8 }, (_, i) => record(100 + i));
    await writeWindowFile(dir, 100, records);
    expect(await readWindowFile(dir, 100)).toEqual(records);
  });

  it("a missing window reads as null", async () => {
    expect(await readWindowFile(dir, 100)).toBeNull();
  });

  it("a corrupt window reads as null instead of throwing", async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(windowFilePath(dir, 100), "not json at all");
    expect(await readWindowFile(dir, 100)).toBeNull();
  });

  it("creates the directory on first write", async () => {
    const nested = join(dir, "deeper", "still");
    await writeWindowFile(nested, 8, [record(8)]);
    expect(await readWindowFile(nested, 8)).toHaveLength(1);
  });
});
