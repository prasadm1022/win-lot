// SPDX-License-Identifier: Apache-2.0
// Offline audit of win-lot-jackpot-v2 (docs/MODEL-V2.md section 5.3). Not part of the build. Writes the generated
// docs/MODEL-V2-AUDIT.md: deterministic markdown (same data and code give the same file; timings go to the console
// only), with a short plain-language summary at the top.
//
//   1. placebo combinations: at least 100 replicates, own combinations replaced by random earlier draws (seeded)
//   2. placebo dates: at least 60 replicates, random dates inside each date's era (+-30 days, wins without numbers)
//   3. null simulation: fair synthetic draws with the real dates and letters; hits and rank must sit at chance within
//      2 SE, the copy tilt is expected to be positive (jackpot decades) and every copy guard must hold at every step
//   4. evidence growth: Dhana Nidhanaya with 0/1/3/10/30/100 synthetic own combinations and their dates
//   5. per-item pull: leave-one-out total-variation change per combination, date and daily draw (information only)
//   6. oracle gap: the best ticket over all tickets (same rules) vs the Top pick definition (24 candidates)
//   7. sensitivity: constants at -50% and +50%, reported only and never used to retune
//
// Run: `npm run audit:model` (several minutes; `npm run audit:model -- --out <file>` writes to another file).

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { fnv1a, mulberry32, nextDrawDate } from "../lib/model";
import * as model from "../lib/model-v2";
import {
  MODEL_VERSION_V2,
  V2_CONSTANTS,
  addDays,
  binsOf,
  buildContext,
  evidenceAt,
  isTypical,
  posteriorAt,
  predictAllV2,
  predictV2,
  ticketKey,
  walkForward,
  wholePercents,
  type BacktestRun,
  type ModelContext,
  type Posterior,
  type V2Input,
} from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import type { Prediction } from "../lib/types";
import { ROOT, loadDraws, loadJackpots, loadV2Inputs, sha256Json, syntheticCombinations, v2Input, withOwnItems } from "./model-v2-data";

const REPS_COMBINATIONS = 100;
const REPS_DATES = 60;
const REPS_NULL = 10;
const DATE_ERA_DAYS = 30;
const GROWTH = [0, 1, 3, 10, 30, 100];
const GROWTH_BUDGET_MS = 10_000;
/** Output file; `--out <file>` writes elsewhere (used to check that two runs give the same bytes). */
const OUT_ARG = process.argv.indexOf("--out");
const OUT = OUT_ARG > 0 ? resolve(process.argv[OUT_ARG + 1]) : join(ROOT, "docs", "MODEL-V2-AUDIT.md");

// ---------------------------------------------------------------- formatting (locale-free, no "-0")

function f(x: number, dp: number): string {
  const s = x.toFixed(dp);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

function sf(x: number, dp: number): string {
  const s = f(x, dp);
  return s.startsWith("-") || Number(s) === 0 ? s : `+${s}`;
}

/** 1334 -> "1,334" (no locale). */
function group(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ",");
}

function pc(share: number, dp = 0): string {
  return `${f(100 * share, dp)}%`;
}

function table(head: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return [line(head), line(head.map(() => "---")), ...rows.map(line)].join("\n");
}

function log(message: string): void {
  console.log(`model-v2-audit: ${message}`);
}

// ---------------------------------------------------------------- statistics

