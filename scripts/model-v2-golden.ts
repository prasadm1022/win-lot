// SPDX-License-Identifier: Apache-2.0
// Regenerates test/fixtures/model-v2-golden.json (docs/MODEL-V2.md section 6): a frozen data snapshot plus the full
// win-lot-jackpot-v2 payloads computed on it. test/model-v2.golden.test.ts recomputes the payloads from the frozen
// snapshot and requires deep equality.
//
// Snapshot: Dhana Nidhanaya, Govisetha and Mega Power in full (208 draws each on 2026-10-27), the last 700 draws of
// Ada Kotipathi and Kapruka (their balls out of use, 77-80 and 76-80, are detected inside the snapshot), the whole
// data/jackpots.json and the prize rows of those lotteries.
//
//   npm run golden:model                      recompute the payloads on the frozen snapshot already in the fixture
//                                             (taken from data/ only when there is no fixture yet)
//   npm run golden:model -- --new-snapshot    take a new snapshot from data/ first
//
// Run only on a deliberate model change: bump MODEL_VERSION_V2 (or write a changelog line), then regenerate. Keeping the
// frozen snapshot means the fixture diff shows exactly what the model change did: the snapshot is written on one line,
// the expected payloads with one field per line.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Jackpot, PrizeRow } from "../lib/jackpots";
import { LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { MODEL_VERSION_V2, V2_CONSTANTS, predictAllV2 } from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import { ROOT, generatedAtFor, loadDraws, loadJackpots, readJson, v2Input } from "./model-v2-data";

/** Lotteries of the snapshot and how many of their newest draws are frozen (null = all). */
const GOLDEN_LOTTERIES: readonly { id: string; lastDraws: number | null }[] = [
  { id: "dhana-nidhanaya", lastDraws: null },
  { id: "mega-power", lastDraws: null },
  { id: "govisetha", lastDraws: null },
  { id: "ada-kotipathi", lastDraws: 700 },
  { id: "kapruka", lastDraws: 700 },
];

const GOLDEN_FILE = join(ROOT, "test", "fixtures", "model-v2-golden.json");

interface Snapshot {
  asOf: string;
  lotteries: { lottery: Lottery; generatedAt: string; draws: Draw[] }[];
  jackpots: Jackpot[];
  prizes: Record<string, PrizeRow[]>;
}

/** A new snapshot of data/. */
function takeSnapshot(): Snapshot {
  const lotteries = GOLDEN_LOTTERIES.map(({ id, lastDraws }) => {
    const all = loadDraws(id);
    const draws = lastDraws === null ? all : all.slice(-lastDraws);
    return { lottery: LOTTERY_BY_ID[id], generatedAt: generatedAtFor(id, all), draws };
  });
  const asOf = lotteries.map((l) => l.draws[l.draws.length - 1].draw_date).sort();
  return {
    asOf: asOf[asOf.length - 1],
    lotteries,
    jackpots: loadJackpots(),
    prizes: Object.fromEntries(GOLDEN_LOTTERIES.map(({ id }) => [id, readJson<PrizeRow[]>(`data/prizes/${id}.json`)])),
  };
}

function main(): void {
  const fresh = process.argv.includes("--new-snapshot") || !existsSync(GOLDEN_FILE);
  const snapshot: Snapshot = fresh ? takeSnapshot() : JSON.parse(readFileSync(GOLDEN_FILE, "utf8")).snapshot;
  const expected = predictAllV2(snapshot.lotteries.map((l) => v2Input(l.lottery, l.draws, snapshot.jackpots, l.generatedAt)));
  const fixture = {
    description:
      "win-lot-jackpot-v2 golden fixture (docs/MODEL-V2.md section 6): a frozen data snapshot and the full v2 payloads " +
      "computed on it. Regenerate with `npm run golden:model` only on a deliberate model change.",
    modelVersion: MODEL_VERSION_V2,
    constants: V2_CONSTANTS,
    snapshot,
    expected,
  };
  mkdirSync(dirname(GOLDEN_FILE), { recursive: true });
  // The frozen snapshot stays on one line (it changes only with --new-snapshot); everything else, the expected
  // payloads above all, is indented with one field per line, so `git diff` shows exactly which fields a model change
  // moved. JSON.parse reads either layout the same way.
  const SNAPSHOT_SLOT = "__model_v2_golden_snapshot__";
  const text = JSON.stringify({ ...fixture, snapshot: SNAPSHOT_SLOT }, null, 1).replace(`"${SNAPSHOT_SLOT}"`, () => JSON.stringify(snapshot));
  writeFileSync(GOLDEN_FILE, `${text}\n`);
  const sizes = snapshot.lotteries.map((l) => `${l.lottery.id} ${l.draws.length}`).join(", ");
  console.log(`model-v2-golden: wrote ${GOLDEN_FILE} (${fresh ? "new" : "frozen"} snapshot as of ${snapshot.asOf}: ${sizes} draws)`);
}

main();
