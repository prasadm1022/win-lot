// SPDX-License-Identifier: Apache-2.0
// Build-time data access for the static Next.js site. Reads data/*.json with fs (server only)
// and computes stats/predictions deterministically from the committed draw history.
// Jackpot wins (data/jackpots.json, data/prizes/<id>.json) mark their draws and feed the jackpot status
// of docs/MODEL-V2.md section 3. The predictions (v2 published, v1 as the previous model) are computed once per
// build and cached in .cache/predictions.json (docs/MODEL-V2.md section 4, "Compute once per build").

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { suspiciousAmounts, type Jackpot, type PrizeRow } from "./jackpots";
import { LOTTERIES, LOTTERY_BY_ID, LOTTERY_META, type Board, type Lottery as LotteryConfig } from "./lotteries";
import { MODEL_VERSION, nextDrawDate, predict } from "./model";
import { MODEL_VERSION_V2, V2_CONSTANTS } from "./model-v2/constants";
import { knownFrom, usableAt } from "./model-v2/evidence";
import { predictAllV2, type V2Input } from "./model-v2/index";
import type { Draw } from "./parsers";
import { computeStats } from "./stats";
import type {
  DrawSummary,
  FetchRun,
  JackpotStatus,
  JackpotWin,
  Lottery,
  Prediction,
  Stats,
  StatsWindow,
  Status,
} from "./types";

export type StatusInfo = Status;

const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "data");
const WINDOWS: StatsWindow[] = ["all", "500", "100"];

export const LOTTERY_IDS: string[] = LOTTERIES.map((l) => l.id);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

function memo<T>(fn: (id: string) => T): (id: string) => T {
  const cache = new Map<string, T>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, fn(id));
    return cache.get(id)!;
  };
}

function config(id: string): LotteryConfig {
  const l = LOTTERY_BY_ID[id];
  if (!l) throw new Error(`unknown lottery: ${id}`);
  return l;
}

let jackpotItems: Jackpot[] | null = null;
/** data/jackpots.json: the known jackpot wins of all lotteries, from every source. */
function getJackpotItems(): Jackpot[] {
  return (jackpotItems ??= readJson<Jackpot[]>("jackpots.json", []));
}

/** This lottery's own jackpot items only: another lottery's (or board's) jackpot is never used or shown. */
const ownJackpots = memo((id: string): Jackpot[] => getJackpotItems().filter((j) => j.lotteryId === id));

/** data/prizes/<id>.json: NLB per-draw jackpot rows, or DLB advertised next-draw jackpots. */
const getPrizeRows = memo((id: string): PrizeRow[] => readJson<PrizeRow[]>(`prizes/${id}.json`, []));

/**
 * A draw whose jackpot was won also carries `jackpot` (the lottery's own in-archive items, joined on drawNo). The
 * flag is a fact, so it is not gated by knownFrom; every other draw is returned exactly as given. Pure.
 */
export function markJackpotDraws(draws: DrawSummary[], ownItems: readonly Jackpot[]): DrawSummary[] {
  const won = new Map(ownItems.filter((j) => j.inDrawHistory).map((j): [number, Jackpot] => [j.drawNo, j]));
  if (!won.size) return draws;
  return draws.map((d) => {
    const j = won.get(d.drawNo);
    return j ? { ...d, jackpot: { winners: j.jackpotWinners, amount: j.superPrizeAmount, source: j.source } } : d;
  });
}

/**
 * Newest first, full history, with the jackpot flags of markJackpotDraws (own items of data/jackpots.json).
 * modelDraws ignores the flag, so the v1 model is unaffected.
 */
export const getDraws = memo((id: string): DrawSummary[] => {
  config(id);
  return markJackpotDraws(readJson<DrawSummary[]>(`draws/${id}.json`, []), ownJackpots(id));
});

/** Oldest first, internal (model/stats) shape. */
const modelDraws = memo((id: string): Draw[] =>
  getDraws(id)
    .slice()
    .reverse()
    .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null })),
);

let fetchLog: FetchRun[] | null = null;
function getFetchLog(): FetchRun[] {
  return (fetchLog ??= readJson<FetchRun[]>("fetch-log.json", []));
}

