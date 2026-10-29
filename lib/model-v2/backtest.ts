// SPDX-License-Identifier: Apache-2.0
// Leakage-free walk-forward backtest of the v2 Top pick and its honest reporting (docs/MODEL-V2.md section 5).
//
// Window = v1's (start = max(BT_MIN, N - BT_DRAWS), stride 1), so the per-draw comparison with v1 is paired. Step t
// runs the production code path, posteriorAt(ctx, t, date(d_t)) then topPickAt, with the stream of step t; it sees
// only draws [0, t) and evidence known strictly before date(d_t). Nothing is warm-started. Chance levels use the
// live balls (k^2 / L_t), not the configured range. Constants are frozen: this is evaluation, never selection.

import type { BacktestDetail, HitStat, SourceSplit } from "../types";
import { r4 } from "../model";
import { holmAdjust } from "./calendar";
import { V2_CONSTANTS } from "./constants";
import { copyTiltText, holmText, powerText, verdictText, Z95, type CheckName, type HitJudgement } from "./explain";
import { posteriorAt, SOURCE_NAMES, type ModelContext, type Triple } from "./posterior";
import { streamAt, topPickAt, type GuardRung } from "./sets";

/** Letters a draw can carry under the game rules: A-Z, or the 12 zodiac signs (lib/lotteries.ts letter_kind). */
const LETTER_UNIVERSE: Readonly<Record<string, number>> = Object.freeze({ letter: 26, zodiac: 12 });

/**
 * The |z| whose two-sided normal p-value (normalP) is p, found by bisection on normalP itself, so a cut computed here
 * is the one the Holm test applies to the same z-scores (1.96 for p = 0.05, 0.8416 for p = 0.4). Deterministic.
 */