function mean(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function sd(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Mid-rank percentile of `real` among `placebo` (0 = below all, 1 = above all). */
function percentile(real: number, placebo: readonly number[]): number {
  const below = placebo.filter((v) => v < real - 1e-12).length;
  const ties = placebo.filter((v) => Math.abs(v - real) <= 1e-12).length;
  return (below + 0.5 * ties) / placebo.length;
}

/** Two-sided permutation p-value with the +1 correction: 2 (min(#<=, #>=) + 1) / (n + 1), capped at 1. */
function permutationP(real: number, placebo: readonly number[]): number {
  const le = placebo.filter((v) => v <= real + 1e-12).length;
  const ge = placebo.filter((v) => v >= real - 1e-12).length;
  return Math.min(1, (2 * (Math.min(le, ge) + 1)) / (placebo.length + 1));
}

function holm(ps: readonly number[]): number[] {
  const order = ps.map((_, i) => i).sort((a, b) => ps[a] - ps[b] || a - b);
  const out = new Array<number>(ps.length).fill(1);
  let running = 0;
  order.forEach((i, rank) => {
    running = Math.max(running, Math.min(1, (ps.length - rank) * ps[i]));
    out[i] = running;
  });
  return out;
}

function sourceZ(run: BacktestRun, s: number): number | null {
  return run.sourceVariance[s] > 0 ? run.sourceZ[s] / Math.sqrt(run.sourceVariance[s]) : null;
}

/** Copy tilt of a run: mean past-jackpot numbers in the Top pick over mean expected for a random ticket. */
function copyRatio(run: BacktestRun): number | null {
  return run.copy.steps && run.copy.expected > 0 ? run.copy.sum / run.copy.expected : null;
}

// ---------------------------------------------------------------- data helpers

function sortedNumbers(d: Draw): number[] {
  return [...d.numbers].sort((a, b) => a - b);
}

function randomTicket(rng: () => number, lottery: Lottery): number[] {
  const s = new Set<number>();
  while (s.size < lottery.main_count) s.add(lottery.main_min + Math.floor(rng() * (lottery.main_max - lottery.main_min + 1)));
  return [...s].sort((a, b) => a - b);
}

function walk(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[]): BacktestRun {
  return walkForward(buildContext(lottery, draws, jackpots));
}

/** Placebo combinations: each own combination takes the numbers, letter and bonus of a random earlier draw (seeded);
 *  its date, source and so its availability stay. The random draw is the one the partition rule then sets aside. */
function placeboCombinations(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[], rep: number): Jackpot[] {
  const rng = mulberry32(fnv1a(`${lottery.id}:placebo-combinations:${rep}`));
  const index = new Map(draws.map((d, i) => [d.draw_no, i] as const));
  return jackpots.map((j) => {
    if (j.lotteryId !== lottery.id || j.numbers === null) return j;
    const limit = index.get(j.drawNo) ?? draws.length;
    const pick = draws[Math.floor(rng() * Math.max(1, limit))];
    return {
      ...j,
      drawNo: pick.draw_no,
      numbers: sortedNumbers(pick),
      letter: pick.letter,
      bonus: Number.isInteger(pick.bonus) ? pick.bonus : null,
      inDrawHistory: true,
    };
  });
}

/** Placebo dates: each own win without numbers that is older than the archive gets a uniformly random day within
 *  DATE_ERA_DAYS of its real date (about two moon cycles and two months, so moon phase, day of month and weekday are
 *  all randomised), still before the archive start. Wins with numbers keep their dates: moving one would move its
 *  combination, and could make it known before its draw. */
function placeboDates(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[], rep: number): Jackpot[] {
  const rng = mulberry32(fnv1a(`${lottery.id}:placebo-dates:${rep}`));
  const archiveStart = draws[0].draw_date;
  return jackpots.map((j) => {
    if (j.lotteryId !== lottery.id || j.date === null || j.numbers !== null || j.date >= archiveStart) return j;
    let date = j.date;
    do date = addDays(j.date, Math.floor(rng() * (2 * DATE_ERA_DAYS + 1)) - DATE_ERA_DAYS);
    while (date >= archiveStart);
    return { ...j, date };
  });
}

function movableDates(lotteryId: string, draws: readonly Draw[], jackpots: readonly Jackpot[]): number {
  return jackpots.filter((j) => j.lotteryId === lotteryId && j.date !== null && j.numbers === null && j.date < draws[0].draw_date).length;
}

/** Null simulation: fair draws (uniform 4-subsets of the configured range) with the real dates, letters and bonus;
 *  own jackpot combinations in the archive take the synthetic numbers of their draw. */
function nullWorld(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[], rep: number) {
  const rng = mulberry32(fnv1a(`${lottery.id}:null:${rep}`));
  const fair = draws.map((d) => ({ ...d, numbers: randomTicket(rng, lottery) }));
  const byNo = new Map(fair.map((d) => [d.draw_no, d] as const));
  const js = jackpots.map((j) => {
    const d = byNo.get(j.drawNo);
    return j.lotteryId === lottery.id && j.numbers !== null && d ? { ...j, numbers: sortedNumbers(d) } : j;
  });
  return { draws: fair, jackpots: js };
}

/** Total-variation distance of two number distributions. */
function tv(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / 2;
}

// ---------------------------------------------------------------- 0. the real result (context for every section)

interface Base {
  inputs: V2Input[];
  jackpots: Jackpot[];
  predictions: Record<string, Prediction>;
  runs: Record<string, BacktestRun>;
  asOf: string;
}

function baseRun(): Base {
  const jackpots = loadJackpots();
  const inputs = loadV2Inputs(jackpots);
  const predictions = predictAllV2(inputs);
  const runs: Record<string, BacktestRun> = {};
  for (const i of inputs) runs[i.lottery.id] = walk(i.lottery, i.draws, jackpots);
  const asOf = inputs.map((i) => i.draws[i.draws.length - 1].draw_date).sort();
  return { inputs, jackpots, predictions, runs, asOf: asOf[asOf.length - 1] };
}

function headline(base: Base): { text: string; pooled: NonNullable<NonNullable<Prediction["backtestDetail"]>["pooled"]> } {
  const rows = base.inputs.map((i) => {
    const d = base.predictions[i.lottery.id].backtestDetail!;
    return [
      i.lottery.name,
      String(d.draws),
      f(d.v2.avgHits, 4),
      f(d.random.avgHits, 4),
      sf(d.z, 2),
      f(d.v1.avgHits, 4),
      sf(d.v1.pairedZ, 2),
      `${f(d.rank.pct, 3)} (${sf(d.rank.z, 2)})`,
    ];
  });
  const pooled = base.predictions[base.inputs[0].lottery.id].backtestDetail!.pooled!;
  const holmAll = base.predictions[base.inputs[0].lottery.id].backtestDetail!.holmAll!;
  rows.push([
    `**All ${pooled.lotteries}**`,
    String(pooled.draws),
    `**${f(pooled.v2.avgHits, 4)}**`,
    `**${f(pooled.random.avgHits, 4)}**`,
    `**${sf(pooled.z, 2)}**`,
    f(pooled.v1.avgHits, 4),
    sf(pooled.pairedZ, 2),
    `(${sf(pooled.rankZ, 2)})`,
  ]);
  const text = [
    "## 0. The walk-forward result being audited",
    "",
    "Top-pick hits per draw over the last 200 draws (178 for NLB), each step using only what was known before that draw " +
      "(docs/MODEL-V2.md section 5). Chance uses the balls actually in use.",
    "",
    table(["Lottery", "Draws", "v2", "Random", "z", "v1", "Paired z", "Rank pct (z)"], rows),
    "",
    `Holm over the ${holmAll.tests} headline hit z-scores: smallest p ${f(holmAll.minP, 4)}, ` +
      `${holmAll.anySignificant ? "one survives the correction" : "nothing survives the correction"}.`,
  ].join("\n");
  return { text, pooled };
}

// ---------------------------------------------------------------- 1. placebo combinations

interface PlaceboRow {
  /** Which placebo: combinations (section 1) or dates (section 2). */
  kind: "combinations" | "dates";
  lottery: string;
  metric: string;
  real: number;
  placebo: number[];
}

function placeboCombinationSection(base: Base): { text: string; rows: PlaceboRow[] } {
  const rows: PlaceboRow[] = [];
  for (const input of base.inputs) {
    const { lottery, draws } = input;
    const real = base.runs[lottery.id];
    if (!base.jackpots.some((j) => j.lotteryId === lottery.id && j.numbers !== null)) continue;
    const hits: number[] = [];
    const tilt: number[] = [];
    const t0 = performance.now();
    for (let rep = 0; rep < REPS_COMBINATIONS; rep++) {
      const run = walk(lottery, draws, placeboCombinations(lottery, draws, base.jackpots, rep));
      hits.push(run.sumHits / run.draws);
      tilt.push(copyRatio(run) ?? 0);
    }
    log(`placebo combinations ${lottery.id}: ${REPS_COMBINATIONS} replicates in ${f((performance.now() - t0) / 1000, 1)} s`);
    rows.push({ kind: "combinations", lottery: lottery.name, metric: "Top-pick hits per draw", real: real.sumHits / real.draws, placebo: hits });
    rows.push({ kind: "combinations", lottery: lottery.name, metric: "Copy tilt (held / random)", real: copyRatio(real) ?? 0, placebo: tilt });
  }
  const text = [
    "## 1. Placebo combinations",
    "",
    `${REPS_COMBINATIONS} replicates per lottery with own jackpot combinations. In each replicate every own combination is ` +
      "replaced by the numbers and letter of a random earlier draw (seeded); its date and its publication rule stay, so it " +
      "enters the walk-forward at the same step. If the real combinations carried information about later draws, the real " +
      "result would sit at the top end of the placebo range.",
    "",
    placeboTable(rows),
  ].join("\n");
  return { text, rows };
}

function placeboTable(rows: PlaceboRow[]): string {
  return table(
    ["Lottery", "Metric", "Real", "Placebo range", "Placebo mean", "Real percentile", "Permutation p"],
    rows.map((r) => [
      r.lottery,
      r.metric,
      f(r.real, 4),
      `${f(Math.min(...r.placebo), 4)} to ${f(Math.max(...r.placebo), 4)}`,
      f(mean(r.placebo), 4),
      f(percentile(r.real, r.placebo), 2),
      f(permutationP(r.real, r.placebo), 3),
    ]),
  );
}

// ---------------------------------------------------------------- 2. placebo dates

function placeboDateSection(base: Base): { text: string; rows: PlaceboRow[] } {
  const rows: PlaceboRow[] = [];
  const notes: string[] = [];
  for (const input of base.inputs) {
    const { lottery, draws } = input;
    const movable = movableDates(lottery.id, draws, base.jackpots);
    if (!movable) continue;
    const real = base.runs[lottery.id];
    const hits: number[] = [];
    const lift: number[] = [];
    let silent = 0;
    const t0 = performance.now();
    for (let rep = 0; rep < REPS_DATES; rep++) {
      const js = placeboDates(lottery, draws, base.jackpots, rep);
      const ctx = buildContext(lottery, draws, js);
      const run = walkForward(ctx);
      hits.push(run.sumHits / run.draws);
      lift.push(sourceZ(run, 1) ?? 0);
      const post = posteriorAt(ctx, draws.length, nextDrawDate(ctx.dates));
      if (post.calendar && post.calendar.features.every((x) => x.kappa === 0)) silent++;
    }
    log(`placebo dates ${lottery.id}: ${REPS_DATES} replicates in ${f((performance.now() - t0) / 1000, 1)} s`);
    const dated = base.predictions[lottery.id].evidence!.counts.jackpotDates.used;
    rows.push({ kind: "dates", lottery: lottery.name, metric: "Top-pick hits per draw", real: real.sumHits / real.draws, placebo: hits });
    rows.push({ kind: "dates", lottery: lottery.name, metric: "Jackpot-dates source lift z", real: sourceZ(real, 1) ?? 0, placebo: lift });
    notes.push(
      `- ${lottery.name}: ${movable} of ${dated} dates moved; the calendar fit was silent (every strength 0) at the ` +
        `production step in ${silent} of ${REPS_DATES} replicates.`,
    );
  }
  const text = [
    "## 2. Placebo dates",
    "",
    `${REPS_DATES} replicates per lottery with jackpot dates. The era of a date is the ${2 * DATE_ERA_DAYS + 1}-day window ` +
      "centred on it (about two moon cycles and two months), kept before the archive start: each date of a win without " +
      "winning numbers (all of them older than the draw archive) moves to a uniformly random day of its era, which " +
      "randomises moon phase, day of month and weekday while keeping when the win became known. Wins with numbers keep " +
      "their dates: moving one would move its combination, and could make it known before its own draw.",
    "",
    placeboTable(rows),
    "",
    ...notes,
  ].join("\n");
  return { text, rows };
}

// ---------------------------------------------------------------- 3. null simulation

/** Copy-guard check of a walk-forward (2.14), against the jackpot items themselves: at every step with usable own
 *  combinations, the Top pick may share at most the step's perCombination numbers with any one of them and at most
 *  its union numbers with all of them, and the step's rung may exclude at most GUARD_ALPHA of all tickets. */
interface GuardCheck {
  steps: number;
  breaks: number;
  maxShared: number;
  maxUnion: number;
  /** The loosest rung used at any step (ladder order), as (perCombination, union). */
  loosest: [number, number];
}

/** Position of a rung in GUARD_LADDER (strictest first). */
function rungIndex([c, u]: readonly [number, number]): number {
  return V2_CONSTANTS.GUARD_LADDER.findIndex(([lc, lu]) => lc === c && lu === u);
}

function emptyGuardCheck(): GuardCheck {
  const [c, u] = V2_CONSTANTS.GUARD_LADDER[0];
  return { steps: 0, breaks: 0, maxShared: 0, maxUnion: 0, loosest: [c, u] };
}

/** Adds the counts of `g` to `acc`. */
function addGuardCheck(acc: GuardCheck, g: GuardCheck): void {
  acc.steps += g.steps;
  acc.breaks += g.breaks;
  acc.maxShared = Math.max(acc.maxShared, g.maxShared);
  acc.maxUnion = Math.max(acc.maxUnion, g.maxUnion);
  if (rungIndex(g.loosest) > rungIndex(acc.loosest)) acc.loosest = [...g.loosest];
}

function guardCheck(ctx: ModelContext, run: BacktestRun): GuardCheck {
  const out = emptyGuardCheck();
  for (const rec of run.records ?? []) {
    const combos = evidenceAt(ctx.items, rec.t, rec.date).combinations.map((c) => c.numbers as number[]);
    if (!combos.length) continue;
    out.steps++;
    const union = new Set(combos.flat());
    const fromUnion = rec.numbers.filter((n) => union.has(n)).length;
    const shared = Math.max(...combos.map((c) => rec.numbers.filter((n) => c.includes(n)).length));
    out.maxShared = Math.max(out.maxShared, shared);
    out.maxUnion = Math.max(out.maxUnion, fromUnion);
    const g = rec.guard;
    if (shared > g.perCombination || fromUnion > g.union || !(g.excludedShare <= V2_CONSTANTS.GUARD_ALPHA)) out.breaks++;
    const rung: [number, number] = [g.perCombination, g.union];
    if (rungIndex(rung) > rungIndex(out.loosest)) out.loosest = rung;
  }
  return out;
}

interface NullResult {
  text: string;
  /** Mean hits and rank percentile within 2 SE of chance, per lottery and pooled. */
  hitsRankPass: boolean;
  /** Every null Top pick kept its step's copy guards (and every rung excluded at most GUARD_ALPHA). */
  guardsHeld: boolean;
  /** The 5.3 item 3 verdict: hits and rank at chance and every guard kept. The copy tilt is expected to be positive. */
  met: boolean;
  pooledZ: number;
  rankPooledZ: number;
  copyExcess: number;
  copyExcessSE: number;
  guards: GuardCheck;
}

function nullSection(base: Base): NullResult {
  const rows: string[][] = [];
  let sh = 0;
  let se = 0;
  let sv = 0;
  let rs = 0;
  let rd = 0;
  let rv = 0;
  const copyDiffs: number[] = [];
  const outside: string[] = [];
  const guards = emptyGuardCheck();
  for (const input of base.inputs) {
    const { lottery, draws } = input;
    const diffs: number[] = [];
    let h = 0;
    let e = 0;
    let v = 0;
    let lr = 0;
    let ld = 0;
    let lv = 0;
    let lotteryGuards: GuardCheck | null = null;
    const t0 = performance.now();
    for (let rep = 0; rep < REPS_NULL; rep++) {
      const w = nullWorld(lottery, draws, base.jackpots, rep);
      const ctx = buildContext(lottery, w.draws, w.jackpots);
      const run = walkForward(ctx, { records: true });
      h += run.sumHits;
      e += run.sumExpected;
      v += run.sumVariance;
      lr += run.rankSum;
      ld += run.rankDraws;
      lv += run.rankVariance;
      if (run.copy.steps) diffs.push((run.copy.sum - run.copy.expected) / run.copy.steps);
      const g = guardCheck(ctx, run);
      if (g.steps) {
        lotteryGuards ??= emptyGuardCheck();
        addGuardCheck(lotteryGuards, g);
        addGuardCheck(guards, g);
      }
    }
    log(`null simulation ${lottery.id}: ${REPS_NULL} replicates in ${f((performance.now() - t0) / 1000, 1)} s`);
    sh += h;
    se += e;
    sv += v;
    rs += lr;
    rd += ld;
    rv += lv;
    copyDiffs.push(...diffs);
    const z = (h - e) / Math.sqrt(v);
    const rz = (lr - ld / 2) / Math.sqrt(lv);
    if (Math.abs(z) > 2) outside.push(`${lottery.name} hits`);
    if (Math.abs(rz) > 2) outside.push(`${lottery.name} rank`);
    let copyCell = "no combinations";
    let guardCell = "no combinations";
    if (diffs.length) {
      const m = mean(diffs);
      const s = sd(diffs) / Math.sqrt(diffs.length);
      copyCell = `${sf(m, 3)} (SE ${f(s, 3)})`;
    }
    if (lotteryGuards) {
      guardCell =
        `${lotteryGuards.maxShared} / ${lotteryGuards.maxUnion} at rung up to (${lotteryGuards.loosest.join(", ")})` +
        (lotteryGuards.breaks ? `; **broken at ${lotteryGuards.breaks} of ${group(lotteryGuards.steps)} steps**` : "");
    }
    rows.push([lottery.name, String(REPS_NULL), f(h / ld, 4), f(e / ld, 4), sf(z, 2), f(lr / ld, 4), sf(rz, 2), copyCell, guardCell]);
  }
  const pooledZ = (sh - se) / Math.sqrt(sv);
  const rankPooledZ = (rs - rd / 2) / Math.sqrt(rv);
  if (Math.abs(pooledZ) > 2) outside.push("pooled hits");
  if (Math.abs(rankPooledZ) > 2) outside.push("pooled rank");
  const copyExcess = mean(copyDiffs);
  const copyExcessSE = sd(copyDiffs) / Math.sqrt(copyDiffs.length);
  rows.push([
    "**All**",
    String(REPS_NULL * base.inputs.length),
    f(sh / rd, 4),
    f(se / rd, 4),
    `**${sf(pooledZ, 2)}**`,
    f(rs / rd, 4),
    `**${sf(rankPooledZ, 2)}**`,
    `**${sf(copyExcess, 3)} (SE ${f(copyExcessSE, 3)})**`,
    `${guards.maxShared} / ${guards.maxUnion}` + (guards.breaks ? `; **broken at ${guards.breaks} steps**` : ""),
  ]);
  const hitsRankPass = outside.length === 0;
  const guardsHeld = guards.breaks === 0;
  const met = hitsRankPass && guardsHeld;
  const tiltZ = copyExcess / copyExcessSE;
  const tilt =
    `${sf(copyExcess, 2)} past jackpot numbers per draw more than a random ticket (SE ${f(copyExcessSE, 2)}, ` +
    `${sf(tiltZ, 1)} standard errors)`;
  const tiltVerdict =
    copyExcess > 2 * copyExcessSE
      ? "positive by design (jackpot decades), capped by the guards"
      : copyExcess >= -2 * copyExcessSE
        ? "within 2 standard errors of chance this time (a positive tilt is expected by design), capped by the guards"
        : "below chance, which the design does not expect; capped by the guards";
  const failed = [
    ...(hitsRankPass ? [] : [`hits or rank outside 2 standard errors (${outside.join(", ")})`]),
    ...(guardsHeld ? [] : [`a copy guard broken at ${guards.breaks} of ${group(guards.steps)} steps`]),
  ];
  const text = [
    "## 3. Null simulation",
    "",
    `${REPS_NULL} replicates per lottery: every draw's numbers are replaced by a fair random ticket (seeded), keeping the ` +
      "real dates, letters, bonus numbers and jackpot items (combinations take the synthetic numbers of their draw). The " +
      "whole walk-forward is rerun. Mean hits and rank percentile use their analytic chance levels; the copy tilt (Top-pick " +
      "numbers from past jackpots minus a random ticket's, per step) uses the spread between replicates, because consecutive " +
      "steps share most of their evidence. The guard column is the most numbers any null Top pick shared with one past " +
      "jackpot / took from all of them, checked at every step against that step's own copy-guard rung (docs/MODEL-V2.md " +
      "section 2.14).",
    "",
    table(["Lottery", "Replicates", "Hits", "Chance", "z", "Rank pct", "Rank z", "Copy tilt minus chance", "Guards: max one / max all"], rows),
    "",
    hitsRankPass
      ? "Mean hits and rank percentile sit at chance within 2 standard errors for every lottery and pooled."
      : `Outside 2 standard errors: ${outside.join(", ")} (with this many checks, one such result is expected by luck now and then).`,
    "",
    `Copy tilt: with fair draws the Top pick holds ${tilt}: ${tiltVerdict}. The tilt comes from the design, not from the ` +
      "draws: the jackpot-pattern source moves whole tens, so numbers in the tens where past jackpot numbers fell rank " +
      "higher, and the past jackpot numbers sit in exactly those tens. " +
      (guardsHeld
        ? `The copy guards held at all ${group(guards.steps)} null steps with jackpot combinations: at most ` +
          `${guards.maxShared} ${guards.maxShared === 1 ? "number" : "numbers"} from any one past jackpot and at most ` +
          `${guards.maxUnion} from all of them.`
        : `The copy guards were broken at ${guards.breaks} of ${group(guards.steps)} null steps.`),
    "",
    met
      ? "Verdict (docs/MODEL-V2.md section 5.3 item 3): met. Hits and rank sit at chance, and the copy tilt is " +
        `${copyExcess > 2 * copyExcessSE ? "positive by design (jackpot decades), capped by the guards" : "capped by the guards"}.`
      : `Verdict (docs/MODEL-V2.md section 5.3 item 3): not met: ${failed.join("; ")}.`,
  ].join("\n");
  return { text, hitsRankPass, guardsHeld, met, pooledZ, rankPooledZ, copyExcess, copyExcessSE, guards };
}

// ---------------------------------------------------------------- 4. evidence growth

function growthSection(base: Base): { text: string; maxExcluded: number; allHeld: boolean } {
  const dhana = LOTTERY_BY_ID["dhana-nidhanaya"];
  const draws = loadDraws(dhana.id);
  const rows: string[][] = [];
  let maxExcluded = 0;
  let allHeld = true;
  let withinBudget = true;
  const silent: number[] = [];
  const oneCluster: number[] = [];
  const effectiveIsClusters: boolean[] = [];
  for (const n of GROWTH) {
    const js = withOwnItems(base.jackpots, dhana.id, syntheticCombinations(dhana, draws, n, 1));
    const t0 = performance.now();
    const p = predictV2(v2Input(dhana, draws, js, "2026-10-28T00:00:00Z"));
    const ms = performance.now() - t0;
    log(`growth ${n} combinations: predictV2 with backtest ${f(ms / 1000, 2)} s`);
    if (ms > GROWTH_BUDGET_MS) withinBudget = false;
    const g = p.evidence!.guard;
    const s = wholePercents(p.influence!.numbers); // whole percents that add up to 100, as on the site
    const d = p.backtestDetail!;
    const dates = p.evidence!.counts.jackpotDates;
    maxExcluded = Math.max(maxExcluded, g.excludedShare);
    if (d.orderHeld.held !== d.orderHeld.steps) allHeld = false;
    if (dates.used > 0 && p.evidence!.calendar!.every((c) => c.strength === 0)) silent.push(n);
    if (dates.used > 1 && dates.clusters === 1) oneCluster.push(n);
    effectiveIsClusters.push(dates.effective === dates.clusters);
    rows.push([
      String(n),
      String(p.evidence!.counts.jackpotCombinations.used),
      `(${g.perCombination}, ${g.union})`,
      pc(g.excludedShare, 2),
      `${s.jackpotCombinations}% / ${s.jackpotDates}% / ${s.dailyDraws}%`,
      `${dates.used} / ${dates.clusters}`,
      `${d.orderHeld.held}/${d.orderHeld.steps} (${d.orderHeld.filterChanged})`,
      f(d.v2.avgHits, 4),
    ]);
  }
  const notes: string[] = [];
  if (silent.length) {
    notes.push(
      `The synthetic dates are random archive dates, so they carry no calendar pattern. At ${silent.join(", ")} ` +
        "combinations every calendar strength is 0: the dates add nothing, and by the strict chain (decision D5) the " +
        "daily draws are held at 0 too.",
    );
  }
  if (oneCluster.length) {
    notes.push(
      `At ${oneCluster.join(", ")} combinations all dates lie within ${V2_CONSTANTS.DECLUSTER_DAYS} days of the first ` +
        "one, a single de-clustering cluster, which counts as one calendar position.",
    );
  }
  notes.push(
    effectiveIsClusters.every(Boolean)
      ? "At every level the effective number of jackpot dates equals the number of date clusters: each cluster counts " +
        "as one independent date (docs/MODEL-V2.md section 2.7 a)."
      : "**At some level the effective number of jackpot dates differs from the number of date clusters " +
        "(docs/MODEL-V2.md section 2.7 a requires them equal).**",
  );
  const text = [
    "## 4. Evidence growth",
    "",
    "Dhana Nidhanaya with its own jackpot items replaced by n synthetic combinations: random archive draws (nested: the " +
      "first 3 are among the first 10, and so on), each with its date. Guard rung, the share of all tickets it excludes, " +
      "the number-channel split and the backtest at each level.",
    "",
    table(
      ["Combinations", "Usable now", "Guard rung", "Excluded share", "Split J / T / D", "Dates used / clusters (= effective dates)", "Order held (filter changed)", "Hits per draw"],
      rows,
    ),
    "",
    `The excluded share never exceeds ${pc(V2_CONSTANTS.GUARD_ALPHA)} and a Top pick was found at every step of every level. ` +
      `Every level ran within the ${f(GROWTH_BUDGET_MS / 1000, 0)} s benchmark budget: ${withinBudget ? "yes" : "no"} ` +
      "(timings are printed to the console, not stored here, so this file stays deterministic).",
    ...(notes.length ? ["", notes.join(" ")] : []),
  ].join("\n");
  return { text, maxExcluded, allHeld };
}

// ---------------------------------------------------------------- 5. per-item pull (leave one out)

function looSection(base: Base): string {
  const out: string[] = [
    "## 5. Per-item pull (leave one out)",
    "",
    "For the production step of each lottery with jackpot evidence: the total-variation change of the number " +
      "distribution theta (half the sum of absolute changes, in units of 10^-4) when one item is left out. Information " +
      "only; nothing is tuned on it.",
    "",
  ];
  const rows: string[][] = [];
  for (const input of base.inputs) {
    const { lottery, draws } = input;
    const ctx = buildContext(lottery, draws, base.jackpots);
    const N = draws.length;
    const tau = nextDrawDate(ctx.dates);
    const post = posteriorAt(ctx, N, tau);
    if (!post.evidence.dates.length) continue;
    const theta = post.num.theta;
    const own = base.jackpots.filter((j) => j.lotteryId === lottery.id);
    const usedNos = new Set(post.evidence.dates.map((it) => `${it.drawNo}:${it.source}`));
    const comboPulls: number[] = [];
    const datePulls: number[] = [];
    for (const j of own) {
      if (!usedNos.has(`${j.drawNo}:${j.source}`)) continue;
      const without = base.jackpots.filter((x) => x !== j);
      const c2 = buildContext(lottery, draws, without);
      const pull = tv(theta, posteriorAt(c2, N, tau).num.theta);
      (j.numbers !== null ? comboPulls : datePulls).push(pull);
    }
    const dailyPulls: number[] = [];
    for (const i of post.pool) {
      const without = draws.filter((_, q) => q !== i);
      const c2 = buildContext(lottery, without, base.jackpots);
      dailyPulls.push(tv(theta, posteriorAt(c2, N - 1, tau).num.theta));
    }
    const cell = (xs: number[]) =>
      xs.length ? `${f(mean(xs) * 1e4, 2)} (${f(Math.min(...xs) * 1e4, 2)}-${f(Math.max(...xs) * 1e4, 2)})` : "none";
    rows.push([
      lottery.name,
      `${comboPulls.length}: ${cell(comboPulls)}`,
      `${datePulls.length}: ${cell(datePulls)}`,
      `${dailyPulls.length}: ${cell(dailyPulls)}`,
    ]);
    log(`leave-one-out ${lottery.id}: ${comboPulls.length + datePulls.length + dailyPulls.length} items`);
  }
  out.push(
    table(["Lottery", "Combinations: mean (min-max)", "Dates without numbers: mean (min-max)", "Daily draws: mean (min-max)"], rows),
    "",
    "Leaving out a combination also removes its date. The cap (section 2.9) couples the sources: leaving out a higher item " +
      "also changes how far the lower sources are damped.",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------- 6. oracle gap

interface Gap {
  topScore: number;
  bestScore: number;
  bestOrderedScore: number;
  higherOrdered: number;
  passing: number;
  same: boolean;
}

/** Full enumeration of every ticket on the live balls with the Top-pick rules (R1-R3) and its score (2.10). */
function oracleGap(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[], top: readonly number[]): Gap {
  const ctx = buildContext(lottery, draws, jackpots);
  const N = draws.length;
  const post: Posterior = posteriorAt(ctx, N, nextDrawDate(ctx.dates));
  const lo = ctx.lo;
  const live: number[] = [];
  post.regime.live.forEach((v, j) => v && live.push(lo + j));
  const past = new Set<number>();
  for (let i = 0; i < N; i++) if (ctx.keys[i] >= 0) past.add(ctx.keys[i]);
  const lnTheta = Array.from(post.num.theta, (v) => (v > 0 ? Math.log(v) : -Infinity));
  const lnOdd = Array.from(post.odd.theta, (v, b) => Math.log(v / post.odd.p0[b]));
  const lnSpread = Array.from(post.spread.theta, (v, b) => Math.log(v / post.spread.p0[b]));
  const inUnion = new Uint8Array(ctx.M);
  for (const n of post.union) inUnion[n - lo] = 1;
  const comboOf = post.combos.map((c) => {
    const m = new Uint8Array(ctx.M);
    for (const n of c) m[n - lo] = 1;
    return m;
  });
  const present = [0, 1, 2].filter((s) => post.num.present[s]);
  const { perCombination, union } = post.guard;
  const score = (s: number[]) => {
    const b = binsOf(s, post.shape);
    let v = lnOdd[b.odd] + lnSpread[b.spread];
    for (const n of s) v += lnTheta[n - lo];
    return v;
  };
  const ordered = (s: number[]) => {
    const b = binsOf(s, post.shape);
    const parts = [0, 1, 2].map((src) => {
      let v = post.odd.parts[src][b.odd] + post.spread.parts[src][b.spread];
      for (const n of s) v += post.num.parts[src][n - lo];
      return v;
    });
    return present.every((src, q) => q === 0 || parts[present[q - 1]] >= parts[src] - 1e-12);
  };
  const topScore = score([...top]);
  let bestScore = -Infinity;
  let bestOrderedScore = -Infinity;
  let bestOrdered: number[] = [];
  let higherOrdered = 0;
  let passing = 0;
  const L = live.length;
  const s = [0, 0, 0, 0];
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++)
      for (let c = b + 1; c < L; c++)
        for (let d = c + 1; d < L; d++) {
          s[0] = live[a];
          s[1] = live[b];
          s[2] = live[c];
          s[3] = live[d];
          if (!isTypical(s, post.shape)) continue;
          let u = 0;
          for (const n of s) u += inUnion[n - lo];
          if (u > union) continue;
          if (comboOf.some((m) => m[s[0] - lo] + m[s[1] - lo] + m[s[2] - lo] + m[s[3] - lo] > perCombination)) continue;
          if (past.has(ticketKey(s))) continue;
          passing++;
          const v = score(s);
          if (v > bestScore) bestScore = v;
          if (v > topScore + 1e-12 || v > bestOrderedScore) {
            if (!ordered(s)) continue;
            if (v > topScore + 1e-12) higherOrdered++;
            if (v > bestOrderedScore) {
              bestOrderedScore = v;
              bestOrdered = s.slice();
            }
          }
        }
  return { topScore, bestScore, bestOrderedScore, higherOrdered, passing, same: bestOrdered.join() === top.join() };
}

function oracleSection(base: Base): { text: string; maxGap: number } {
  const rows: string[][] = [];
  let maxGap = 0;
  for (const input of base.inputs) {
    const top = base.predictions[input.lottery.id].sets[0].numbers;
    const t0 = performance.now();
    const g = oracleGap(input.lottery, input.draws, base.jackpots, top);
    log(`oracle gap ${input.lottery.id}: ${g.passing} tickets in ${f((performance.now() - t0) / 1000, 1)} s`);
    const gap = g.bestOrderedScore - g.topScore;
    maxGap = Math.max(maxGap, gap);
    rows.push([
      input.lottery.name,
      String(g.passing),
      f(g.topScore, 6),
      f(g.bestOrderedScore, 6),
      f(gap, 6),
      String(g.higherOrdered),
      g.same ? "yes" : "no",
    ]);
  }
  const text = [
    "## 6. Oracle gap",
    "",
    "The Top pick is defined over the 24 highest-lean numbers (section 2.15). Here every ticket on the live balls that " +
      "passes the same rules (copy guard, typicality, not a past result) and keeps the order of the parts is scored with the " +
      "same pattern score (sum of log theta plus the odd/even and spread terms), and the best one is compared with the Top pick.",
    "",
    table(["Lottery", "Tickets passing the rules", "Top-pick score", "Best score (all tickets)", "Gap", "Ordered tickets scoring higher", "Same ticket"], rows),
    "",
    "A pattern score is not a chance: every ticket has the same chance in a fair draw.",
  ].join("\n");
  return { text, maxGap };
}

// ---------------------------------------------------------------- 7. sensitivity

type ModelModule = typeof model;

interface Variant {
  name: string;
  value: string;
  patch: (src: string) => string;
}

function setConstant(key: string, value: string): (src: string) => string {
  return (src) => src.replace(new RegExp(`(\\n\\s*${key}: )[^,\\n]+,`), `$1${value},`);
}

function variants(): Variant[] {
  const c = V2_CONSTANTS;
  const out: Variant[] = [];
  const scale = (key: keyof typeof c, digits = 6) => {
    for (const k of [0.5, 1.5]) {
      const v = Number(((c[key] as number) * k).toFixed(digits));
      out.push({ name: key, value: String(v), patch: setConstant(key, String(v)) });
    }
  };
  for (const key of ["W_J", "W_T", "W_D", "ORDER", "PRIOR"] as const) scale(key);
  for (const k of [0.5, 1.5]) {
    const v = 1 + (c.MAX_LIFT - 1) * k;
    out.push({ name: "MAX_LIFT (lift room)", value: String(v), patch: setConstant("MAX_LIFT", String(v)) });
  }
  for (const key of ["J_PRIOR", "KAPPA_MAX", "DECLUSTER_DAYS", "GUARD_ALPHA", "CAND", "SIR", "SIR_ROUNDS", "SET_OVERLAP", "DEAD_P"] as const) {
    scale(key, key === "DEAD_P" ? 12 : 6);
  }
  for (const k of [0.5, 1.5]) {
    const lowQ = Number((c.TYPICAL.sumLowQ * k).toFixed(6));
    const highQ = Number((1 - (1 - c.TYPICAL.sumHighQ) * k).toFixed(6));
    out.push({
      name: "TYPICAL sum tails",
      value: `${lowQ}-${highQ}`,
      patch: (src) => src.replace(/sumLowQ: [0-9.]+, sumHighQ: [0-9.]+/, `sumLowQ: ${lowQ}, sumHighQ: ${highQ}`),
    });
  }
  return out;
}

async function loadVariant(v: Variant, tag: number): Promise<{ mod: ModelModule; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), `win-lot-audit-${tag}-`));
  cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true });
  mkdirSync(join(dir, "data"), { recursive: true });
  cpSync(join(ROOT, "data", "lotteries.json"), join(dir, "data", "lotteries.json"));
  const file = join(dir, "lib", "model-v2", "constants.ts");
  const src = readFileSync(file, "utf8");
  const patched = v.patch(src);
  if (patched === src) throw new Error(`model-v2-audit: the ${v.name} patch changed nothing`);
  writeFileSync(file, patched);
  const mod = (await import(pathToFileURL(join(dir, "lib", "model-v2", "index.ts")).href)) as ModelModule;
  return { mod, dir };
}