export function getLotteries(): Lottery[] {
  return LOTTERY_META.map((m) => {
    const draws = getDraws(m.id);
    return {
      id: m.id,
      name: m.name,
      board: m.board,
      letterKind: m.letterKind,
      mainCount: m.mainCount,
      mainMin: m.mainMin,
      mainMax: m.mainMax,
      hasBonus: m.hasBonus,
      bonusLabel: m.bonusLabel,
      drawCount: draws.length,
      firstDate: draws.length ? draws[draws.length - 1].date : "",
      lastDraw: draws[0] ?? null,
    };
  });
}

export function getLottery(id: string): Lottery | null {
  return getLotteries().find((l) => l.id === id) ?? null;
}

const statsCache = new Map<string, Stats>();
export function getStats(id: string, window: StatsWindow): Stats {
  const key = `${id}:${window}`;
  if (!statsCache.has(key)) {
    const w: StatsWindow = WINDOWS.includes(window) ? window : "all";
    const all = modelDraws(id);
    const draws = w === "all" ? all : all.slice(-Number(w));
    // Same payload as the former /api/.../stats (lastSeenDrawsAgo is null for never-drawn numbers).
    statsCache.set(key, computeStats(config(id), draws, w) as unknown as Stats);
  }
  return statsCache.get(key)!;
}

/**
 * generatedAt: run_at of the newest successful fetch that inserted draws for this lottery,
 * else the newest draw date at 00:00Z. The picks themselves depend only on the draw history.
 */
function generatedAt(id: string, newest: DrawSummary): string {
  const run = getFetchLog().find((r) => r.lottery_id === id && r.status === "ok" && r.inserted > 0);
  return run?.run_at ?? `${newest.date}T00:00:00Z`;
}

// ---- Predictions, computed once per build (docs/MODEL-V2.md section 4) ----
// The v2 walk-forward backtest needs all lotteries at once (pooled result, Holm) and takes a few seconds, so the
// prebuild (scripts/export-public.ts) computes v1 and v2 once and writes .cache/predictions.json; every `next build`
// worker then only reads it. The key covers every input, so stale picks are never served: any change to the data,
// the constants or the model code is a cache miss and a fresh computation.

/** v1 and v2 predictions of every lottery with draws (gitignored; safe to delete at any time). */
export const PREDICTIONS_CACHE_FILE = join(ROOT, ".cache", "predictions.json");

/** The content of .cache/predictions.json, keyed by lottery id in LOTTERY_IDS order. */
export interface PredictionsCache {
  /** predictionsKey() of the inputs these predictions were computed from. */
  key: string;
  /** Previous model, win-lot-heuristic-v1 (lib/model.ts), shown only in the comparison and the details view. */
  v1: Record<string, Prediction>;
  /** Published model, win-lot-jackpot-v2 (lib/model-v2). */
  v2: Record<string, Prediction>;
}

/** One labelled input of the cache key: a constant, a data file or a source file, with its exact bytes. */
export type KeyInput = readonly [name: string, bytes: string | Uint8Array];

/** A project file's exact bytes, or a marker when it does not exist (so creating the file changes the key too). */
function projectFileBytes(path: string): string | Uint8Array {
  try {
    return readFileSync(join(ROOT, path));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "\u0000missing";
    throw err;
  }
}

/**
 * Everything the predictions depend on, in a fixed order: both model versions, the frozen V2_CONSTANTS, the data
 * files the models read (lotteries, jackpots, the fetch log behind generatedAt, then every lottery's draws in id
 * order) and the code that turns them into predictions (this file and lib/lotteries.ts build the model inputs;
 * lib/model.ts and lib/model-v2/*.ts in plain code-unit order), so a code change invalidates the cache too.
 */
export function predictionsKeyInputs(): KeyInput[] {
  const modelV2 = readdirSync(join(ROOT, "lib", "model-v2"))
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => `lib/model-v2/${f}`);
  const files = [
    "data/lotteries.json",
    "data/jackpots.json",
    "data/fetch-log.json",
    ...LOTTERY_IDS.map((id) => `data/draws/${id}.json`),
    "lib/data.ts",
    "lib/lotteries.ts",
    "lib/model.ts",
    ...modelV2,
  ];
  return [
    ["MODEL_VERSION_V2", MODEL_VERSION_V2],
    ["V2_CONSTANTS", JSON.stringify(V2_CONSTANTS)],
    ["MODEL_VERSION", MODEL_VERSION],
    ...files.map((f): KeyInput => [f, projectFileBytes(f)]),
  ];
}

/** sha256 (hex) over the inputs. Each is framed by its name and byte length, so two inputs can never run together. */
export function predictionsKey(inputs: readonly KeyInput[]): string {
  const hash = createHash("sha256");
  for (const [name, bytes] of inputs) {
    const data = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
    hash.update(`${name}\u0000${data.byteLength}\u0000`);
    hash.update(data);
  }
  return hash.digest("hex");
}

