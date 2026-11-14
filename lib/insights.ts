// SPDX-License-Identifier: Apache-2.0
// Pure, build-time summaries behind the results archive (/l/<id>/results), the lottery guide section and the /guides
// articles. Facts and counts only, computed from the committed data that lib/data.ts reads: no fs, no clock, no
// randomness, and never a chance per draw for a pick. Every statistical sentence on those pages prints a value from here
// (lesson L11), and test/insights.test.ts checks the rules on synthetic draws without pinning live counts (lesson L12).

import type { PrizeRow } from "./jackpots";
import type { Board, DrawSummary, JackpotSource, JackpotStatus } from "./types";

const DAY_MS = 86_400_000;
const toDay = (iso: string): number => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
const fromDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
/** 0 = Sunday ... 6 = Saturday, in UTC (draw dates are calendar days). */
export const weekdayOf = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** Newest first by draw number (the order of data/draws/<id>.json), without mutating the input. */
const newestFirst = <T extends { drawNo: number }>(draws: readonly T[]): T[] => [...draws].sort((a, b) => b.drawNo - a.drawNo);

// ---------- Results archive ----------

/** The jackpot outcome of one archived draw, only as far as the data knows it. */
export type JackpotOutcome =
  | { kind: "won"; winners: number | null; amount: number | null; inferred: boolean }
  /** NLB only: the prize table shows 0 winners, so the jackpot rolled over. Never set for DLB. */
  | { kind: "not-won"; amount: number | null }
  | { kind: "unknown"; amount: number | null };

export interface ResultRow {
  drawNo: number;
  date: string;
  letter: string | null;
  numbers: number[];
  bonus: unknown | null;
  jackpot: JackpotOutcome;
}

/**
 * One row per archived draw, newest first. "won": the draw is marked (data/jackpots.json) or its NLB prize row shows
 * winners; "not-won" only from an NLB prize row with 0 winners (the rule of getJackpotStatus); everything else is
 * "unknown", which is every unmarked DLB draw. The amount is the NLB jackpot as published for that draw.
 */
export function resultRows(board: Board, draws: readonly DrawSummary[], rows: readonly PrizeRow[]): ResultRow[] {
  const prize = new Map<number, PrizeRow>();
  if (board === "NLB") for (const r of rows) if (r.tier !== "advertised") prize.set(r.drawNo, r);
  return newestFirst(draws).map((d) => {
    const row = prize.get(d.drawNo);
    const amount = row?.superPrizeAmount ?? null;
    const winners = row?.superPrizeWinners ?? null;
    let jackpot: JackpotOutcome;
    if (d.jackpot) {
      jackpot = {
        kind: "won",
        winners: d.jackpot.winners ?? winners,
        amount: d.jackpot.amount ?? amount,
        inferred: d.jackpot.source === "dlb-jackpot-reset",
      };
    } else if (winners !== null && winners > 0) jackpot = { kind: "won", winners, amount, inferred: false };
    else if (board === "NLB" && winners === 0) jackpot = { kind: "not-won", amount };
    else jackpot = { kind: "unknown", amount };
    return { drawNo: d.drawNo, date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null, jackpot };
  });
}

/** Rows grouped by calendar year, newest year first; each group keeps the input order (newest draw first). */
export function groupByYear<T extends { date: string }>(rows: readonly T[]): { year: number; rows: T[] }[] {
  const byYear = new Map<number, T[]>();
  for (const r of rows) {
    const y = Number(r.date.slice(0, 4));
    const list = byYear.get(y);
    if (list) list.push(r);
    else byYear.set(y, [r]);
  }
  return [...byYear.keys()].sort((a, b) => b - a).map((year) => ({ year, rows: byYear.get(year)! }));
}

/** How often each kind of jackpot outcome appears among the rows (for the archive's summary line). */
export function outcomeCounts(rows: readonly ResultRow[]): { won: number; notWon: number; unknown: number } {
  let won = 0;
  let notWon = 0;
  for (const r of rows) {
    if (r.jackpot.kind === "won") won++;
    else if (r.jackpot.kind === "not-won") notWon++;
  }
  return { won, notWon, unknown: rows.length - won - notWon };
}

// ---------- Draw schedule ----------

export interface DrawBreak {
  from: string;
  to: string;
  days: number;
}