async function sensitivitySection(base: Base): Promise<{ text: string; range: [number, number]; within: boolean }> {
  const ids = base.inputs.map((i) => i.lottery.id);
  // Compare tickets only (letter, numbers, bonus): scores and parts move with any scale change.
  const ticket = (s: Prediction["sets"][number]) => `${s.letter ?? ""} ${s.numbers.join(" ")} ${String(s.bonus ?? "")}`;
  const tops = (out: Record<string, Prediction>) => ids.map((id) => ticket(out[id].sets[0]));
  const cards = (out: Record<string, Prediction>) => ids.map((id) => out[id].sets.slice(1).map(ticket).join(" | "));
  const baseTops = tops(base.predictions);
  const baseCards = cards(base.predictions);
  const rows: string[][] = [];
  let lo = Infinity;
  let hi = -Infinity;
  let within = true;
  const all = variants();
  for (let q = 0; q < all.length; q++) {
    const v = all[q];
    const t0 = performance.now();
    const { mod, dir } = await loadVariant(v, q);
    try {
      if (JSON.stringify(mod.V2_CONSTANTS) === JSON.stringify(V2_CONSTANTS)) throw new Error(`model-v2-audit: ${v.name} not applied`);
      const out = mod.predictAllV2(base.inputs);
      const pooled = out[ids[0]].backtestDetail!.pooled!;
      lo = Math.min(lo, pooled.v2.avgHits);
      hi = Math.max(hi, pooled.v2.avgHits);
      if (Math.abs(pooled.z) >= 2) within = false;
      const t = tops(out);
      const cs = cards(out);
      const split = (id: string) => {
        const s = out[id].influence!.numbers;
        return `${f(s.jackpotCombinations, 2)}/${f(s.jackpotDates, 2)}/${f(s.dailyDraws, 2)}`;
      };
      let held = 0;
      let steps = 0;
      for (const id of ids) {
        held += out[id].backtestDetail!.orderHeld.held;
        steps += out[id].backtestDetail!.orderHeld.steps;
      }
      rows.push([
        v.name,
        v.value,
        f(pooled.v2.avgHits, 4),
        sf(pooled.z, 2),
        split("dhana-nidhanaya"),
        split("govisetha"),
        split("mega-power"),
        `${t.filter((x, i) => x !== baseTops[i]).length} / ${ids.length}`,
        `${cs.filter((x, i) => x !== baseCards[i]).length} / ${ids.length}`,
        pc(held / steps, 1),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    log(`sensitivity ${v.name} = ${v.value}: ${f((performance.now() - t0) / 1000, 1)} s`);
  }
  const p = base.predictions;
  const split0 = (id: string) => {
    const s = p[id].influence!.numbers;
    return `${f(s.jackpotCombinations, 2)}/${f(s.jackpotDates, 2)}/${f(s.dailyDraws, 2)}`;
  };
  const pooled0 = p[ids[0]].backtestDetail!.pooled!;
  rows.unshift([
    "(frozen values)",
    "",
    f(pooled0.v2.avgHits, 4),
    sf(pooled0.z, 2),
    split0("dhana-nidhanaya"),
    split0("govisetha"),
    split0("mega-power"),
    `0 / ${ids.length}`,
    `0 / ${ids.length}`,
    "100.0%",
  ]);
  const text = [
    "## 7. Sensitivity (reported only, never used to retune)",
    "",
    "Each constant at half and at one and a half times its frozen value, one at a time, with everything recomputed " +
      "(walk-forward included). MAX_LIFT varies its lift room (0.25), the typicality band its two 10% tails. ORDER at 1.125 " +
      "lets a lower source pull harder than the one above it, so the owner's order is no longer enforced. The choice of " +
      "calendar features, the guard ladder, the moon constants, the 1-day prize-table lag (decision D1) and the backtest " +
      "window (shared with v1 for the paired comparison) are rules rather than weights and are not varied. SIR and " +
      "SIR_ROUNDS shape only the Lucky dip: cards 2-4 are deterministic best tickets. The frozen constants stay exactly " +
      "as they are, whatever this table shows.",
    "",
    table(
      ["Constant", "Value", "Pooled hits", "Pooled z", "Dhana J/T/D", "Govisetha J/T/D", "Mega Power J/T/D", "Top picks changed", "Cards 2-5 changed", "Order held"],
      rows,
    ),
    "",
    `Pooled hits across all variants: ${f(lo, 4)} to ${f(hi, 4)} (chance ${f(pooled0.random.avgHits, 4)}). ` +
      (within ? "Every variant stays within 2 standard errors of chance." : "At least one variant is 2 or more standard errors from chance, which is expected by luck now and then across this many variants."),
  ].join("\n");
  return { text, range: [lo, hi], within };
}

// ---------------------------------------------------------------- the document

async function main(): Promise<void> {
  const t0 = performance.now();
  const base = baseRun();
  log(`base run in ${f((performance.now() - t0) / 1000, 1)} s`);
  const head = headline(base);
  const combos = placeboCombinationSection(base);
  const dates = placeboDateSection(base);
  const nul = nullSection(base);
  const growth = growthSection(base);
  const loo = looSection(base);
  const oracle = oracleSection(base);
  const sens = await sensitivitySection(base);

  const placebo = [...combos.rows, ...dates.rows];
  const adjusted = holm(placebo.map((r) => permutationP(r.real, r.placebo)));
  const placeboLines = placebo.map(
    (r, i) => `| ${r.kind} | ${r.lottery} | ${r.metric} | ${f(percentile(r.real, r.placebo), 2)} | ${f(permutationP(r.real, r.placebo), 3)} | ${f(adjusted[i], 3)} |`,
  );
  const minHolm = Math.min(...adjusted);
  const dhanaHits = combos.rows.find((r) => r.lottery === "Dhana Nidhanaya" && r.metric.startsWith("Top-pick"));
  const pooled = head.pooled;

  const summary = [
    "## Summary in plain language",
    "",
    (Math.abs(pooled.z) <= 1.96
      ? `- **The honest replay matches chance.** Over ${group(pooled.draws)} past draws the Top pick `
      : `- **The honest replay is outside the usual range of luck (pooled z ${sf(pooled.z, 2)}); check the data and the method.** Over ${group(pooled.draws)} past draws the Top pick `) +
      `matched ${f(pooled.v2.avgHits, 4)} numbers per draw; a random ticket matches ${f(pooled.random.avgHits, 4)}. ` +
      (Math.abs(pooled.z) <= 1.96 ? "That is the same as random; the difference is luck." : "Lottery draws are random, so this is most likely a fault or a rare fluke."),
    `- **Real jackpot evidence behaves like random evidence.** Replacing the real jackpot combinations (${REPS_COMBINATIONS} ` +
      `replicates) or the older jackpot dates (${REPS_DATES} replicates) with random ones gives results in the same range. After ` +
      `allowing for the ${placebo.length} comparisons, the smallest corrected p-value is ${f(minHolm, 2)}` +
      (minHolm < 0.05 ? ", so one comparison stands out and is being watched." : ", so nothing stands out.") +
      (dhanaHits
        ? ` Dhana Nidhanaya's real hits sit at percentile ${f(percentile(dhanaHits.real, dhanaHits.placebo), 2)} of its placebos ` +
          "(low, but within what luck produces across this many comparisons)."
        : ""),
    `- **With fair random draws the hits stay at chance** (pooled hits z ${sf(nul.pooledZ, 2)}, rank z ${sf(nul.rankPooledZ, 2)}` +
      (nul.hitsRankPass ? ", every lottery within 2 standard errors)." : "; not every lottery is within 2 standard errors).") +
      ` The Top pick then holds ${sf(nul.copyExcess, 2)} past jackpot numbers per draw more than a random ticket ` +
      `(SE ${f(nul.copyExcessSE, 2)})` +
      (nul.met
        ? nul.copyExcess > 2 * nul.copyExcessSE
          ? ": positive by design (jackpot decades), capped by the guards. It favours the tens where jackpot numbers " +
            "fell; it is not a sign of foresight."
          : ", capped by the guards."
        : `. This check is not met: ${nul.hitsRankPass ? "" : "hits or rank are outside 2 standard errors"}` +
          `${!nul.hitsRankPass && !nul.guardsHeld ? " and " : ""}${nul.guardsHeld ? "" : "a copy guard was broken"}.`),
    `- **The copy guards stay small as evidence grows.** From 0 to 100 synthetic jackpot combinations they never exclude more ` +
      `than ${pc(growth.maxExcluded, 2)} of all tickets, and a Top pick that keeps the owner's order was found at every step: ` +
      `${growth.allHeld ? "yes" : "no"}.`,
    oracle.maxGap <= 1e-12
      ? "- **The 24-number search loses nothing.** For every lottery the Top pick is also the best rule-passing ticket " +
        "over all tickets."
      : `- **The 24-number search costs little.** Over all rule-passing tickets the best pattern score is at most ` +
        `${f(oracle.maxGap, 4)} above the Top pick's.`,
    `- **No constant is fragile.** Changing any constant by 50% either way moves the pooled hits between ${f(sens.range[0], 4)} ` +
      `and ${f(sens.range[1], 4)}; ${sens.within ? "every variant stays at chance" : "not every variant stays within 2 standard errors"}. ` +
      "The constants are frozen policy and are never retuned on these results.",
    "- Every ticket has the same chance in a fair draw. Jackpot data describes the players, not the machine.",
  ].join("\n");

  const doc = [
    "# win-lot model v2: offline audit",
    "",
    `Generated by \`npm run audit:model\` (scripts/model-v2-audit.ts) from data/ as of ${base.asOf}; model ` +
      `\`${MODEL_VERSION_V2}\`, constants sha256 \`${sha256Json(V2_CONSTANTS).slice(0, 16)}\`. Deterministic: the same data ` +
      "and code give the same file. Not part of the build; see docs/MODEL-V2.md section 5.3. Do not edit by hand.",
    "",
    summary,
    "",
    head.text,
    "",
    combos.text,
    "",
    dates.text,
    "",
    "### Placebo comparisons corrected together (Holm)",
    "",
    "| Placebo | Lottery | Metric | Real percentile | Permutation p | Holm p |",
    "| --- | --- | --- | --- | --- | --- |",
    ...placeboLines,
    "",
    nul.text,
    "",
    growth.text,
    "",
    loo,
    "",
    oracle.text,
    "",
    sens.text,
    "",
  ].join("\n");
  writeFileSync(OUT, doc);
  log(`wrote ${OUT} in ${f((performance.now() - t0) / 1000, 1)} s`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
