// SPDX-License-Identifier: Apache-2.0
// Daily refresh (run by .github/workflows/update.yml): scrape the latest page(s) of every lottery,
// merge new draws into data/draws/<id>.json (dedupe on drawNo, newest first, never delete) and
// prepend one entry per lottery to data/fetch-log.json (newest first, capped at 100).
// Then a light, non-fatal jackpot step (lib/jackpot-sources.ts): data/prizes/<id>.json, data/jackpots.json.
// Exit code 1 only if EVERY lottery failed. One failing lottery never blocks the others.
//
//   npm run update                      latest page per lottery
//   npm run update -- --backfill-dlb    DLB: keep paging back until a page holds only known draws
//   npm run update -- --only=kapruka    restrict to some lotteries (comma separated)
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOTTERIES } from "../lib/lotteries";
import {
  readWinnersDirectory,
  refreshNlbPrizes,
  snapshotDlbJackpots,
  updateDirectory,
  writeJackpots,
} from "../lib/jackpot-sources";
import type { Directory } from "../lib/jackpots";
import { dlbLatestLoader, scrapeLottery, sleep } from "../lib/scrape";
import type { DrawSummary, FetchRun } from "../lib/types";

const DATA = join(process.cwd(), "data");
const LOG_CAP = 100;
const BACKFILL_PAGES = 1000; // safety cap (~12 draws per DLB page)

const args = process.argv.slice(2);
const backfill = args.includes("--backfill-dlb");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

/** Atomic write (temp file + rename) so a crash never leaves half a JSON file. */
function writeAtomic(path: string, text: string) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

/** One draw per line: small, reviewable git diffs. */
const drawsText = (draws: DrawSummary[]) => `[\n${draws.map((d) => JSON.stringify(d)).join(",\n")}\n]\n`;

async function main() {
  const runAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const dlbLatest = dlbLatestLoader();
  const logPath = join(DATA, "fetch-log.json");
  const log = readJson<FetchRun[]>(logPath, []);
  let nextId = log.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const entries: FetchRun[] = [];
  mkdirSync(join(DATA, "draws"), { recursive: true });

  for (const lottery of LOTTERIES.filter((l) => !only || only.includes(l.id))) {
    const file = join(DATA, "draws", `${lottery.id}.json`);
    let entry: Omit<FetchRun, "id">;
    try {
      const existing = readJson<DrawSummary[]>(file, []);
      const known = new Set(existing.map((d) => d.drawNo));
      const { draws, raw } = await scrapeLottery(lottery, dlbLatest, {
        dlbPages: backfill ? BACKFILL_PAGES : 1,
        known: backfill ? known : undefined,
      });
      if (!draws.length) throw new Error(`no draws parsed (raw rows: ${raw}) - markup may have changed`);
      const fresh: DrawSummary[] = [];
      for (const d of draws) {
        if (known.has(d.draw_no)) continue;
        known.add(d.draw_no);
        fresh.push({ drawNo: d.draw_no, date: d.draw_date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null });
      }
      if (fresh.length) {
        const merged = [...existing, ...fresh].sort((a, b) => b.drawNo - a.drawNo);
        writeAtomic(file, drawsText(merged));
      }
      const newest = Math.max(...draws.map((d) => d.draw_no));
      entry = { run_at: runAt, lottery_id: lottery.id, inserted: fresh.length, status: "ok", message: `parsed ${draws.length}, newest #${newest}` };
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      entry = { run_at: runAt, lottery_id: lottery.id, inserted: 0, status: "error", message };
    }
    console.log(`${entry.status === "ok" ? "ok   " : "ERROR"} ${lottery.id.padEnd(16)} +${entry.inserted}  ${entry.message}`);
    entries.push({ id: 0, ...entry });
    await sleep(500);
  }

  await updateJackpots();

  // Newest first: entries of this run in lottery order on top, ids ascending as in the old fetch_log.
  for (const e of entries) e.id = nextId++;
  writeAtomic(logPath, JSON.stringify([...entries.reverse(), ...log].slice(0, LOG_CAP), null, 2) + "\n");

  const failed = entries.filter((e) => e.status === "error").length;
  const inserted = entries.reduce((n, e) => n + e.inserted, 0);
  console.log(`done: ${entries.length - failed}/${entries.length} ok, ${inserted} new draws`);
  if (entries.length && failed === entries.length) process.exit(1);
}

/**
 * Light jackpot step (non-fatal): NLB prize tables of new draws and the 3 newest ones, NLB winners directory
 * page 1, DLB next-jackpot snapshot, then data/jackpots.json. (docs/JACKPOT-WINS.md: npm run jackpots.)
 */
async function updateJackpots() {
  const opts = { dataDir: DATA, log: (l: string) => console.log(`jackpots: ${l}`) };
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (err) {
      console.log(`jackpots: ${name} failed (ignored): ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  for (const lottery of LOTTERIES.filter((l) => l.board === "NLB" && (!only || only.includes(l.id)))) {
    await step(`prizes ${lottery.id}`, () => refreshNlbPrizes(lottery, { ...opts, recent: 3 }));
  }
  let directory: Directory | undefined;
  await step("winners directory", async () => {
    directory = await updateDirectory(opts, await readWinnersDirectory(opts));
  });
  await step("dlb next jackpots", () => snapshotDlbJackpots(opts));
  await step("jackpots.json", async () => writeJackpots(opts, directory));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