export interface Schedule {
  /** First and last day of the window (the window ends on the newest draw). */
  from: string;
  to: string;
  /** Calendar days in the window. */
  days: number;
  /** Draws held in the window. */
  draws: number;
  /** Draws per weekday in the window, 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** Days in the window without a draw. */
  daysWithout: number;
  /** Runs of consecutive days without a draw, oldest first. */
  breaks: DrawBreak[];
}

/** Runs of missing days between the first and last day (inclusive), from a set of draw days. */
function breaksBetween(first: number, last: number, drawn: ReadonlySet<number>): DrawBreak[] {
  const out: DrawBreak[] = [];
  let start: number | null = null;
  for (let day = first; day <= last + 1; day++) {
    const missing = day <= last && !drawn.has(day);
    if (missing && start === null) start = day;
    if (!missing && start !== null) {
      out.push({ from: fromDay(start), to: fromDay(day - 1), days: day - start });
      start = null;
    }
  }
  return out;
}

/**
 * When a lottery draws: the last `days` calendar days up to its newest draw (or the whole archive when shorter). Draw
 * dates are calendar days; the weekday counts and the breaks come straight from them. Null without draws.
 */
export function drawSchedule(dates: readonly string[], days = 364): Schedule | null {
  if (!dates.length) return null;
  const all = [...new Set(dates.map(toDay))].sort((a, b) => a - b);
  const last = all[all.length - 1];
  const first = Math.max(all[0], last - days + 1);
  const inWindow = all.filter((d) => d >= first);
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  for (const d of inWindow) weekdays[weekdayOf(fromDay(d))]++;
  const span = last - first + 1;
  return {
    from: fromDay(first),
    to: fromDay(last),
    days: span,
    draws: inWindow.length,
    weekdays,
    daysWithout: span - inWindow.length,
    breaks: breaksBetween(first, last, new Set(inWindow)),
  };
}

/** The longest break (the earliest of equally long ones), or null. */
export function longestBreak(breaks: readonly DrawBreak[]): DrawBreak | null {
  return breaks.reduce<DrawBreak | null>((best, b) => (best === null || b.days > best.days ? b : best), null);
}

// ---------- Bonus ----------

export interface BonusSummary {
  /** Draws that carry a bonus. */
  draws: number;
  first: string;
  last: string;
  /** Weekdays (0 = Sunday) the bonus was drawn on, ascending. */
  weekdays: number[];
  /** Smallest and largest bonus seen (a number bonus), or null for a digits bonus. */
  min: number | null;
  max: number | null;
  /** A structured bonus of single digits (Dhana Nidhanaya's Sunday Bonus), with its digit count. */
  digits: number | null;
}

const bonusDigits = (b: unknown): number[] | null =>
  b && typeof b === "object" && Array.isArray((b as { digits?: unknown }).digits) ? ((b as { digits: number[] }).digits) : null;

/** What the archive shows about a lottery's bonus draw, or null when no draw carries one. */
export function bonusSummary(draws: readonly DrawSummary[]): BonusSummary | null {
  const withBonus = newestFirst(draws).filter((d) => d.bonus !== null && d.bonus !== undefined);
  if (!withBonus.length) return null;
  const numeric = withBonus.map((d) => d.bonus).filter((b): b is number => typeof b === "number");
  const digits = withBonus.map((d) => bonusDigits(d.bonus)).find((x) => x !== null) ?? null;
  return {
    draws: withBonus.length,
    first: withBonus[withBonus.length - 1].date,
    last: withBonus[0].date,
    weekdays: [...new Set(withBonus.map((d) => weekdayOf(d.date)))].sort((a, b) => a - b),
    min: numeric.length ? Math.min(...numeric) : null,
    max: numeric.length ? Math.max(...numeric) : null,
    digits: digits ? digits.length : null,
  };
}

/** Letters that have come up, ascending, and how many draws carry one. */
export function letterSummary(draws: readonly DrawSummary[]): { letters: string[]; draws: number } {
  const letters = draws.map((d) => d.letter).filter((l): l is string => Boolean(l));
  return { letters: [...new Set(letters)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), draws: letters.length };
}

const ascending = (d: DrawSummary): boolean => d.numbers.every((n, i) => i === 0 || d.numbers[i - 1] < n);

/** True when every draw lists its numbers in ascending order. */
export const numbersAscending = (draws: readonly DrawSummary[]): boolean => draws.every(ascending);

/** Draws whose numbers are listed in ascending order. */
export const ascendingCount = (draws: readonly DrawSummary[]): number => draws.filter(ascending).length;