export function zForP(p: number): number {
  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (normalP(mid) > p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The power term of the minimum detectable effect: a true effect this far beyond a cut crosses it 4 times in 5. */
export const Z_POWER = zForP(0.4);

/**
 * The cut of the first Holm step at 5% over m checks: a check whose |z| is beyond it (two-sided p < 0.05 / m)
 * survives Holm whatever the other checks show (1.96 for 1 check, 2.50 for 4, 2.58 for 5, 2.69 for 7).
 */
export function holmFirstCut(m: number): number {
  return zForP(0.05 / Math.max(1, m));
}

/**
 * Standard errors of the minimum detectable effect (80% power) of a hit check judged among m checks: a true effect
 * of holmFirstCut(m) + Z_POWER SE survives Holm 4 times in 5 or more, so the verdict then says that the result stays
 * outside the usual range of luck after allowing for the m checks (3.34 for 4 checks, 3.42 for 5, 3.53 for 7). The
 * cut of the 95% range alone (1.96 + 0.84 = 2.8 SE, used before) gave an effect the verdict notices only 55-62% of the
 * time with 4-7 checks.
 */
export function mdeSE(m: number): number {
  return holmFirstCut(m) + Z_POWER;
}

/**
 * A check that starts with its evidence, the jackpot-number check and each source's lean check, joins the lottery's
 * checks (payload, Holm family, Holm note, site count, prebuild warning) only after this many test draws, the history
 * the backtest itself waits for (BT_MIN). Its normal p-value is far too small over a few draws: after a lottery's first
 * jackpot (4 numbers of 80), 2 shared numbers over 2 draws give z +2.65 and p 0.008, below Holm's 0.05 / 6, while 2 or
 * more turn up by luck 5.3% of the time. From 30 draws on, the true chance of crossing the Holm cut or the 95% range
 * stays within about 1.5 times the nominal one (docs/MODEL-V2.md 5.2, "Checks with too few draws").
 */
export const CHECK_MIN_STEPS = V2_CONSTANTS.BT_MIN;

/** The jackpot-number check also needs this many past-jackpot numbers expected by chance (a count's normal approximation). */
export const LIFT_MIN_EXPECTED = 5;

/** One step of the walk-forward (raw values, for the leakage and determinism tests). */
export interface StepRecord {
  t: number;
  drawNo: number;
  date: string;
  numbers: number[];
  letter: string | null;
  bonus: number | null;
  hits: number;
  orderHeld: boolean;
  filterChanged: boolean;
  theta: number[];
  parts: Triple<number[]>;
  share: Triple<number>;
  damping: Triple<number>;
  guard: GuardRung;
}

/** Raw sums of a walk-forward; backtestDetail() turns them into the payload, predictAllV2 pools them. */
export interface BacktestRun {
  lotteryId: string;
  /** First test index and number of test draws. */
  start: number;
  draws: number;
  from: string | null;
  to: string | null;
  /** Top-pick hits per test draw (paired with v1TopPickHits on the same window). */
  hits: number[];
  sumHits: number;
  /** sum k^2 / L_t and the null variance of the hit count, sum k (k/L)(1 - k/L)(L - k)/(L - 1). */
  sumExpected: number;
  sumVariance: number;
  /** Mean percentile of the drawn numbers in the theta ranking (skips out-of-domain draws). */
  rankSum: number;
  rankVariance: number;
  rankDraws: number;
  /** Ball log-score vs uniform over the live balls (skips out-of-domain draws). */
  logScoreSum: number;
  letter: { draws: number; hits: number; chance: number };
  bonus: { draws: number; hits: number; chance: number };
  copy: { steps: number; sum: number; expected: number; maxShared: number; maxUnion: number };
  jackpotNumbers: { drawn: number; expected: number; variance: number };
  sourceZ: Triple<number>;
  sourceVariance: Triple<number>;
  /** Test steps that entered sourceZ: the source was present with parts that are not all equal. */
  sourceSteps: Triple<number>;
  orderHeld: number;
  filterChanged: number;
  outOfDomain: number;
  jackpotDrawHits: { drawNo: number; date: string; hits: number }[];
  /** Step records, only when requested. */
  records: StepRecord[] | null;
}

/** Window start of the v1 backtest (BT_MIN and BT_DRAWS equal v1's constants). */
export function backtestStart(total: number): number {
  return Math.max(V2_CONSTANTS.BT_MIN, total - V2_CONSTANTS.BT_DRAWS);
}

/** Walk-forward over [start, N): the Top pick of step t against draw t. */
export function walkForward(ctx: ModelContext, options: { records?: boolean } = {}): BacktestRun {
  const N = ctx.history.length;
  const start = backtestStart(N);
  const { k, lo } = ctx;
  const run: BacktestRun = {
    lotteryId: ctx.id,
    start,
    draws: Math.max(0, N - start),
    from: start < N ? ctx.dates[start] : null,
    to: start < N ? ctx.dates[N - 1] : null,
    hits: [],
    sumHits: 0,
    sumExpected: 0,
    sumVariance: 0,
    rankSum: 0,
    rankVariance: 0,
    rankDraws: 0,
    logScoreSum: 0,
    letter: { draws: 0, hits: 0, chance: 0 },
    bonus: { draws: 0, hits: 0, chance: 0 },
    copy: { steps: 0, sum: 0, expected: 0, maxShared: 0, maxUnion: 0 },
    jackpotNumbers: { drawn: 0, expected: 0, variance: 0 },
    sourceZ: [0, 0, 0],
    sourceVariance: [0, 0, 0],
    sourceSteps: [0, 0, 0],
    orderHeld: 0,
    filterChanged: 0,
    outOfDomain: 0,
    jackpotDrawHits: [],
    records: options.records ? [] : null,
  };
  if (start >= N) return run;
  const past = new Set<number>();
  for (let i = 0; i < start; i++) if (ctx.keys[i] >= 0) past.add(ctx.keys[i]);
  const jackpotIndex = new Set(ctx.items.filter((it) => it.index >= 0).map((it) => it.index));
  // A game rule, not data (so no leakage): under fair draws any guess hits the letter 1 time in |universe|, whatever
  // letters have been seen so far (U_t holds only those). More letters seen than the rule allows: 1 / |U_t|.
  const letterUniverse = LETTER_UNIVERSE[ctx.lottery.letter_kind] ?? 0;

  for (let t = start; t < N; t++) {
    const date = ctx.dates[t];
    const post = posteriorAt(ctx, t, date);
    const stream = streamAt(ctx, post);
    const top = topPickAt(ctx, post, stream, past);
    const drawn = ctx.history[t];
    const L = post.regime.count;
    const live = post.regime.live;
    const theta = post.num.theta;

    let h = 0;
    for (const n of drawn) if (top.numbers.includes(n)) h++;
    run.hits.push(h);
    run.sumHits += h;
    run.sumExpected += (k * k) / L;
    run.sumVariance += ((k * k) / L) * (1 - k / L) * ((L - k) / (L - 1));

    const outOfDomain = drawn.some((n) => n < lo || n > ctx.hi || !live[n - lo]);
    if (outOfDomain) run.outOfDomain++;
    else {
      // Rank percentile (rank + 0.5) / L of the drawn numbers; null variance (L + 1)(L - k) / (12 L^2 k) per draw.
      const order: number[] = [];
      for (let j = 0; j < live.length; j++) if (live[j]) order.push(j);
      order.sort((a, b) => theta[b] - theta[a] || stream.numberKeys[a] - stream.numberKeys[b] || a - b);
      const rankOf = new Int32Array(live.length).fill(-1);
      order.forEach((j, r) => (rankOf[j] = r));
      let pct = 0;
      for (const n of drawn) pct += (rankOf[n - lo] + 0.5) / L;
      run.rankSum += pct / k;
      run.rankVariance += ((L + 1) * (L - k)) / (12 * L * L * k);
      run.rankDraws++;
      // Ball log-score vs uniform over the live balls, q = clamp(k theta).
      const q0 = k / L;
      let ls = 0;
      for (let j = 0; j < live.length; j++) {
        if (!live[j]) continue;
        const q = Math.min(1 - 1e-9, Math.max(1e-9, k * theta[j]));
        ls += drawn.includes(lo + j) ? Math.log(q / q0) : Math.log((1 - q) / (1 - q0));
      }
      run.logScoreSum += ls;
    }

    const letter = ctx.letters[t];
    if (post.letter && letter) {
      run.letter.draws++;
      run.letter.chance += 1 / Math.max(post.letters.length, letterUniverse);
      if (top.letter === letter) run.letter.hits++;
    }
    const bonus = ctx.intBonus[t];
    if (post.bonus && bonus !== null) {
      run.bonus.draws++;
      run.bonus.chance += 1 / post.bonusCount;
      if (top.bonus === bonus) run.bonus.hits++;
    }

    if (post.combos.length) {
      const union = post.union;
      const fromUnion = top.numbers.filter((n) => union.includes(n)).length;
      run.copy.steps++;
      run.copy.sum += fromUnion;
      run.copy.expected += (k * union.length) / L;
      run.copy.maxUnion = Math.max(run.copy.maxUnion, fromUnion);
      for (const combo of post.combos) {
        run.copy.maxShared = Math.max(run.copy.maxShared, top.numbers.filter((n) => combo.includes(n)).length);
      }
      const pu = union.length / L;
      run.jackpotNumbers.drawn += drawn.filter((n) => union.includes(n)).length;
      run.jackpotNumbers.expected += k * pu;
      run.jackpotNumbers.variance += k * pu * (1 - pu) * ((L - k) / (L - 1));
    }

    for (let s = 0; s < 3; s++) {
      if (!post.num.present[s]) continue;
      const parts = post.num.parts[s];
      let mean = 0;
      for (let j = 0; j < live.length; j++) if (live[j]) mean += parts[j];
      mean /= L;
      let sd = 0;
      for (let j = 0; j < live.length; j++) if (live[j]) sd += (parts[j] - mean) ** 2;
      sd = Math.sqrt(sd / L);
      if (!(sd > 1e-15)) continue;
      let z = 0;
      for (const n of drawn) if (n >= lo && n <= ctx.hi && live[n - lo]) z += (parts[n - lo] - mean) / sd;
      run.sourceZ[s] += z;
      run.sourceVariance[s] += (k * (L - k)) / (L - 1);
      run.sourceSteps[s]++;
    }

    if (top.orderHeld) run.orderHeld++;
    if (top.filterChanged) run.filterChanged++;
    if (jackpotIndex.has(t)) run.jackpotDrawHits.push({ drawNo: ctx.drawNos[t], date, hits: h });
    if (run.records) {
      run.records.push({
        t,
        drawNo: ctx.drawNos[t],
        date,
        numbers: top.numbers,
        letter: top.letter,
        bonus: top.bonus,
        hits: h,
        orderHeld: top.orderHeld,
        filterChanged: top.filterChanged,
        theta: Array.from(theta),
        parts: [Array.from(post.num.parts[0]), Array.from(post.num.parts[1]), Array.from(post.num.parts[2])],
        share: [...post.num.share],
        damping: [...post.num.damping],
        guard: post.guard,
      });
    }
    if (ctx.keys[t] >= 0) past.add(ctx.keys[t]);
  }
  return run;
}

// ---------------------------------------------------------------- statistics

/** Standard normal two-sided p-value (Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalP(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return Math.min(1, Math.max(0, 2 * (1 - 0.5 * (1 + y))));
}

/** Holm at 5% over a family of z-scores: {tests, smallest raw two-sided p, does any test survive}. */
export function holmSummary(zs: readonly number[]): { tests: number; minP: number; anySignificant: boolean } {
  const ps = zs.map(normalP).sort((a, b) => a - b);
  let anySignificant = false;
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] < 0.05 / (ps.length - i)) anySignificant = true;
    else break;
  }
  return { tests: ps.length, minP: ps.length ? ps[0] : 1, anySignificant };
}

