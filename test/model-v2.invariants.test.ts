// SPDX-License-Identifier: Apache-2.0
// Invariants of win-lot-jackpot-v2 (docs/MODEL-V2.md sections 2.9-2.15, 3.3, 3.4 and 6) on real data (all 7
// lotteries, through predictAllV2 as in the build) and on synthetic evidence growth (Dhana Nidhanaya with 0, 1, 3, 10,
// 30 and 100 own combinations = random earlier draws, plus their dates). The rules are re-implemented from the spec in
// test/helpers/v2-rules.ts, so the model is checked against the spec, not against its own helpers.
import { beforeAll, describe, expect, it } from "vitest";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERIES, LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { mulberry32, r4 } from "../lib/model";
import {
  addDays,
  buildContext,
  decadeOf,
  knownFrom,
  leanOf,
  posteriorAt,
  predictAllV2,
  predictV2,
  streamAt,
  walkForward,
  type Channel,
  type Posterior,
} from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import type { Prediction } from "../lib/types";
import { loadDraws, loadJackpots, loadV2Inputs, syntheticCombinations, v2Input, withOwnItems } from "../scripts/model-v2-data";
import {
  SPEC,
  brokenRules,
  dateClusters,
  guardRungSpec,
  liveBallsAt,
  numbersIn,
  pastResults,
  regimeStartAt,
  shapeBins,
  shared,
  sourceMoves,
  specViewCards,
  usableCombos,
} from "./helpers/v2-rules";

const TIMEOUT = 120_000;

/**
 * Spec 3.4: at most 24 KiB (24,576 bytes of minified UTF-8 JSON) per lottery on real data. evidence.used is the one
 * list that grows linearly with the evidence (about 108 bytes per jackpot item, by design), so a synthetic
 * evidence-growth case may use 128 more bytes per item of evidence.used: 24,576 + 128 x |evidence.used|.
 */
const SIZE_BUDGET = 24 * 1024;
const SIZE_PER_USED_ITEM = 128;

/** Spec 2.15: the five card labels, always these, in this order. */
const CARD_LABELS = ["Top pick", "Jackpot pattern", "Jackpot days", "Daily draws", "Lucky dip"];

const GROWTH = [0, 1, 3, 10, 30, 100];
const DHANA = LOTTERY_BY_ID["dhana-nidhanaya"];

interface Case {
  key: string;
  lottery: Lottery;
  draws: Draw[];
  jackpots: Jackpot[];
  real: boolean;
  payload: Prediction;
  v1: Prediction;
}

const JACKPOTS = loadJackpots();
const cases = new Map<string, Case>();

beforeAll(() => {
  const inputs = loadV2Inputs(JACKPOTS);
  const all = predictAllV2(inputs);
  for (const input of inputs) {
    const id = input.lottery.id;
    cases.set(id, { key: id, lottery: input.lottery, draws: input.draws, jackpots: JACKPOTS, real: true, payload: all[id], v1: input.v1 });
  }
  const draws = loadDraws(DHANA.id);
  for (const n of GROWTH) {
    const jackpots = withOwnItems(JACKPOTS, DHANA.id, syntheticCombinations(DHANA, draws, n, 1));
    const input = v2Input(DHANA, draws, jackpots, "2026-10-28T00:00:00Z");
    cases.set(`growth-${n}`, { key: `growth-${n}`, lottery: DHANA, draws, jackpots, real: false, payload: predictV2(input), v1: input.v1 });
  }
}, TIMEOUT);

const KEYS = [...LOTTERIES.map((l) => l.id), ...GROWTH.map((n) => `growth-${n}`)];

function get(key: string): Case {
  const c = cases.get(key);
  if (!c) throw new Error(`no payload for ${key}`);
  return c;
}