/** From one archived draw to the next (by date order): how many steps there are and how many raise the number by one. */
export function drawNoSteps(draws: readonly DrawSummary[]): { steps: number; byOne: number } {
  const asc = newestFirst(draws).reverse();
  let byOne = 0;
  for (let i = 1; i < asc.length; i++) if (asc[i].drawNo - asc[i - 1].drawNo === 1) byOne++;
  return { steps: Math.max(0, asc.length - 1), byOne };
}

// ---------- Numbers in use, frequency and gaps ----------

/** Draws after which a ball that has not come out is treated as no longer in the machine (as on the lottery pages). */
export const RETIRED_AFTER = 270;

/**
 * The numbers still in use: every number of the printed range that came out in the newest `window` draws. With a
 * shorter archive than that, every number of the range counts as in use.
 */
export function liveNumbers(draws: readonly DrawSummary[], min: number, max: number, window = RETIRED_AFTER): number[] {
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  if (draws.length < window) return range;
  const seen = new Set(newestFirst(draws).slice(0, window).flatMap((d) => d.numbers));
  return range.filter((n) => seen.has(n));
}

export interface StableWindow {
  /** The draws since the ball set last changed, newest first (all draws when it never changed). */
  draws: DrawSummary[];
  /** The newest return of a number in use after at least RETIRED_AFTER draws away, or null. */
  change: { number: number; missed: number; date: string } | null;
}

/**
 * The draws since the newest return of a number in use that had been away for at least RETIRED_AFTER draws (a ball
 * taken out of the machine and put back). Counting from there compares like with like: every number in use was in the
 * machine for every draw counted.
 */
export function stableWindow(draws: readonly DrawSummary[], live: readonly number[]): StableWindow {
  const asc = newestFirst(draws).reverse();
  const liveSet = new Set(live);
  const lastSeen = new Map<number, number>();
  let start = 0;
  let change: StableWindow["change"] = null;
  asc.forEach((d, t) => {
    for (const n of d.numbers) {
      if (!liveSet.has(n)) continue;
      const at = lastSeen.get(n);
      if (at !== undefined && t - at - 1 >= RETIRED_AFTER) {
        start = t;
        change = { number: n, missed: t - at - 1, date: d.date };
      }
      lastSeen.set(n, t);
    }
  });
  return { draws: asc.slice(start).reverse(), change };
}

export interface FrequencySpread {
  draws: number;
  /** Numbers drawn per draw. */
  perDraw: number;
  /** Numbers in use. */
  live: number;
  /** Times each number in use would come out on average: draws * perDraw / live. */
  expected: number;
  /** Standard deviation of one number's count for fair draws (binomial, draws trials, perDraw / live each). */
  sd: number;
  min: { count: number; numbers: number[] };
  max: { count: number; numbers: number[] };
  /** Numbers whose count lies within expected +/- 1.96 sd (about 95 in 100 of them for fair draws). */
  inRange: number;
}

/** How far the count of each number in use spreads around its fair average. Null without draws. */
export function frequencySpread(draws: readonly DrawSummary[], live: readonly number[]): FrequencySpread | null {
  if (!draws.length || !live.length) return null;
  const counts = new Map<number, number>(live.map((n) => [n, 0]));
  for (const d of draws) for (const n of d.numbers) if (counts.has(n)) counts.set(n, counts.get(n)! + 1);
  const perDraw = draws[0].numbers.length;
  const p = perDraw / live.length;
  const expected = draws.length * p;
  const sd = Math.sqrt(draws.length * p * (1 - p));
  const values = [...counts.values()];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pick = (c: number) => live.filter((n) => counts.get(n) === c);
  return {
    draws: draws.length,
    perDraw,
    live: live.length,
    expected,
    sd,
    min: { count: lo, numbers: pick(lo) },
    max: { count: hi, numbers: pick(hi) },
    inRange: values.filter((c) => Math.abs(c - expected) <= 1.96 * sd).length,
  };
}

/** The `top` most frequent numbers in use, most frequent first; ties go to the smaller number. */
export function mostFrequent(draws: readonly DrawSummary[], live: readonly number[], top: number): number[] {
  const counts = new Map<number, number>(live.map((n) => [n, 0]));
  for (const d of draws) for (const n of d.numbers) if (counts.has(n)) counts.set(n, counts.get(n)! + 1);
  return [...live].sort((a, b) => counts.get(b)! - counts.get(a)! || a - b).slice(0, top);
}

