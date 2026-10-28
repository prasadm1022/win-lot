// SPDX-License-Identifier: Apache-2.0
// Network + file side of the jackpot data (parsers live in lib/jackpots.ts). Used by
// scripts/jackpots.ts (full rebuild) and scripts/update.ts (light daily step).
//
// Files:
//   data/prizes/<id>.json  PrizeRow[] newest first. NLB: jackpot tier of every draw in the archive.
//                          DLB: next-draw jackpot snapshots from the dlb.lk home page (NEXT JACKPOT).
//   data/jackpots.json     Jackpot[] newest first (draws where the jackpot was won).
//   docs/JACKPOT-WINS.md   human-readable tables (scripts/jackpots.ts only).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { LOTTERIES, type Lottery } from "./lotteries";
import { fetchNlb, fetchText, sleep } from "./scrape";
import {
  buildJackpots,
  isSuperPrizeListing,
  jackpotTier,
  parseDlbNextJackpots,
  parseNlbPrizeTable,
  parseNlbDrawPageDate,
  parseNlbWinnersDirectory,
  parseNlbWinnersMonths,
  renderJackpotDoc,
  type Directory,
  type Jackpot,
  type PrizeRow,
} from "./jackpots";
import type { DrawSummary } from "./types";

const NLB_WINNERS = "https://www.nlb.lk/winners";
const DLB_HOME = "https://www.dlb.lk/home/en";
const DELAY_MS = 500;
const SETTLE_DRAWS = 7; // a missing prize table on one of the newest 7 draws may still appear