function hitStat(avg: number, se: number): HitStat {
  return { avgHits: r4(avg), lo: r4(avg - 1.96 * se), hi: r4(avg + 1.96 * se) };
}

/** Paired difference of v2 and v1 hits on identical draws: mean and z = mean / (sd / sqrt(n)). */
export function pairedStats(v2: readonly number[], v1: readonly number[]): { diff: number; z: number } {
  const n = v2.length;
  if (n < 2) return { diff: n ? v2[0] - v1[0] : 0, z: 0 };
  const d = v2.map((h, i) => h - v1[i]);
  const mean = d.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1));
  return { diff: mean, z: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0 };
}

/** The headline z of a run: (sum hits - sum k^2/L) / sqrt(null variance). */
export function hitZ(run: BacktestRun): number {
  return run.sumVariance > 0 ? (run.sumHits - run.sumExpected) / Math.sqrt(run.sumVariance) : 0;
}

/**
 * The jackpot-number check: past jackpot numbers drawn vs expected by chance (hypergeometric), or null until it has
 * CHECK_MIN_STEPS test draws with a usable combination and LIFT_MIN_EXPECTED numbers expected over them.
 */
export function jackpotNumbersCheckZ(run: BacktestRun): number | null {
  const jn = run.jackpotNumbers;
  if (run.copy.steps < CHECK_MIN_STEPS || jn.expected < LIFT_MIN_EXPECTED || !(jn.variance > 0)) return null;
  return (jn.drawn - jn.expected) / Math.sqrt(jn.variance);
}