/**
 * The cached predictions if `file` holds them for exactly this key, with both models for every lottery that has
 * draws; else null. A missing, unreadable or partly written file is a miss, never an error.
 */
export function readPredictionsCache(key: string, file = PREDICTIONS_CACHE_FILE): PredictionsCache | null {
  let cache: Partial<PredictionsCache> | null;
  try {
    cache = JSON.parse(readFileSync(file, "utf8")) as Partial<PredictionsCache> | null;
  } catch {
    return null;
  }
  if (cache === null || typeof cache !== "object" || cache.key !== key) return null;
  const { v1, v2 } = cache;
  if (!v1 || !v2) return null;
  const has = (byId: Record<string, Prediction>, id: string, version: string) =>
    Object.hasOwn(byId, id) && byId[id]?.modelVersion === version;
  const complete = LOTTERY_IDS.every(
    (id) => !getDraws(id).length || (has(v1, id, MODEL_VERSION) && has(v2, id, MODEL_VERSION_V2)),
  );
  return complete ? (cache as PredictionsCache) : null;
}

/** Writes the cache for the `next build` workers (scripts/export-public.ts, once per build). */
export function writePredictionsCache(cache: PredictionsCache, file = PREDICTIONS_CACHE_FILE): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cache));
}

/** v1 and v2 for every lottery with draws; v2 receives the same draws, generatedAt and v1 output. */
function computePredictions(key: string): PredictionsCache {
  const v1: Record<string, Prediction> = {};
  const inputs: V2Input[] = [];
  for (const id of LOTTERY_IDS) {
    const draws = modelDraws(id);
    if (!draws.length) continue;
    const lottery = config(id);
    const at = generatedAt(id, getDraws(id)[0]);
    v1[id] = predict(lottery, draws, at) as Prediction;
    inputs.push({ lottery, draws, jackpots: getJackpotItems(), generatedAt: at, v1: v1[id] });
  }
  const v2 = inputs.length ? predictAllV2(inputs) : {};
  // The JSON round trip makes a computed result identical to a cache hit (plain data, no undefined-valued keys).
  return JSON.parse(JSON.stringify({ key, v1, v2 })) as PredictionsCache;
}

let predictions: PredictionsCache | null = null;

/**
 * v1 and v2 predictions of every lottery with draws, once per process: read from .cache/predictions.json when its
 * key matches the current inputs (silently), else computed, logging "model-v2: cache miss, computing" once. The
 * prebuild computes and writes the cache, so `next build` workers only read it; `next dev` computes on first use.
 */
export function getPredictions(): PredictionsCache {
  if (predictions) return predictions;
  const key = predictionsKey(predictionsKeyInputs());
  const cached = readPredictionsCache(key);
  if (cached) return (predictions = cached);
  console.log("model-v2: cache miss, computing");
  return (predictions = computePredictions(key));
}

function predictionOf(byId: Record<string, Prediction>, id: string): Prediction {
  config(id);
  if (!Object.hasOwn(byId, id)) throw new Error(`no draws for lottery: ${id}`);
  return byId[id];
}

/** The published picks for the next draw: model v2, win-lot-jackpot-v2. Throws for a lottery without draws. */
export function getPrediction(id: string): Prediction {
  return predictionOf(getPredictions().v2, id);
}

/**
 * The previous model, win-lot-heuristic-v1 (lib/model.ts, unchanged), over the same draws. Shown only in the
 * comparison and the details view (decision D6); v2 also carries its sets as `previousModel`.
 */
export function getPredictionV1(id: string): Prediction {
  return predictionOf(getPredictions().v1, id);
}

export function getStatus(): StatusInfo {
  const runs = getFetchLog();
  return { lastRun: runs[0]?.run_at ?? null, runs };
}

// ---- Jackpot wins and status (docs/MODEL-V2.md sections 3.2 and 7.2) ----
// Facts and counts only, never a chance per draw. Winner names and towns are not in the data. Amounts are shown as
// published; the model never reads them.