export interface TopOverlap {
  top: number;
  /** Draws in the older and the newer half of the archive. */
  older: number;
  newer: number;
  /** How many of the older half's top numbers are also among the newer half's. */
  shared: number;
  /** What two random sets of `top` numbers would share on average: top * top / live. */
  chance: number;
  /** The variance of that count for two random sets (hypergeometric). */
  variance: number;
}

/** True when `shared` lies within the 95% range of luck (the 1.96 cut) around `chance`. */
export const overlapInRange = (shared: number, chance: number, variance: number): boolean =>
  Math.abs(shared - chance) <= 1.96 * Math.sqrt(variance);

/** Do the most frequent numbers of the older half of the archive stay the most frequent in the newer half? */
export function topOverlap(draws: readonly DrawSummary[], live: readonly number[], top = 10): TopOverlap | null {
  if (draws.length < 2 || live.length < top) return null;
  const asc = newestFirst(draws).reverse();
  const half = Math.floor(asc.length / 2);
  const older = asc.slice(0, half);
  const newer = asc.slice(half);
  const a = new Set(mostFrequent(older, live, top));
  const shared = mostFrequent(newer, live, top).filter((n) => a.has(n)).length;
  const L = live.length;
  const variance = L > 1 ? ((top * top) / L) * ((L - top) / L) * ((L - top) / (L - 1)) : 0;
  return { top, older: older.length, newer: newer.length, shared, chance: (top * top) / L, variance };
}

/** A group of "draws since a number last came out" for the gap check. */
export interface GapBucket {
  label: string;
  /** Inclusive lower and upper bound of the gap (draws since last seen; 1 = it came out in the draw before). */
  lo: number;
  hi: number;
}

export const GAP_BUCKETS: readonly GapBucket[] = [
  { label: "came out in the draw before", lo: 1, hi: 1 },
  { label: "last seen 2 to 10 draws earlier", lo: 2, hi: 10 },
  { label: "last seen 11 to 25 draws earlier", lo: 11, hi: 25 },
  { label: "last seen 26 to 50 draws earlier", lo: 26, hi: 50 },
  { label: "last seen more than 50 draws earlier", lo: 51, hi: Number.POSITIVE_INFINITY },
];

export interface GapTally {
  /** Number-draw pairs in the group: before each draw, every number in use that had come out at least once. */
  trials: number;
  /** How many of them came out in that draw. */
  hits: number;
  /** Sum over the trials of perDraw / live: the hits fair draws give on average. */
  expected: number;
  /** Sum over the trials of p * (1 - p): the variance of the hits for fair draws. */
  variance: number;
}

export interface GapLottery {
  draws: readonly DrawSummary[];
  live: readonly number[];
}

/**
 * The gap check: before every draw, each number in use is put in a group by how many draws ago it last came out, and we
 * count how often the numbers of each group came out in that draw. Fair draws do not remember, so every group should
 * land near perDraw / live. Pooled over the lotteries given; numbers not yet seen in a lottery's archive are skipped.
 */
export function gapCheck(lotteries: readonly GapLottery[], buckets: readonly GapBucket[] = GAP_BUCKETS): GapTally[] {
  const out: GapTally[] = buckets.map(() => ({ trials: 0, hits: 0, expected: 0, variance: 0 }));
  for (const { draws, live } of lotteries) {
    if (!live.length) continue;
    const asc = newestFirst(draws).reverse();
    const liveSet = new Set(live);
    const lastSeen = new Map<number, number>();
    asc.forEach((d, t) => {
      const p = d.numbers.length / live.length;
      const drawn = new Set(d.numbers);
      for (const [n, at] of lastSeen) {
        const gap = t - at;
        const b = buckets.findIndex((x) => gap >= x.lo && gap <= x.hi);
        if (b < 0) continue;
        out[b].trials++;
        out[b].expected += p;
        out[b].variance += p * (1 - p);
        if (drawn.has(n)) out[b].hits++;
      }
      for (const n of d.numbers) if (liveSet.has(n)) lastSeen.set(n, t);
    });
  }
  return out;
}

/** True when the group's hits lie within the 95% range of luck around its fair average (the 1.96 cut). */
export const gapInRange = (g: GapTally): boolean => g.trials > 0 && Math.abs(g.hits - g.expected) <= 1.96 * Math.sqrt(g.variance);