/** Source s's lean check, or null until that source moved the picks on CHECK_MIN_STEPS test draws. */
export function sourceCheckZ(run: BacktestRun, s: number): number | null {
  if (run.sourceSteps[s] < CHECK_MIN_STEPS || !(run.sourceVariance[s] > 0)) return null;
  return run.sourceZ[s] / Math.sqrt(run.sourceVariance[s]);
}

/**
 * Every z reported for one lottery (its Holm family), named; the hit check is always first. A check with too few test
 * draws behind it (CHECK_MIN_STEPS) is not formed, so it is not reported, counted or judged.
 */
export function lotteryChecks(run: BacktestRun, v1Hits: readonly number[]): { check: CheckName; z: number }[] {
  const out: { check: CheckName; z: number }[] = [
    { check: "hits", z: hitZ(run) },
    { check: "previousModel", z: pairedStats(run.hits, v1Hits).z },
  ];
  if (run.rankDraws) out.push({ check: "rank", z: (run.rankSum - run.rankDraws / 2) / Math.sqrt(run.rankVariance) });
  const jn = jackpotNumbersCheckZ(run);
  if (jn !== null) out.push({ check: "jackpotNumbers", z: jn });
  for (let s = 0; s < 3; s++) {
    const z = sourceCheckZ(run, s);
    if (z !== null) out.push({ check: SOURCE_NAMES[s], z });
  }
  return out;
}

/** Every z reported for one lottery (for its Holm family). */
export function lotteryZs(run: BacktestRun, v1Hits: readonly number[]): number[] {
  return lotteryChecks(run, v1Hits).map((c) => c.z);
}

/** The texts' view of one lottery's backtest (see holmView). */
export interface HolmView {
  /** The hit result: its 95% range (unrounded), the checks of this lottery and whether the hit check survives Holm. */
  judgement: HitJudgement;
  /** The most unusual check (largest |z|; ties keep the first) and whether it survives Holm over this lottery's checks. */
  top: { check: CheckName; z: number; survives: boolean };
  tests: number;
}