export interface SourceOptions {
  dataDir: string;
  /** Optional directory for raw page caching (re-runs read from it instead of the network). */
  cacheDir?: string;
  log?: (line: string) => void;
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

function writeAtomic(path: string, text: string) {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

const linesText = (rows: unknown[]) => `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`;

async function getPage(url: string, opts: SourceOptions): Promise<string> {
  const file = opts.cacheDir && join(opts.cacheDir, createHash("sha1").update(url).digest("hex").slice(0, 16) + ".html");
  if (file && existsSync(file)) return readFileSync(file, "utf8");
  await sleep(DELAY_MS);
  const html = url.includes("nlb.lk") ? await fetchNlb(url) : await fetchText(url);
  if (file) {
    mkdirSync(opts.cacheDir!, { recursive: true });
    writeFileSync(file, html);
  }
  return html;
}

const prizesPath = (o: SourceOptions, id: string) => join(o.dataDir, "prizes", `${id}.json`);
const drawsOf = (o: SourceOptions, id: string) => readJson<DrawSummary[]>(join(o.dataDir, "draws", `${id}.json`), []);
export const readPrizes = (o: SourceOptions, id: string) => readJson<PrizeRow[]>(prizesPath(o, id), []);

function writePrizes(o: SourceOptions, id: string, rows: PrizeRow[]) {
  mkdirSync(join(o.dataDir, "prizes"), { recursive: true });
  writeAtomic(prizesPath(o, id), linesText([...rows].sort((a, b) => b.drawNo - a.drawNo)));
}

/**
 * NLB: fetch the per-draw page of every archived draw without a prize row, plus the newest `recent` draws
 * (their winner counts may still be updated), or of all draws when `all`, and store the jackpot tier.
 * Returns the number of rows added/updated. Page failures are skipped (retried on the next run).
 */
export async function refreshNlbPrizes(
  lottery: Lottery,
  opts: SourceOptions & { all?: boolean; recent?: number },
): Promise<number> {
  const rows = new Map(readPrizes(opts, lottery.id).map((r) => [r.drawNo, r]));
  const draws = drawsOf(opts, lottery.id);
  const newest = new Set(draws.slice(0, SETTLE_DRAWS).map((d) => d.drawNo));
  const todo = draws.filter((d, i) => opts.all || i < (opts.recent ?? 0) || !rows.has(d.drawNo));
  let changed = 0;
  let failed = 0;
  for (const d of todo) {
    try {
      const table = parseNlbPrizeTable(await getPage(`https://www.nlb.lk/results/${lottery.source_key}/${d.drawNo}`, opts));
      const tier = table && jackpotTier(table);
      if (!tier) {
        failed++;
        // an older draw page without a table is permanent (NLB only serves its latest ~208 draws):
        // keep a null row so the daily run stops asking for it
        if (!newest.has(d.drawNo) && !rows.has(d.drawNo)) {
          rows.set(d.drawNo, { drawNo: d.drawNo, date: d.date, superPrizeAmount: null, superPrizeWinners: null, tier: "none" });
          changed++;
        }
        continue;
      }
      rows.set(d.drawNo, {
        drawNo: d.drawNo,
        date: table.date,
        superPrizeAmount: tier.prize,
        superPrizeWinners: tier.winners,
        tier: tier.name,
      });
      changed++;
    } catch (err) {
      failed++;
      opts.log?.(`  ${lottery.id} #${d.drawNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (changed) writePrizes(opts, lottery.id, [...rows.values()]);
  opts.log?.(`prizes ${lottery.id}: ${changed} rows from ${todo.length} pages (${failed} without a table)`);
  return changed;
}

/** NLB winners directory: Super Prize cards per lottery (page 1 only, or every month page with `allMonths`). */
export async function readWinnersDirectory(opts: SourceOptions & { allMonths?: boolean }): Promise<Directory> {
  const byName = new Map(LOTTERIES.filter((l) => l.board === "NLB").map((l) => [l.name.toLowerCase(), l.id]));
  const out: Directory = {};
  const add = (html: string, label: string) => {
    for (const w of parseNlbWinnersDirectory(html).filter(isSuperPrizeListing)) {
      const id = byName.get(w.lotteryName.toLowerCase());
      if (!id) continue;
      const m = (out[id] ??= new Map());
      const entry = m.get(w.drawNo) ?? { listedIn: [], date: null };
      if (!entry.listedIn.includes(label)) entry.listedIn.push(label);
      m.set(w.drawNo, entry);
    }
  };
  const latest = await getPage(NLB_WINNERS, opts);
  add(latest, "latest");
  if (opts.allMonths) {
    for (const month of parseNlbWinnersMonths(latest)) {
      try {
        add(await getPage(`${NLB_WINNERS}/${month}`, opts), month.replace("/", "-"));
      } catch (err) {
        opts.log?.(`  winners ${month}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return out;
}

/**
 * DLB: from the home page "NEXT JACKPOT" column, record the jackpot at stake in each lottery's next draw
 * (row drawNo = shown drawNo + 1, date null until drawn, winners unknown). Newest observation wins.
 */
export async function snapshotDlbJackpots(opts: SourceOptions): Promise<number> {
  const next = parseDlbNextJackpots(await getPage(DLB_HOME, opts));
  let changed = 0;
  for (const lottery of LOTTERIES.filter((l) => l.board === "DLB")) {
    const box = next[lottery.name];
    if (!box) continue;
    const drawNo = box.drawNo + 1;
    const all = readPrizes(opts, lottery.id);
    if (all.find((r) => r.drawNo === drawNo)?.superPrizeAmount === box.nextJackpot) continue;
    const rows = all.filter((r) => r.drawNo !== drawNo);
    rows.push({ drawNo, date: null, superPrizeAmount: box.nextJackpot, superPrizeWinners: null, tier: "advertised" });
    writePrizes(opts, lottery.id, rows);
    changed++;
  }
  opts.log?.(`dlb next jackpots: ${Object.keys(next).length} on the page, ${changed} snapshots written`);
  return changed;
}

/** Directory listings already stored in data/jackpots.json (old months are not refetched daily). */
function storedDirectory(opts: SourceOptions): Directory {
  const out: Directory = {};
  for (const j of readJson<Jackpot[]>(join(opts.dataDir, "jackpots.json"), [])) {
    if (!j.listedIn?.length) continue;
    (out[j.lotteryId] ??= new Map()).set(j.drawNo, { listedIn: [...j.listedIn], date: j.inDrawHistory ? null : j.date });
  }
  return out;
}

/**
 * Merge freshly read directory listings into the stored ones (or replace them), then look up the draw date of
 * fresh cards older than our archive on their (emptied) NLB per-draw page. Page failures leave the date null.
 */
export async function updateDirectory(
  opts: SourceOptions,
  fresh: Directory,
  { replace = false }: { replace?: boolean } = {},
): Promise<Directory> {
  const stored = storedDirectory(opts);
  const directory: Directory = replace ? {} : stored; // replace: `fresh` is the whole directory
  for (const [id, m] of Object.entries(fresh)) {
    const target = (directory[id] ??= new Map());
    for (const [drawNo, entry] of m) {
      const merged = target.get(drawNo) ?? { listedIn: [], date: stored[id]?.get(drawNo)?.date ?? null };
      for (const l of entry.listedIn) if (!merged.listedIn.includes(l)) merged.listedIn.push(l);
      // "latest" only matters until the card shows up on a month page
      if (merged.listedIn.length > 1) merged.listedIn = merged.listedIn.filter((l) => l !== "latest").sort().reverse();
      target.set(drawNo, merged);
    }
  }
  let dated = 0;
  for (const [id, m] of Object.entries(fresh)) {
    const lottery = LOTTERIES.find((l) => l.id === id)!;
    const archived = new Set(drawsOf(opts, id).map((d) => d.drawNo));
    for (const drawNo of m.keys()) {
      const entry = directory[id].get(drawNo)!;
      if (entry.date || archived.has(drawNo)) continue;
      try {
        const page = parseNlbDrawPageDate(await getPage(`https://www.nlb.lk/results/${lottery.source_key}/${drawNo}`, opts));
        if (page?.drawNo === drawNo) {
          entry.date = page.date;
          dated++;
        }
      } catch (err) {
        opts.log?.(`  ${id} #${drawNo} date: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  const total = Object.values(directory).reduce((n, m) => n + m.size, 0);
  opts.log?.(`winners directory: ${total} Super Prize cards for our lotteries, ${dated} dates looked up`);
  return directory;
}

/** Rebuild data/jackpots.json from data/prizes, the directory listings (default: stored) and data/draws. */
export function writeJackpots(opts: SourceOptions, directory: Directory = storedDirectory(opts)): Jackpot[] {
  const path = join(opts.dataDir, "jackpots.json");
  const prizes: Record<string, PrizeRow[]> = {};
  const dlbSnapshots: Record<string, PrizeRow[]> = {};
  const draws: Record<string, DrawSummary[]> = {};
  for (const l of LOTTERIES) {
    (l.board === "NLB" ? prizes : dlbSnapshots)[l.id] = readPrizes(opts, l.id);
    draws[l.id] = drawsOf(opts, l.id);
  }
  const jackpots = buildJackpots({ prizes, directory, dlbSnapshots, draws });
  writeAtomic(path, linesText(jackpots));
  return jackpots;
}

/** Write docs/JACKPOT-WINS.md next to the data dir (project root/docs). */
export function writeJackpotDoc(opts: SourceOptions, jackpots: Jackpot[], docPath: string) {
  const lotteries = LOTTERIES.map((l) => {
    const draws = drawsOf(opts, l.id);
    return {
      id: l.id,
      name: l.name,
      board: l.board,
      prizes: readPrizes(opts, l.id),
      firstDate: draws.at(-1)?.date ?? null,
      lastDate: draws[0]?.date ?? null,
    };
  });
  writeAtomic(docPath, renderJackpotDoc(jackpots, lotteries) + "\n");
}