/** Violations of the order cap (2.9), the lean bounds and the exact parts (2.10) in one channel. */
function channelViolations(name: string, ch: Channel): string[] {
  const out: string[] = [];
  const present = [0, 1, 2].filter((s) => ch.present[s]);
  for (let s = 0; s < 3; s++) {
    if (!(ch.damping[s] >= 0 && ch.damping[s] <= 1)) out.push(`${name}: damping[${s}] = ${ch.damping[s]}`);
    if (!ch.present[s] && ch.share[s] !== 0) out.push(`${name}: absent source ${s} has share ${ch.share[s]}`);
  }
  for (let q = 0; q + 1 < present.length; q++) {
    const upper = present[q];
    const lower = present[q + 1];
    const eu = ch.damping[upper] * ch.pull[upper];
    const el = ch.damping[lower] * ch.pull[lower];
    if (el > SPEC.ORDER * eu * (1 + 1e-12) + 1e-300) out.push(`${name}: pull ${lower} = ${el} > 0.75 x pull ${upper} = ${eu}`);
    if (ch.share[lower] > SPEC.ORDER * ch.share[upper] + 1e-12) {
      out.push(`${name}: influence ${lower} = ${ch.share[lower]} > 0.75 x influence ${upper} = ${ch.share[upper]}`);
    }
  }
  const shareSum = ch.share[0] + ch.share[1] + ch.share[2];
  if (!(shareSum === 0 || Math.abs(shareSum - 1) < 1e-12)) out.push(`${name}: shares sum to ${shareSum}`);
  let thetaSum = 0;
  for (let x = 0; x < ch.p0.length; x++) {
    thetaSum += ch.theta[x];
    if (ch.p0[x] <= 0) {
      if (ch.theta[x] !== 0 || ch.parts.some((p) => p[x] !== 0)) out.push(`${name}[${x}]: dead category moved`);
      continue;
    }
    const lean = leanOf(ch, x);
    if (!(lean >= 2 - SPEC.MAX_LIFT - 1e-12 && lean <= SPEC.MAX_LIFT + 1e-12)) out.push(`${name}[${x}]: lean ${lean}`);
    const parts = ch.parts[0][x] + ch.parts[1][x] + ch.parts[2][x];
    if (!(Math.abs(parts - (lean - 1)) <= 1e-12)) out.push(`${name}[${x}]: parts ${parts} != lean - 1 = ${lean - 1}`);
  }
  if (!(Math.abs(thetaSum - 1) <= 1e-12)) out.push(`${name}: theta sums to ${thetaSum}`);
  return out;
}

/** The inputs of the spec re-implementation of the view cards (test/helpers/v2-rules.ts specViewCards) for a case. */
function viewCardInput(c: Case) {
  const { payload: p, lottery, draws, jackpots } = c;
  const ctx = buildContext(lottery, draws, jackpots);
  const N = draws.length;
  const post = posteriorAt(ctx, N, p.nextDrawDate);
  const stream = streamAt(ctx, post);
  const live = liveBallsAt(draws.map((d) => d.numbers), lottery.main_min, lottery.main_max, lottery.main_count, N);
  const combos = usableCombos(lottery.id, jackpots, draws, p.nextDrawDate, live);
  return {
    post,
    keys: { numbers: stream.numberKeys, letters: stream.letterKeys, bonus: stream.bonusKeys },
    lo: lottery.main_min,
    live,
    combos,
    rung: guardRungSpec(live.length, combos),
    past: pastResults(draws, N),
    top: p.sets[0].numbers,
    topLetter: p.sets[0].letter,
    topBonus: p.sets[0].bonus as number | null,
  };
}

const SOURCE_KEYS = ["jackpotCombinations", "jackpotDates", "dailyDraws"] as const;

function posteriorViolations(post: Posterior, lo: number): string[] {
  const out = [
    ...channelViolations("num", post.num),
    ...(post.letter ? channelViolations("letter", post.letter) : []),
    ...(post.bonus ? channelViolations("bonus", post.bonus) : []),
    ...channelViolations("odd", post.odd),
    ...channelViolations("spread", post.spread),
  ];
  // EXACT = 0: the J number part is constant within each decade of live balls.
  const byDecade = new Map<number, number>();
  post.regime.live.forEach((isLive, j) => {
    if (!isLive) return;
    const g = decadeOf(lo + j);
    const v = post.num.parts[0][j];
    if (!byDecade.has(g)) byDecade.set(g, v);
    else if (byDecade.get(g) !== v) out.push(`num: J part not constant in decade ${g}`);
  });
  if (!(post.guard.excludedShare <= SPEC.GUARD_ALPHA)) out.push(`guard excludes ${post.guard.excludedShare}`);
  return out;
}