/**
 * The texts' view of one lottery's Holm family: the hit judgement (95% range, checks, does the hit check survive
 * Holm) and the most unusual check, with its Holm-adjusted survival. Needs run.draws > 0.
 */
export function holmView(run: BacktestRun, v1Hits: readonly number[]): HolmView {
  const se = Math.sqrt(run.sumVariance) / run.draws;
  const diff = run.sumHits / run.draws - run.sumExpected / run.draws;
  // Exactly the payload's backtestDetail.ci95 (r4), so a text never disagrees with the range printed next to it.
  const ci95: [number, number] = [r4(diff - Z95 * se), r4(diff + Z95 * se)];
  const checks = lotteryChecks(run, v1Hits);
  const adjusted = holmAdjust(checks.map((c) => normalP(c.z)));
  let top = 0;
  for (let i = 1; i < checks.length; i++) if (Math.abs(checks[i].z) > Math.abs(checks[top].z)) top = i;
  return {
    judgement: { ci95, tests: checks.length, survives: adjusted[0] < 0.05 },
    top: { ...checks[top], survives: adjusted[top] < 0.05 },
    tests: checks.length,
  };
}

/** The payload's backtestDetail for one lottery (pooled, holmAll and pooledMdeShare are attached by predictAllV2). */
export function backtestDetail(
  run: BacktestRun,
  v1Hits: readonly number[],
  name: string,
  guard: { perCombination: number },
): BacktestDetail {
  const n = run.draws;
  const se = Math.sqrt(run.sumVariance) / n;
  const avg = run.sumHits / n;
  const base = run.sumExpected / n;
  const v1Avg = v1Hits.reduce((s, h) => s + h, 0) / n;
  const paired = pairedStats(run.hits, v1Hits);
  const z = hitZ(run);
  const ci95: [number, number] = [r4(avg - base - Z95 * se), r4(avg - base + Z95 * se)];
  // Exactly the checks of the Holm family (lotteryChecks): a check with too few test draws is null or left out.
  const sourceZ: Partial<SourceSplit> = {};
  for (let s = 0; s < 3; s++) {
    const zSource = sourceCheckZ(run, s);
    if (zSource !== null) sourceZ[SOURCE_NAMES[s]] = r4(zSource);
  }
  const jnZ = jackpotNumbersCheckZ(run);
  const zs = lotteryZs(run, v1Hits);
  const holm = holmSummary(zs);
  const view = holmView(run, v1Hits);
  // At the cut the verdict uses: the first Holm step over this lottery's checks (view.tests = holm.tests).
  const mdeShare = (mdeSE(view.tests) * Math.sqrt(run.sumVariance)) / run.sumExpected;
  const copyTilt = run.copy.steps
    ? {
        steps: run.copy.steps,
        avgPastJackpotNumbers: r4(run.copy.sum / run.copy.steps),
        random: r4(run.copy.expected / run.copy.steps),
        maxSharedWithOne: run.copy.maxShared,
        maxFromUnion: run.copy.maxUnion,
      }
    : null;
  return {
    draws: n,
    from: run.from,
    to: run.to,
    v2: hitStat(avg, se),
    random: hitStat(base, se),
    v1: { ...hitStat(v1Avg, se), pairedDiff: r4(paired.diff), pairedZ: r4(paired.z) },
    z: r4(z),
    ci95,
    rank: {
      pct: r4(run.rankDraws ? run.rankSum / run.rankDraws : 0.5),
      z: r4(run.rankDraws ? (run.rankSum - run.rankDraws / 2) / Math.sqrt(run.rankVariance) : 0),
    },
    logScoreNats: r4(run.rankDraws ? run.logScoreSum / run.rankDraws : 0),
    letter: run.letter.draws ? { hitRate: r4(run.letter.hits / run.letter.draws), chance: r4(run.letter.chance / run.letter.draws) } : null,
    bonus: run.bonus.draws ? { hitRate: r4(run.bonus.hits / run.bonus.draws), chance: r4(run.bonus.chance / run.bonus.draws) } : null,
    lifts: {
      jackpotNumbersZ: jnZ === null ? null : r4(jnZ),
      sourceZ,
    },
    copyTilt,
    orderHeld: { steps: n, held: run.orderHeld, filterChanged: run.filterChanged },
    jackpotDrawHits: run.jackpotDrawHits,
    outOfDomain: run.outOfDomain,
    pooled: null,
    holm: { tests: holm.tests, minP: r4(holm.minP), anySignificant: holm.anySignificant },
    holmAll: null,
    power: { mdeShare: r4(mdeShare), pooledMdeShare: null },
    text: {
      verdict: verdictText({ name, draws: n, avg, base, v1: v1Avg, judgement: view.judgement }),
      // The payload's r4 value, so the sentence and the figure shown next to it always agree.
      power: powerText(n, r4(mdeShare), view.tests),
      // The same cut as the 95% range: a note whenever some check of this lottery lands outside its range.
      holm: holmNote(view, null),
      copyTilt: copyTilt ? copyTiltText(run.copy.sum / run.copy.steps, run.copy.expected / run.copy.steps, guard.perCombination) : null,
    },
  };
}