/** The longest run of draws a number in use went without coming out before it came out again. */
export function longestGap(draws: readonly DrawSummary[], live: readonly number[]): { number: number; draws: number; endedOn: string } | null {
  const asc = newestFirst(draws).reverse();
  const liveSet = new Set(live);
  const lastSeen = new Map<number, number>();
  let best: { number: number; draws: number; endedOn: string } | null = null;
  asc.forEach((d, t) => {
    for (const n of d.numbers) {
      if (!liveSet.has(n)) continue;
      const at = lastSeen.get(n);
      if (at !== undefined) {
        const missed = t - at - 1;
        if (best === null || missed > best.draws) best = { number: n, draws: missed, endedOn: d.date };
      }
      lastSeen.set(n, t);
    }
  });
  return best;
}

// ---------- Repeats from one draw to the next ----------

/** n choose k as a float (small arguments only). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Share of fair draws that repeat at least one number of the draw before: 1 - C(L - k, k) / C(L, k). */
export const repeatChance = (live: number, perDraw: number): number => 1 - choose(live - perDraw, perDraw) / choose(live, perDraw);

/**
 * Draws (among `draws`) that share at least one number with the draw right before them in the full archive `all`.
 * The first draw of the archive has nothing before it and is not counted.
 */
export function repeats(all: readonly DrawSummary[], draws: readonly DrawSummary[]): { draws: number; repeated: number } {
  const byNo = new Map(all.map((d) => [d.drawNo, d]));
  const asc = newestFirst(all).reverse();
  const before = new Map<number, DrawSummary>();
  for (let i = 1; i < asc.length; i++) before.set(asc[i].drawNo, asc[i - 1]);
  let counted = 0;
  let repeated = 0;
  for (const d of draws) {
    const prev = before.get(d.drawNo);
    if (!prev || !byNo.has(d.drawNo)) continue;
    counted++;
    if (d.numbers.some((n) => prev.numbers.includes(n))) repeated++;
  }
  return { draws: counted, repeated };
}

// ---------- Jackpot history ----------

export interface JackpotHistoryInput {
  id: string;
  name: string;
  board: Board;
  status: JackpotStatus;
  rows: readonly PrizeRow[];
}

export interface JackpotRun {
  /** The first draw after the last checked win (or the first checked draw) with a published amount. */
  from: { drawNo: number; date: string | null; amount: number };
  /** The newest checked draw with a published amount. */
  to: { drawNo: number; date: string | null; amount: number };
  /** Checked draws in the run. */
  draws: number;
  /** True when the run starts at the first checked draw (no win since our checks began). */
  sinceChecksBegan: boolean;
}

export interface JackpotHistoryRow {
  id: string;
  name: string;
  board: Board;
  wins: number;
  bySource: Record<JackpotSource, number>;
  dated: number;
  undated: number;
  withNumbers: number;
  earliest: string | null;
  latest: string | null;
  /** Wins with a published amount, newest first. */
  paid: { drawNo: number; date: string | null; amount: number; winners: number | null }[];
  checked: JackpotStatus["checked"];
  current: JackpotStatus["current"];
  run: JackpotRun | null;
}

/** NLB: the jackpot's climb since the last win in the checked prize rows (or since the checks began). */
export function jackpotRun(rows: readonly PrizeRow[]): JackpotRun | null {
  const asc = rows
    .filter((r) => r.tier !== "advertised" && r.superPrizeWinners !== null && r.superPrizeAmount !== null)
    .sort((a, b) => a.drawNo - b.drawNo);
  if (!asc.length) return null;
  let lastWin = -1;
  asc.forEach((r, i) => {
    if (r.superPrizeWinners! > 0) lastWin = i;
  });
  const run = asc.slice(lastWin + 1);
  if (!run.length) return null;
  const first = run[0];
  const last = run[run.length - 1];
  return {
    from: { drawNo: first.drawNo, date: first.date, amount: first.superPrizeAmount! },
    to: { drawNo: last.drawNo, date: last.date, amount: last.superPrizeAmount! },
    draws: run.length,
    sinceChecksBegan: lastWin < 0,
  };
}

/** NLB: the jackpot of the draw right after each checked win, oldest win first (the amount a new jackpot started at). */
export function restartAmounts(rows: readonly PrizeRow[]): { winDrawNo: number; nextDrawNo: number; amount: number }[] {
  const asc = rows.filter((r) => r.tier !== "advertised" && r.superPrizeAmount !== null).sort((a, b) => a.drawNo - b.drawNo);
  const out: { winDrawNo: number; nextDrawNo: number; amount: number }[] = [];
  asc.forEach((r, i) => {
    const next = asc[i + 1];
    if (r.superPrizeWinners !== null && r.superPrizeWinners > 0 && next && next.drawNo === r.drawNo + 1) {
      out.push({ winDrawNo: r.drawNo, nextDrawNo: next.drawNo, amount: next.superPrizeAmount! });
    }
  });
  return out;
}