describe.each(KEYS)("%s", (key) => {
  it("payload: no NaN or Infinity, every float equals r4 of itself, existing fields keep their meaning", () => {
    const { payload: p, lottery, draws } = get(key);
    const bad = numbersIn(p).filter(({ value }) => !Number.isFinite(value) || r4(value) !== value);
    expect(bad).toEqual([]);
    expect(p.modelVersion).toBe("win-lot-jackpot-v2");
    expect(p.lotteryId).toBe(lottery.id);
    expect(p.basedOnDraws).toBe(draws.length);
    expect(p.nextDrawNo).toBe(draws[draws.length - 1].draw_no + 1);
    expect(p.sets).toHaveLength(5);
    expect(p.sets.map((s) => s.source)).toEqual(["all", "jackpotCombinations", "jackpotDates", "dailyDraws", "luckyDip"]);
    for (const s of p.sets) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
      expect(s.numbers).toEqual([...s.numbers].sort((a, b) => a - b));
    }
    expect(p.numberScores.map((s) => s.n)).toEqual(
      Array.from({ length: lottery.main_max - lottery.main_min + 1 }, (_, i) => lottery.main_min + i),
    );
    for (const s of p.numberScores) expect(s.score >= 0 && s.score <= 1).toBe(true);
    expect(Object.keys(p.backtest).sort()).toEqual(["avgHits", "draws", "randomBaseline"]);
  });

  it(
    "order cap in every channel, damping in [0, 1], leans in [0.75, 1.25], exact parts: production and every walk-forward step",
    () => {
      const { payload: p, lottery, draws, jackpots } = get(key);
      const ctx = buildContext(lottery, draws, jackpots);
      const N = draws.length;
      const post = posteriorAt(ctx, N, p.nextDrawDate);
      expect(posteriorViolations(post, ctx.lo)).toEqual([]);
      // The payload is the r4 of this posterior.
      const split = (v: number[]) => ({ jackpotCombinations: r4(v[0]), jackpotDates: r4(v[1]), dailyDraws: r4(v[2]) });
      expect(p.influence!.numbers).toEqual(split(post.num.share));
      expect(p.influence!.odd).toEqual(split(post.odd.share));
      expect(p.influence!.spread).toEqual(split(post.spread.share));
      expect(p.influence!.letters).toEqual(post.letter ? split(post.letter.share) : null);
      expect(p.influence!.bonus).toEqual(post.bonus ? split(post.bonus.share) : null);
      expect(p.damping!.numbers).toEqual(split(post.num.damping));
      for (const x of p.numberLean!) {
        expect(x.lean).toBe(r4(leanOf(post.num, x.n - ctx.lo)));
        expect(x.lean >= 0.75 && x.lean <= 1.25).toBe(true);
        expect(Math.abs(x.j + x.t + x.d - (x.lean - 1))).toBeLessThanOrEqual(2.5e-4); // four r4 roundings
      }
      for (const lean of [...(p.letterLean ?? []), ...(p.bonusLean ?? [])]) {
        expect(lean.lean >= 0.75 && lean.lean <= 1.25).toBe(true);
        expect(Math.abs(lean.j + lean.t + lean.d - (lean.lean - 1))).toBeLessThanOrEqual(2.5e-4);
      }
      for (const f of p.shapeLean!) for (const b of f.bins) expect(b.lean >= 0.75 && b.lean <= 1.25).toBe(true);
      // Payload-level order over each channel's present sources (r4 values).
      const massPresent = [p.evidence!.mass.jackpotCombinations, p.evidence!.mass.jackpotDates, p.evidence!.mass.dailyDraws].map((m) => m > 0);
      expect(massPresent).toEqual([...post.num.present]);
      const channels = [
        [p.influence!.numbers, post.num],
        [p.influence!.odd, post.odd],
        [p.influence!.spread, post.spread],
        [p.influence!.letters, post.letter],
        [p.influence!.bonus, post.bonus],
      ] as const;
      for (const [sp, ch] of channels) {
        if (!sp || !ch) continue;
        const present = ch.present;
        const v = [sp.jackpotCombinations, sp.jackpotDates, sp.dailyDraws];
        const pr = [0, 1, 2].filter((s) => present[s]);
        for (let q = 0; q + 1 < pr.length; q++) expect(v[pr[q + 1]]).toBeLessThanOrEqual(SPEC.ORDER * v[pr[q]] + 1e-4);
        for (let s = 0; s < 3; s++) if (!present[s]) expect(v[s]).toBe(0);
      }
      // Every walk-forward step (the backtest runs the same code path).
      const start = Math.max(30, N - 200);
      const bad: string[] = [];
      for (let t = start; t < N; t++) {
        for (const v of posteriorViolations(posteriorAt(ctx, t, draws[t].draw_date), ctx.lo)) bad.push(`t=${t} ${v}`);
      }
      expect(bad).toEqual([]);
    },
    TIMEOUT,
  );

  it("payload fields follow their definitions (score, numberScores, set parts and order, weights, v1 block, baseline)", () => {
    const { payload: p, lottery, draws, jackpots, v1 } = get(key);
    const ctx = buildContext(lottery, draws, jackpots);
    const post = posteriorAt(ctx, draws.length, p.nextDrawDate);
    const lo = ctx.lo;
    const live: number[] = [];
    post.regime.live.forEach((v, j) => v && live.push(lo + j));
    const theta = (n: number) => post.num.theta[n - lo];
    const min = Math.min(...live.map(theta));
    const max = Math.max(...live.map(theta));
    const norm = (n: number) => (max > min ? (theta(n) - min) / (max - min) : 0.5);
    // numberScores (existing field): r4 of the min-max of theta over live numbers; dead numbers 0.
    expect(p.numberScores).toEqual(p.numberScores.map(({ n }) => ({ n, score: live.includes(n) ? r4(norm(n)) : 0 })));
    const present = post.num.present;
    for (const s of p.sets) {
      // score (existing field, 0..1): the mean normalised theta of the set's numbers (v1 convention).
      expect(s.score).toBe(r4(s.numbers.reduce((a, n) => a + norm(n), 0) / s.numbers.length));
      // parts: number parts plus the odd and spread parts of the set's bins (bins recomputed from the spec).
      const bins = shapeBins(s.numbers, live);
      const raw = [0, 1, 2].map((src) => {
        let v = post.odd.parts[src][bins.odd] + post.spread.parts[src][bins.spread];
        for (const n of s.numbers) v += post.num.parts[src][n - lo];
        return v;
      });
      expect(s.parts).toEqual({ jackpotCombinations: r4(raw[0]), jackpotDates: r4(raw[1]), dailyDraws: r4(raw[2]) });
      const pr = [0, 1, 2].filter((src) => present[src]);
      const ordered = pr.every((src, q) => q === 0 || raw[pr[q - 1]] >= raw[src] - 1e-12);
      if (s.source !== "all") expect(s.orderHeld).toBe(ordered);
      else if (s.orderHeld) expect(ordered).toBe(true);
      for (const src of [0, 1, 2]) if (!present[src]) expect(raw[src]).toBe(0);
    }
    expect(p.weights).toEqual({ jackpotCombination: 12, jackpotDate: 4, dailyDraw: 1, orderRatio: 0.75, maxLean: 1.25, jackpotPrior: 2 });
    expect(p.evidence!.asOf).toBe(p.nextDrawDate);
    expect(p.patternLean).toBe(r4(50 * live.reduce((a, n) => a + Math.abs(theta(n) - 1 / live.length), 0)));
    // The previous model appears unchanged, with the honest chance level next to its own.
    expect(p.previousModel!.modelVersion).toBe("win-lot-heuristic-v1");
    expect(p.previousModel!.sets).toEqual(v1.sets);
    expect(p.previousModel!.backtest).toEqual(v1.backtest);
    expect(p.previousModel!.honestRandomBaseline).toBe(p.backtest.randomBaseline);
    // backtest.randomBaseline = mean over the test steps of k^2 / L_t (live balls at each step).
    const N = draws.length;
    const start = Math.max(30, N - 200);
    const history = draws.map((d) => d.numbers);
    let sum = 0;
    for (let t = start; t < N; t++) sum += 16 / liveBallsAt(history, lottery.main_min, lottery.main_max, 4, t).length;
    expect(p.backtest.randomBaseline).toBe(r4(sum / (N - start)));
    expect(p.backtestDetail!.random.avgHits).toBe(p.backtest.randomBaseline);
    expect(p.backtestDetail!.v2.avgHits).toBe(p.backtest.avgHits);
  });

  it("live balls, evidence counts and the partition rule follow the spec definitions", () => {
    const { payload: p, lottery, draws, jackpots } = get(key);
    const { main_min: lo, main_max: hi, main_count: k } = lottery;
    const N = draws.length;
    const history = draws.map((d) => d.numbers);
    const live = liveBallsAt(history, lo, hi, k, N);
    const r = regimeStartAt(history, lo, hi, k, N);
    expect(p.liveBalls!.count).toBe(live.length);
    expect(p.liveBalls!.excluded).toEqual(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((n) => !live.includes(n)));
    expect(p.liveBalls!.since).toBe(draws[r].draw_date);
    const tau = p.nextDrawDate;
    const combos = usableCombos(lottery.id, jackpots, draws, tau, live);
    const c = p.evidence!.counts;
    expect(c.jackpotCombinations.used).toBe(combos.length);
    // Partition rule: a usable combination's draw counts once, as a combination, never as a daily draw.
    const index = new Map(draws.map((d, i) => [d.draw_no, i] as const));
    const dated = draws.map((d) => ({ drawNo: d.draw_no, date: d.draw_date }));
    const usable = jackpots.filter((j) => {
      if (j.lotteryId !== lottery.id) return false;
      const known = knownFrom(j, dated);
      return known !== null && known < tau;
    });
    const usableCombosIdx = usable.filter((j) => j.numbers !== null).map((j) => index.get(j.drawNo) ?? -1);
    const excluded = new Set(usableCombosIdx.filter((i) => i >= r)).size;
    expect(c.jackpotDates.used).toBe(usable.filter((j) => j.date !== null).length);
    // Each de-clustered cluster of dates counts as one independent date: n_eff = number of clusters (2.7 a).
    expect(c.jackpotDates.clusters).toBe(dateClusters(usable.filter((j) => j.date !== null).map((j) => j.date as string)));
    expect(c.jackpotDates.effective).toBe(c.jackpotDates.clusters);
    expect(c.dailyDraws.excludedAsJackpot).toBe(excluded);
    expect(c.dailyDraws.used).toBe(N - r - excluded);
    expect(c.dailyDraws.total).toBe(N - r);
    expect(p.evidence!.mass).toEqual({
      jackpotCombinations: 12 * combos.length,
      jackpotDates: 4 * c.jackpotDates.used,
      dailyDraws: c.dailyDraws.used,
    });
    for (const u of p.evidence!.used) expect(u.knownFrom < tau).toBe(true);
    const status = combos.length ? "combinations" : c.jackpotDates.used ? "dates-only" : "none";
    expect(p.evidence!.status).toBe(status);
  });

  it("guard rung: the strictest ladder rung whose excluded share is at most 5% (independent hypergeometric bound)", () => {
    const { payload: p, lottery, draws, jackpots } = get(key);
    const history = draws.map((d) => d.numbers);
    const live = liveBallsAt(history, lottery.main_min, lottery.main_max, lottery.main_count, draws.length);
    const combos = usableCombos(lottery.id, jackpots, draws, p.nextDrawDate, live);
    const rung = guardRungSpec(live.length, combos);
    expect(rung.excludedShare).toBeLessThanOrEqual(SPEC.GUARD_ALPHA);
    expect(p.evidence!.guard).toEqual({
      perCombination: rung.perCombination,
      union: rung.union,
      excludedShare: r4(rung.excludedShare),
    });
  });

  it("every card passes R1-R5 (copy guard, typicality, not a past result, diversity, live balls); no duplicates", () => {
    const { payload: p, lottery, draws, jackpots } = get(key);
    const history = draws.map((d) => d.numbers);
    const N = draws.length;
    const live = liveBallsAt(history, lottery.main_min, lottery.main_max, lottery.main_count, N);
    const combos = usableCombos(lottery.id, jackpots, draws, p.nextDrawDate, live);
    const rung = guardRungSpec(live.length, combos);
    const past = pastResults(draws, N);
    const union = [...new Set(combos.flat())];
    const r = regimeStartAt(history, lottery.main_min, lottery.main_max, lottery.main_count, N);
    const letters = new Set(draws.slice(r).map((d) => d.letter).filter((l): l is string => !!l));
    const broken = p.sets.map((s, i) => ({
      label: s.label,
      rules: brokenRules(s.numbers, { live, combos, rung, past, earlier: p.sets.slice(0, i).map((e) => e.numbers) }),
    }));
    expect(broken.filter((b) => b.rules.length)).toEqual([]);
    expect(new Set(p.sets.map((s) => s.numbers.join("-"))).size).toBe(5);
    for (const s of p.sets) {
      expect(s.pastJackpotNumbers).toBe(shared(s.numbers, union));
      expect(s.maxSharedWithOneJackpot).toBe(Math.max(0, ...combos.map((c) => shared(s.numbers, c))));
      if (lottery.letter_kind === "none") expect(s.letter).toBeNull();
      else expect(letters.has(s.letter as string)).toBe(true);
      if (s.bonus !== null) {
        expect(Number.isInteger(s.bonus)).toBe(true);
        expect(s.bonus as number).toBeGreaterThanOrEqual(lottery.bonus_min as number);
        expect(s.bonus as number).toBeLessThanOrEqual(lottery.bonus_max as number);
      }
    }
    // Dead balls are never picked and carry no score or lean.
    const dead = p.liveBalls!.excluded;
    for (const s of p.sets) for (const n of s.numbers) expect(dead.includes(n)).toBe(false);
    for (const s of p.numberScores) if (dead.includes(s.n)) expect(s.score).toBe(0);
    expect(p.numberLean!.map((x) => x.n)).toEqual(live);
  });

  it(
    "walk-forward Top picks pass R1-R3 and R5 at every step with the step's own rung" +
      (key.startsWith("growth") ? "" : "; the order held on every step (real data)"),
    () => {
      const { payload: p, lottery, draws, jackpots, real } = get(key);
      const { main_min: lo, main_max: hi, main_count: k } = lottery;
      const ctx = buildContext(lottery, draws, jackpots);
      const run = walkForward(ctx, { records: true });
      const history = draws.map((d) => d.numbers);
      const bad: string[] = [];
      for (const rec of run.records!) {
        const live = liveBallsAt(history, lo, hi, k, rec.t);
        const combos = usableCombos(lottery.id, jackpots, draws, draws[rec.t].draw_date, live);
        const rung = guardRungSpec(live.length, combos);
        if (rec.guard.perCombination !== rung.perCombination || rec.guard.union !== rung.union) bad.push(`t=${rec.t} rung`);
        if (Math.abs(rec.guard.excludedShare - rung.excludedShare) > 1e-12) bad.push(`t=${rec.t} excluded share`);
        const rules = brokenRules(rec.numbers, { live, combos, rung, past: pastResults(draws, rec.t) });
        if (rules.length) bad.push(`t=${rec.t} ${rec.numbers.join(" ")} breaks ${rules.join(",")}`);
        if (real && !rec.orderHeld) bad.push(`t=${rec.t} order not held`);
      }
      expect(bad).toEqual([]);
      expect(run.draws).toBe(p.backtest.draws);
      expect(r4(run.sumHits / run.draws)).toBe(p.backtest.avgHits);
      if (real) {
        expect(p.sets[0].orderHeld).toBe(true);
        expect(p.backtestDetail!.orderHeld.held).toBe(p.backtestDetail!.orderHeld.steps);
      }
    },
    TIMEOUT,
  );

  it("a view card whose source moves the picks has a positive part for its own source", () => {
    const c = get(key);
    const post = posteriorAt(buildContext(c.lottery, c.draws, c.jackpots), c.draws.length, c.payload.nextDrawDate);
    const moving = [0, 1, 2].filter((s) => sourceMoves(post, s));
    const bad = moving
      .map((s) => ({ card: c.payload.sets[s + 1], own: c.payload.sets[s + 1].parts![SOURCE_KEYS[s]] }))
      .filter(({ own }) => !(own > 0))
      .map(({ card, own }) => `${card.label} ${card.numbers.join(" ")}: own part ${own}`);
    expect(bad).toEqual([]);
    if (c.real) expect(moving.length).toBeGreaterThan(0); // every real lottery has at least one moving source today
  });

  it(
    "view cards 2-4 are the constrained best tickets of the spec (own source alone, else balanced), chosen in the selection order",
    () => {
      const c = get(key);
      const input = viewCardInput(c);
      const spec = specViewCards(input);
      const got = c.payload.sets.slice(1, 4).map((s) => ({ numbers: s.numbers, letter: s.letter, bonus: s.bonus }));
      expect(got).toEqual(spec.map((v) => ({ numbers: v.numbers, letter: v.letter, bonus: v.bonus })));
    },
    TIMEOUT,
  );

  it("a balanced card is a clearly different alternative: at most 1 number shared with every card selected before it, an unused letter and bonus", () => {
    const c = get(key);
    const p = c.payload;
    const post = posteriorAt(buildContext(c.lottery, c.draws, c.jackpots), c.draws.length, p.nextDrawDate);
    const moving = [0, 1, 2].filter((s) => sourceMoves(post, s));
    // Selection order (2.15): the Top pick, the cards whose source moves the picks (J, T, D), then the balanced ones.
    const selection = [p.sets[0], ...[...moving, ...[0, 1, 2].filter((s) => !moving.includes(s))].map((s) => p.sets[s + 1])];
    const bad: string[] = [];
    selection.forEach((card, q) => {
      if (q === 0 || moving.includes(p.sets.indexOf(card) - 1)) return;
      for (const earlier of selection.slice(0, q)) {
        const n = shared(card.numbers, earlier.numbers);
        if (n > SPEC.BALANCED_OVERLAP) bad.push(`${card.label} shares ${n} numbers with ${earlier.label}`);
        if (card.letter !== null && card.letter === earlier.letter) bad.push(`${card.label} repeats the letter of ${earlier.label}`);
        if (card.bonus !== null && card.bonus === earlier.bonus) bad.push(`${card.label} repeats the bonus of ${earlier.label}`);
      }
    });
    expect(bad).toEqual([]);
    // Moving-source cards keep R4 (at most 2 shared) and their own source's letter: they may repeat the Top pick's.
    for (const s of moving) {
      for (const earlier of selection.slice(0, selection.indexOf(p.sets[s + 1]))) {
        expect(shared(p.sets[s + 1].numbers, earlier.numbers)).toBeLessThanOrEqual(SPEC.SET_OVERLAP);
      }
    }
  });

  it(`payload is at most 24 KiB minified${key.startsWith("growth") ? " plus 128 bytes per evidence.used item" : ""}`, () => {
    const { payload: p, real } = get(key);
    const bytes = Buffer.byteLength(JSON.stringify(p), "utf8");
    expect(bytes).toBeLessThanOrEqual(SIZE_BUDGET + (real ? 0 : SIZE_PER_USED_ITEM * p.evidence!.used.length));
  });

  it("card labels are the five short base labels, unique; each note is one plain line that says when a card is balanced", () => {
    const { payload: p, lottery, draws, jackpots } = get(key);
    expect(p.sets.map((s) => s.label)).toEqual(CARD_LABELS);
    expect(new Set(p.sets.map((s) => s.label)).size).toBe(p.sets.length);
    const post = posteriorAt(buildContext(lottery, draws, jackpots), draws.length, p.nextDrawDate);
    const moves = (s: number) => post.num.present[s] && post.num.pull[s] * post.num.damping[s] > 0;
    p.sets.forEach((s, i) => {
      const note = s.note as string;
      expect(typeof note).toBe("string");
      expect(note.length).toBeGreaterThan(0);
      expect(note.length).toBeLessThanOrEqual(120);
      expect(note).toMatch(/^[A-Z].*\.$/);
      // A source card is a balanced pick exactly when its source does not move the number channel, and says so.
      if (i >= 1 && i <= 3) expect(note.includes("balanced pick"), `${s.label}: ${note}`).toBe(!moves(i - 1));
    });
    // The Top pick's note names the sources that move the picks (none, one, two or all three).
    const active = [0, 1, 2].filter(moves);
    const top = p.sets[0].note as string;
    if (active.length === 3) expect(top).toBe("All three sources together, jackpot combinations first.");
    else if (!active.length) expect(top).toBe("No source moves the picks yet, so every ball counts the same.");
    else {
      const names = ["jackpot combinations", "jackpot dates", "daily draws"];
      expect(top.toLowerCase().startsWith(names[active[0]])).toBe(true);
      for (const s of [0, 1, 2]) {
        const named = new RegExp(`^[^;]*${names[s]}`, "i").test(top);
        expect(named, `${top} names ${names[s]}`).toBe(active.includes(s));
      }
    }
  });
});