/** The Holm note of a lottery, or null when every check of it lies inside its 95% range (|z| <= Z95). */
export function holmNote(view: HolmView, siteChecks: number | null): string | null {
  if (!(Math.abs(view.top.z) > Z95) && !view.top.survives) return null;
  return holmText({ check: view.top.check, tests: view.tests, survives: view.top.survives, siteChecks });
}

/** Pooled summary over several lotteries (all test draws together). */
export interface PooledSummary {
  lotteries: number;
  draws: number;
  sumHits: number;
  sumExpected: number;
  sumVariance: number;
  sumV1: number;
  diffSum: number;
  diffSquares: number;
  rankSum: number;
  rankDraws: number;
  rankVariance: number;
}

export function poolRuns(runs: readonly { run: BacktestRun; v1Hits: readonly number[] }[]): PooledSummary {
  const p: PooledSummary = {
    lotteries: 0,
    draws: 0,
    sumHits: 0,
    sumExpected: 0,
    sumVariance: 0,
    sumV1: 0,
    diffSum: 0,
    diffSquares: 0,
    rankSum: 0,
    rankDraws: 0,
    rankVariance: 0,
  };
  for (const { run, v1Hits } of runs) {
    if (!run.draws) continue;
    p.lotteries++;
    p.draws += run.draws;
    p.sumHits += run.sumHits;
    p.sumExpected += run.sumExpected;
    p.sumVariance += run.sumVariance;
    run.hits.forEach((h, i) => {
      const d = h - v1Hits[i];
      p.sumV1 += v1Hits[i];
      p.diffSum += d;
      p.diffSquares += d * d;
    });
    p.rankSum += run.rankSum;
    p.rankDraws += run.rankDraws;
    p.rankVariance += run.rankVariance;
  }
  return p;
}

/**
 * The payload's `pooled` block, the pooled z and the pooled minimum detectable effect, taken at the first Holm cut over
 * `checks`, the family the pooled result is judged in: the headline hit checks of all lotteries (holmAll.tests).
 */
export function pooledDetail(p: PooledSummary, checks: number): {
  pooled: NonNullable<BacktestDetail["pooled"]>;
  z: number;
  mdeShare: number;
  avg: number;
  base: number;
} {
  const n = p.draws;
  const se = Math.sqrt(p.sumVariance) / n;
  const avg = p.sumHits / n;
  const base = p.sumExpected / n;
  const z = (p.sumHits - p.sumExpected) / Math.sqrt(p.sumVariance);
  const dm = p.diffSum / n;
  const dsd = Math.sqrt((p.diffSquares - n * dm * dm) / (n - 1));
  const pairedZ = dsd > 0 ? dm / (dsd / Math.sqrt(n)) : 0;
  const rankZ = p.rankDraws ? (p.rankSum - p.rankDraws / 2) / Math.sqrt(p.rankVariance) : 0;
  return {
    pooled: {
      lotteries: p.lotteries,
      draws: n,
      v2: hitStat(avg, se),
      random: hitStat(base, se),
      v1: hitStat(p.sumV1 / n, se),
      z: r4(z),
      pairedZ: r4(pairedZ),
      rankZ: r4(rankZ),
    },
    z,
    mdeShare: (mdeSE(checks) * Math.sqrt(p.sumVariance)) / p.sumExpected,
    avg,
    base,
  };
}