/** The rule of lib/jackpots.ts inferJackpotResets: draw K won when the jackpots of K+1 and K+2 are both below K's. */
export const DLB_NOTE =
  "DLB does not publish a winners list. We infer a win when the advertised jackpot falls and is still below its old " +
  "amount one draw later, so wins appear two draws late and without a winners count.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-27" -> "27 Mar 2026" (fixed English, independent of the build machine's locale). */
function plainDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** 8896221 -> "Rs. 8,896,221", 56553566.4 -> "Rs. 56,553,566.40" (locale independent). */
function rupees(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split(".");
  return `Rs. ${whole.replace(/\B(?=(\d{3})+$)/g, ",")}${cents === "00" ? "" : `.${cents}`}`;
}

/** 88618385 -> "Rs. 88.6 M". */
const millions = (amount: number) => `Rs. ${(amount / 1e6).toFixed(1)} M`;

/** Whole days from one ISO date to a later one (UTC midnights, so no daylight-saving effects). */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** The row with the highest draw number, or null. */
const newestRow = (rows: PrizeRow[]) =>
  rows.reduce<PrizeRow | null>((best, r) => (best === null || r.drawNo > best.drawNo ? r : best), null);

/** One data/jackpots.json item as listed for the UI; `target` is the date of the draw the picks are for. */
function toWin(j: Jackpot, draws: DrawSummary[], target: string | null): JackpotWin {
  const known = knownFrom(j, draws);
  const usedAs: JackpotWin["usedAs"] =
    target === null || !usableAt(known, target) ? [] : j.numbers !== null ? ["combination", "date"] : ["date"];
  return {
    drawNo: j.drawNo,
    date: j.date,
    letter: j.letter,
    numbers: j.numbers,
    bonus: j.bonus ?? null,
    winners: j.jackpotWinners,
    amount: j.superPrizeAmount,
    source: j.source,
    inArchive: j.inDrawHistory,
    ...(j.listedIn ? { listedIn: j.listedIn } : {}),
    knownFrom: known,
    usedAs,
  };
}

/**
 * Every known jackpot win of a lottery, newest first: all sources, including undated wins and wins older than our
 * archive. knownFrom is the shared publication rule (lib/model-v2/evidence.ts). usedAs is how the v2 picks use the win
 * for the next draw (the same nextDrawDate as the prediction): only once it was known strictly before that date.
 * Pure: `draws` newest first, `ownItems` the lottery's own data/jackpots.json items.
 */
export function jackpotWinsOf(draws: DrawSummary[], ownItems: readonly Jackpot[]): JackpotWin[] {
  const target = draws.length ? nextDrawDate(draws.map((d) => d.date).reverse()) : null;
  return ownItems
    .slice()
    .sort((a, b) => b.drawNo - a.drawNo)
    .map((j) => toWin(j, draws, target));
}

/** jackpotWinsOf for one lottery of data/ (memoised: one array per process). */
export const getJackpots = memo((id: string): JackpotWin[] => jackpotWinsOf(getDraws(id), ownJackpots(id)));

/** NLB: the jackpot at the newest draw with a published amount. DLB: the newest advertised next-draw jackpot. */
function currentJackpot(board: Board, rows: PrizeRow[]): JackpotStatus["current"] {
  const priced = rows.filter((r) => r.superPrizeAmount !== null && (board === "NLB" || r.tier === "advertised"));
  const row = newestRow(priced);
  if (!row) return null;
  const kind = board === "NLB" ? "last-draw" : "advertised-next";
  return { amount: row.superPrizeAmount!, drawNo: row.drawNo, date: row.date, kind };
}

/**
 * Jackpot outcome of the newest archived draw. "not-won" only from an NLB prize row that shows 0 winners; DLB never
 * publishes winners (a win is inferred two draws late), so the newest DLB draw is "won" only if already marked.
 */
function latestOutcome(board: Board, latest: DrawSummary | undefined, rows: PrizeRow[]): JackpotStatus["latestDraw"] {
  if (!latest) return null;
  const row = board === "NLB" ? rows.find((r) => r.drawNo === latest.drawNo && r.superPrizeWinners !== null) : undefined;
  const outcome =
    latest.jackpot || (row && row.superPrizeWinners! > 0) ? "won" : row && row.superPrizeWinners === 0 ? "not-won" : "unknown";
  return { drawNo: latest.drawNo, date: latest.date, outcome };
}

/** NLB rows with a known winners count: the draws we could check one by one (a base rate as counts only). */
function checkedDraws(rows: PrizeRow[]): NonNullable<JackpotStatus["checked"]> {
  const asc = rows.filter((r) => r.superPrizeWinners !== null).sort((a, b) => a.drawNo - b.drawNo);
  return {
    draws: asc.length,
    wins: asc.filter((r) => r.superPrizeWinners! > 0).length,
    from: asc[0]?.date ?? null,
    to: asc.at(-1)?.date ?? null,
  };
}

/** Plain-language notes: the DLB inference lag, wins without numbers or dates, known typos in NLB amounts. */
function jackpotNotes(board: Board, wins: JackpotWin[], draws: DrawSummary[], rows: PrizeRow[]): string[] {
  const notes = board === "DLB" ? [DLB_NOTE] : [];
  const first = draws.at(-1);
  const older = first ? wins.filter((w) => !w.inArchive && w.drawNo < first.drawNo) : [];
  if (first && older.length) {
    const one = older.length === 1;
    const which =
      older.length < wins.length
        ? `${older.length} of the ${wins.length} known jackpot wins ${one ? "is" : "are"}`
        : one
          ? "The only known jackpot win is"
          : `All ${wins.length} known jackpot wins are`;
    notes.push(
      `${which} older than our draw archive (it starts on ${plainDate(first.date)}), ` +
        `so ${one ? "its" : "their"} winning numbers are not known.`,
    );
  }
  const undated = wins.filter((w) => w.date === null).length;
  if (undated === 1) notes.push("1 win has no known date, so the picks do not use it.");
  else if (undated > 1) notes.push(`${undated} wins have no known date, so the picks do not use them.`);
  if (board === "NLB") {
    const asc = rows.filter((r) => r.superPrizeAmount !== null).sort((a, b) => a.drawNo - b.drawNo);
    for (const r of suspiciousAmounts(rows)) {
      // suspiciousAmounts only flags a row with a published amount on both sides
      const i = asc.findIndex((x) => x.drawNo === r.drawNo);
      const [before, after] = [asc[i - 1], asc[i + 1]].map((x) => millions(x.superPrizeAmount!));
      const when = r.date ? ` (${plainDate(r.date)})` : "";
      notes.push(
        `Draw ${r.drawNo}${when}: NLB publishes a jackpot of ${rupees(r.superPrizeAmount!)}, an obvious typo ` +
          `(${before} the draw before, ${after} the draw after). It is shown as published; the picks never use ` +
          "jackpot amounts.",
      );
    }
  }
  return notes;
}

/** Everything one lottery's jackpot status is computed from (data/ in getJackpotStatus; a frozen snapshot in tests). */
export interface JackpotStatusInput {
  lotteryId: string;
  board: Board;
  /** Newest first, with the jackpot flags of markJackpotDraws. */
  draws: DrawSummary[];
  /** data/prizes/<id>.json: NLB per-draw jackpot rows, or DLB advertised next-draw jackpots. */
  rows: PrizeRow[];
  /** The lottery's own data/jackpots.json items. */
  ownItems: readonly Jackpot[];
  /** jackpotWinsOf(draws, ownItems), when already computed. */
  wins?: JackpotWin[];
}

/**
 * Jackpot wins, the current jackpot and plain notes for one lottery (docs/MODEL-V2.md 3.2). Draw numbers are
 * consecutive, so drawsSinceLastWin is a difference of draw numbers; both "since" values count up to the newest
 * archived draw. Pure.
 */
export function jackpotStatusOf(x: JackpotStatusInput): JackpotStatus {
  const { board, draws, rows } = x;
  const wins = x.wins ?? jackpotWinsOf(draws, x.ownItems);
  const latest = draws.at(0);
  const last = wins.at(0);
  return {
    lotteryId: x.lotteryId,
    wins,
    lastWin: last ? { drawNo: last.drawNo, date: last.date, inArchive: last.inArchive } : null,
    drawsSinceLastWin: last && latest ? latest.drawNo - last.drawNo : null,
    daysSinceLastWin: last?.date && latest ? daysBetween(last.date, latest.date) : null,
    current: currentJackpot(board, rows),
    latestDraw: latestOutcome(board, latest, rows),
    checked: board === "NLB" ? checkedDraws(rows) : null,
    notes: jackpotNotes(board, wins, draws, rows),
  };
}

/** jackpotStatusOf for one lottery of data/ (memoised; its wins are getJackpots(id)). */
export const getJackpotStatus = memo((id: string): JackpotStatus =>
  jackpotStatusOf({
    lotteryId: id,
    board: config(id).board,
    draws: getDraws(id),
    rows: getPrizeRows(id),
    ownItems: ownJackpots(id),
    wins: getJackpots(id),
  }),
);