/** One row per lottery of the jackpot-history article. */
export function jackpotHistory(inputs: readonly JackpotHistoryInput[]): JackpotHistoryRow[] {
  return inputs.map(({ id, name, board, status, rows }) => {
    const wins = status.wins;
    const dates = wins.map((w) => w.date).filter((d): d is string => d !== null).sort();
    const bySource: Record<JackpotSource, number> = { "nlb-prize-table": 0, "nlb-winners-directory": 0, "dlb-jackpot-reset": 0 };
    for (const w of wins) bySource[w.source]++;
    return {
      id,
      name,
      board,
      wins: wins.length,
      bySource,
      dated: dates.length,
      undated: wins.length - dates.length,
      withNumbers: wins.filter((w) => w.numbers !== null).length,
      earliest: dates[0] ?? null,
      latest: dates.at(-1) ?? null,
      paid: wins
        .filter((w) => w.amount !== null)
        .map((w) => ({ drawNo: w.drawNo, date: w.date, amount: w.amount!, winners: w.winners })),
      checked: status.checked,
      current: status.current,
      run: board === "NLB" ? jackpotRun(rows) : null,
    };
  });
}

/** Dated wins per calendar year over all lotteries, oldest year first. */
export function winsByYear(rows: readonly JackpotHistoryInput[]): { year: number; wins: number }[] {
  const by = new Map<number, number>();
  for (const r of rows) for (const w of r.status.wins) if (w.date) by.set(Number(w.date.slice(0, 4)), (by.get(Number(w.date.slice(0, 4))) ?? 0) + 1);
  return [...by.keys()].sort((a, b) => a - b).map((year) => ({ year, wins: by.get(year)! }));
}

// ---------- Year in numbers ----------

/** The year the year-in-numbers article covers: the newest draw's year, or the year before until March (a full year). */
export function articleYear(newestDate: string): number {
  const year = Number(newestDate.slice(0, 4));
  return Number(newestDate.slice(5, 7)) < 3 ? year - 1 : year;
}

export interface YearRow {
  draws: number;
  first: string | null;
  last: string | null;
  /** The most and least frequent numbers in use that year. */
  most: { count: number; numbers: number[] } | null;
  least: { count: number; numbers: number[] } | null;
  expected: number;
  topLetter: { count: number; letters: string[] } | null;
  repeat: { draws: number; repeated: number };
  repeatChance: number;
  /** Days without a draw from 1 January (or the archive's start) to the year's last draw. */
  daysWithout: number;
  longestBreak: DrawBreak | null;
}

/** One lottery's year: `all` is the full archive (newest first), `live` its numbers in use. */
export function yearRow(all: readonly DrawSummary[], live: readonly number[], year: number): YearRow {
  const draws = all.filter((d) => Number(d.date.slice(0, 4)) === year);
  const spread = frequencySpread(draws, live);
  const letters = new Map<string, number>();
  for (const d of draws) if (d.letter) letters.set(d.letter, (letters.get(d.letter) ?? 0) + 1);
  const topCount = Math.max(0, ...letters.values());
  const sortedDates = draws.map((d) => d.date).sort();
  const first = sortedDates[0] ?? null;
  const last = sortedDates.at(-1) ?? null;
  const archiveStart = all.map((d) => d.date).sort()[0];
  const startDay = first ? Math.max(toDay(`${year}-01-01`), toDay(archiveStart)) : 0;
  const breaks = last ? breaksBetween(startDay, toDay(last), new Set(sortedDates.map(toDay))) : [];
  return {
    draws: draws.length,
    first,
    last,
    most: spread ? spread.max : null,
    least: spread ? spread.min : null,
    expected: spread ? spread.expected : 0,
    topLetter: topCount > 0 ? { count: topCount, letters: [...letters.keys()].filter((l) => letters.get(l) === topCount).sort() } : null,
    repeat: repeats(all, draws),
    repeatChance: repeatChance(live.length, draws[0]?.numbers.length ?? 4),
    daysWithout: breaks.reduce((s, b) => s + b.days, 0),
    longestBreak: longestBreak(breaks),
  };
}