describe("view-card selection order (2.15)", () => {
  it(
    "matters: in display order the view cards would differ in some cases, so the check above is not vacuous",
    () => {
      const differs = (c: Case) => {
        const input = viewCardInput(c);
        const bySelection = specViewCards(input).map((v) => v.numbers.join("-"));
        const byDisplay = specViewCards({ ...input, order: "display" }).map((v) => v.numbers.join("-"));
        return bySelection.join("|") !== byDisplay.join("|");
      };
      // A fixed case, independent of data/: a synthetic lottery whose only evidence is its daily draws, so the Daily
      // draws card is chosen before the two balanced cards and takes the strongest ticket after the Top pick.
      const lottery: Lottery = {
        id: "order-synth",
        name: "Order Synth",
        board: "DLB",
        source_url: "",
        source_key: "order-synth",
        letter_kind: "letter",
        main_count: 4,
        main_min: 1,
        main_max: 80,
        has_bonus: 0,
        bonus_label: null,
        bonus_min: null,
        bonus_max: null,
      };
      const rng = mulberry32(31);
      const draws: Draw[] = Array.from({ length: 300 }, (_, i) => {
        const s = new Set<number>();
        while (s.size < 4) s.add(1 + Math.floor(rng() * 80));
        return { draw_no: 100 + i, draw_date: addDays("2025-01-01", i), letter: String.fromCharCode(65 + Math.floor(rng() * 26)), numbers: [...s], bonus: null };
      });
      const input = v2Input(lottery, draws, [], "2026-10-28T00:00:00Z");
      const synth: Case = { key: "order-synth", lottery, draws, jackpots: [], real: false, payload: predictV2(input), v1: input.v1 };
      expect(synth.payload.influence!.numbers).toEqual({ jackpotCombinations: 0, jackpotDates: 0, dailyDraws: 1 });
      expect(differs(synth)).toBe(true);
      // On the real data and the growth cases it happens too (today: the 4 DLB lotteries and Mega Power).
      expect(KEYS.filter((key) => differs(get(key))).length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});

describe("synthetic evidence growth (Dhana Nidhanaya, 0-100 own combinations)", () => {
  it("the guard rung loosens with evidence but never excludes more than 5% of tickets, and the search never fails", () => {
    const rungs = GROWTH.map((n) => get(`growth-${n}`).payload.evidence!.guard);
    for (const g of rungs) expect(g.excludedShare).toBeLessThanOrEqual(0.05);
    const index = (g: { perCombination: number; union: number }) =>
      SPEC.GUARD_LADDER.findIndex(([c, u]) => c === g.perCombination && u === g.union);
    for (let i = 1; i < rungs.length; i++) expect(index(rungs[i])).toBeGreaterThanOrEqual(index(rungs[i - 1]));
    expect(get("growth-0").payload.evidence!.status).toBe("none");
    expect(get("growth-100").payload.evidence!.counts.jackpotCombinations.known).toBe(100);
    expect(get("growth-100").payload.evidence!.counts.jackpotCombinations.used).toBeGreaterThanOrEqual(99);
    for (const n of GROWTH) expect(get(`growth-${n}`).payload.sets).toHaveLength(5);
  });
});
