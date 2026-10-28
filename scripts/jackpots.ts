// SPDX-License-Identifier: Apache-2.0
// (Re)build the jackpot data: data/prizes/<id>.json and data/jackpots.json (see lib/jackpot-sources.ts).
//
//   npm run jackpots                         NLB prize tables for archived draws missing a row,
//                                            full NLB winners directory, DLB next-jackpot snapshot,
//                                            data/jackpots.json and docs/JACKPOT-WINS.md
//   npm run jackpots -- --all                refetch the prize table of every archived NLB draw
//   npm run jackpots -- --cache=<dir>        cache raw pages in <dir> (re-runs are offline)
//   npm run jackpots -- --only=mega-power    restrict the prize-table step (comma separated)
import { join } from "node:path";
import { LOTTERIES } from "../lib/lotteries";
import {
  readWinnersDirectory,
  refreshNlbPrizes,
  snapshotDlbJackpots,
  updateDirectory,
  writeJackpotDoc,
  writeJackpots,
} from "../lib/jackpot-sources";

const args = process.argv.slice(2);
const opt = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = opt("only")?.split(",");
const opts = { dataDir: join(process.cwd(), "data"), cacheDir: opt("cache"), log: (l: string) => console.log(l) };

async function main() {
  for (const lottery of LOTTERIES.filter((l) => l.board === "NLB" && (!only || only.includes(l.id)))) {
    await refreshNlbPrizes(lottery, { ...opts, all: args.includes("--all") });
  }
  const directory = await updateDirectory(opts, await readWinnersDirectory({ ...opts, allMonths: true }), { replace: true });
  try {
    await snapshotDlbJackpots(opts);
  } catch (err) {
    console.log(`dlb next jackpots failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const jackpots = writeJackpots(opts, directory);
  writeJackpotDoc(opts, jackpots, join(process.cwd(), "docs", "JACKPOT-WINS.md"));
  for (const l of LOTTERIES) {
    const own = jackpots.filter((j) => j.lotteryId === l.id);
    console.log(`${l.id.padEnd(16)} ${own.length} jackpot wins`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
