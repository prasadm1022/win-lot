// SPDX-License-Identifier: Apache-2.0
// Zero and partial evidence (docs/MODEL-V2.md section 2.12): the model degrades gracefully and says so. The DLB
// lotteries without any own jackpot item (built, so a future DLB win does not change the case), Mega Power with dates
// only (on the frozen snapshot of 2026-10-27); synthetic lotteries cover silent dates, clustered and weekly dates
// (n_eff = number of clusters), a single combination, a first jackpot whose checks wait for 30 test draws (5.2) and a
// history too short for a backtest. Card labels never change; the notes say why a card is a balanced pick. No test
// here depends on how many draws data/ holds today.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { mulberry32, predict } from "../lib/model";
import type { Draw } from "../lib/parsers";
import type { Prediction } from "../lib/types";
import {
  CHECK_MIN_STEPS,
  LIFT_MIN_EXPECTED,
  V2_CONSTANTS,
  Z95,
  addDays,
  buildContext,
  isTypical,
  lotteryChecks,
  normalP,
  posteriorAt,
  predictV2,
  v1TopPickHits,
  walkForward,
  type BacktestRun,
} from "../lib/model-v2";
import { binom } from "./helpers/v2-rules";

const root = join(__dirname, "..");
const JACKPOTS = JSON.parse(readFileSync(join(root, "data", "jackpots.json"), "utf8")) as Jackpot[];
const GENERATED_AT = "2026-10-28T00:00:00Z";
/** The frozen data snapshot of the golden fixture (the data of 2026-10-27), for cases pinned to that day's state. */
const FROZEN = (
  JSON.parse(readFileSync(join(root, "test", "fixtures", "model-v2-golden.json"), "utf8")) as {
    snapshot: { lotteries: { lottery: Lottery; draws: Draw[] }[]; jackpots: Jackpot[] };
  }
).snapshot;

function loadDraws(id: string): Draw[] {
  const raw = JSON.parse(readFileSync(join(root, "data", "draws", `${id}.json`), "utf8")) as {
    drawNo: number;
    date: string;
    letter: string | null;
    numbers: number[];
    bonus: unknown;
  }[];
  return raw
    .slice()
    .reverse()
    .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null }));
}

function run(lottery: Lottery, draws: Draw[], jackpots: Jackpot[]): Prediction {
  return predictV2({ lottery, draws, jackpots, generatedAt: GENERATED_AT, v1: predict(lottery, draws, GENERATED_AT) });
}

const SYNTH: Lottery = {
  id: "synth-lotto",
  name: "Synth Lotto",
  board: "NLB",
  source_url: "",
  source_key: "synth-lotto",
  letter_kind: "letter",
  main_count: 4,
  main_min: 1,
  main_max: 80,
  has_bonus: 0,
  bonus_label: null,
  bonus_min: null,
  bonus_max: null,
};

/** Fair synthetic daily draws on 1..80 from 2025-06-01, letters A..Z. */
function synthDraws(n: number, seed = 5): Draw[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const nums: number[] = [];
    while (nums.length < 4) {
      const x = 1 + Math.floor(rng() * 80);
      if (!nums.includes(x)) nums.push(x);
    }
    return {
      draw_no: 1000 + i,
      draw_date: addDays("2025-06-01", i),
      letter: String.fromCharCode(65 + Math.floor(rng() * 26)),
      numbers: nums,
      bonus: null,
    };
  });
}

/** A jackpot of the synthetic lottery known only by its date (older than the archive). */
function dateOnly(drawNo: number, date: string): Jackpot {
  return {
    lotteryId: SYNTH.id,
    drawNo,
    date,
    letter: null,
    numbers: null,
    bonus: null,
    jackpotWinners: null,
    superPrizeAmount: null,
    source: "nlb-winners-directory",
    inDrawHistory: false,
    listedIn: [date.slice(0, 7)],
  };
}

/** Card labels (2.15) never change with the evidence; why a card is a balanced pick is in its note. */
const LABELS = ["Top pick", "Jackpot pattern", "Jackpot days", "Daily draws", "Lucky dip"];
const ABSENT_J = "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence.";
const ABSENT_T = "No jackpot dates are known yet, so this card is a balanced pick from all the evidence.";
const SILENT_T = "The jackpot dates show no calendar pattern yet, so this card is a balanced pick from all the evidence.";
const HELD_D = "Daily draws are held back while the dates show no pattern, so this card is a balanced pick.";
const LUCKY = "A random ticket that follows the same pick rules. It has exactly the same chance as every other card.";
const SILENT_NOTE =
  "The jackpot dates show no calendar pattern yet, so they add nothing. Daily draws may never outweigh the dates, so they are held back too.";

describe("no own jackpot item (DLB)", () => {
  for (const id of ["ada-kotipathi", "super-ball", "shanida", "kapruka"]) {
    it(`${id}: status none, daily draws only, base labels and absent-source notes`, () => {
      const lottery = LOTTERY_BY_ID[id];
      // The state under test is built, not assumed: the lottery's own items are removed (other lotteries' stay), so
      // the first real DLB jackpot (an inferred reset) does not turn this test into a different case.
      const p = run(lottery, loadDraws(id), JACKPOTS.filter((j) => j.lotteryId !== id));
      const dailyOnly = { jackpotCombinations: 0, jackpotDates: 0, dailyDraws: 1 };
      expect(p.evidence!.status).toBe("none");
      expect(p.influence!.numbers).toEqual(dailyOnly);
      expect(p.influence!.letters).toEqual(dailyOnly);
      expect(p.influence!.odd).toEqual(dailyOnly);
      expect(p.influence!.spread).toEqual(dailyOnly);
      if (id === "kapruka") expect(p.influence!.bonus).toEqual(dailyOnly);
      else expect(p.influence!.bonus).toBeNull();
      expect(p.damping!.numbers.dailyDraws).toBe(1);
      expect(p.evidence!.mass.jackpotCombinations).toBe(0);
      expect(p.evidence!.mass.jackpotDates).toBe(0);
      expect(p.evidence!.used).toEqual([]);
      expect(p.evidence!.calendar).toBeNull();
      expect(p.evidence!.calendarEss).toBeNull();
      expect(p.notes).toContain(
        `No jackpot win is known for ${lottery.name} yet, so the jackpot weights cannot apply. Picks use daily draws only.`,
      );
      expect(p.sets.map((s) => s.label)).toEqual(LABELS);
      expect(p.sets.map((s) => s.note)).toEqual([
        "Daily draws only; no jackpot win is known yet.",
        ABSENT_J,
        ABSENT_T,
        "What the daily draws alone point to.",
        LUCKY,
      ]);
      expect(p.sets[0].orderHeld).toBe(true);
      expect(p.numberLean!.every((x) => x.j === 0 && x.t === 0)).toBe(true);
      expect(p.backtestDetail!.copyTilt).toBeNull();
      expect(p.backtestDetail!.lifts.jackpotNumbersZ).toBeNull();
    });
  }
});

describe("dates but no winning numbers (Mega Power)", () => {
  it("dates-only: the combinations share is 0 and is not redistributed", () => {
    // On the frozen snapshot of 2026-10-27 (test/fixtures/model-v2-golden.json): 208 draws and 9 dated wins, all
    // older than the archive. A later Mega Power win inside the archive changes the live case, not this one.
    const frozen = FROZEN.lotteries.find((l) => l.lottery.id === "mega-power")!;
    const p = run(LOTTERY_BY_ID["mega-power"], frozen.draws, FROZEN.jackpots);
    expect(p.evidence!.status).toBe("dates-only");
    expect(p.influence!.numbers.jackpotCombinations).toBe(0);
    expect(p.influence!.numbers.jackpotDates).toBeGreaterThan(p.influence!.numbers.dailyDraws);
    expect(p.influence!.numbers.jackpotDates + p.influence!.numbers.dailyDraws).toBeCloseTo(1, 3);
    expect(p.evidence!.mass).toEqual({ jackpotCombinations: 0, jackpotDates: 36, dailyDraws: 208 });
    expect(p.evidence!.counts.jackpotDates).toMatchObject({ used: 9, undated: 2, olderThanArchive: 9 });
    expect(p.notes).toContain(
      "Mega Power's 9 dated jackpot wins are older than our draw archive, so their numbers are unknown. Only their dates are used.",
    );
    expect(p.sets.map((s) => s.label)).toEqual(LABELS);
    expect(p.sets.map((s) => s.note)).toEqual([
      "Jackpot dates and daily draws together; no jackpot numbers are known yet.",
      ABSENT_J,
      "Follows the draws held on calendar days similar to past jackpot dates.",
      "What the daily draws alone point to.",
      LUCKY,
    ]);
    expect(p.sets.every((s) => s.parts!.jackpotCombinations === 0)).toBe(true);
  });
});

describe("silent dates (strict chain)", () => {
  const dates = Array.from({ length: 10 }, (_, i) => addDays("2025-01-01", 9 * i)); // spread over every feature
  const jackpots = [...dates.map((d, i) => dateOnly(500 + i, d)), ...JACKPOTS];
  const draws = synthDraws(150);

  it("dates show no calendar pattern: T silent, daily draws held at 0, theta = p0", () => {
    const ctx = buildContext(SYNTH, draws, jackpots);
    const post = posteriorAt(ctx, draws.length, "2025-10-29");
    expect(post.calendar!.features.map((f) => f.kappa)).toEqual([0, 0, 0]);
    expect(post.num.present).toEqual([false, true, true]);
    expect(post.num.pull[1]).toBe(0);
    expect(post.num.damping[2]).toBe(0);
    for (let j = 0; j < 80; j++) expect(Math.abs(post.num.theta[j] - 1 / 80)).toBeLessThan(1e-15);

    const p = run(SYNTH, draws, jackpots);
    expect(p.evidence!.status).toBe("dates-only");
    expect(p.evidence!.calendar!.every((f) => f.strength === 0 && f.peak === "none")).toBe(true);
    expect(p.influence!.numbers).toEqual({ jackpotCombinations: 0, jackpotDates: 0, dailyDraws: 0 });
    expect(p.damping!.numbers.dailyDraws).toBe(0);
    expect(p.patternLean).toBe(0);
    expect(p.numberScores.every((s) => s.score === 0.5)).toBe(true);
    expect(p.notes).toContain(SILENT_NOTE);
    // A flat posterior: ties are broken by seeded tie keys, never by number order.
    const top = p.sets[0].numbers;
    expect(top).not.toEqual([1, 2, 3, 4]);
    expect(isTypical(top, post.shape)).toBe(true);
    expect(p.sets.map((s) => s.label)).toEqual(LABELS);
    expect(p.sets.map((s) => s.note)).toEqual([
      "No source moves the picks yet, so every ball counts the same.",
      ABSENT_J,
      SILENT_T,
      HELD_D,
      LUCKY,
    ]);
    expect(p.evidence!.counts.jackpotDates).toMatchObject({ used: 10, clusters: 10, effective: 10 });
  });
});

describe("clustered dates count once (n_eff = number of clusters)", () => {
  const draws = synthDraws(150);
  // Seven wins within one week: one calendar position.
  const week = Array.from({ length: 7 }, (_, i) => dateOnly(600 + i, addDays("2025-02-10", i)));

  it("seven dates in one week are one date: n_eff = 1, so the dates are silent", () => {
    const p = run(SYNTH, draws, week);
    expect(p.evidence!.status).toBe("dates-only");
    expect(p.evidence!.counts.jackpotDates).toMatchObject({ used: 7, clusters: 1, effective: 1 });
    expect(p.evidence!.calendar!.every((f) => f.strength === 0 && f.rayleighP === 1)).toBe(true);
    expect(p.influence!.numbers).toEqual({ jackpotCombinations: 0, jackpotDates: 0, dailyDraws: 0 });
    expect(p.notes).toContain(SILENT_NOTE);
    expect(p.sets.map((s) => s.label)).toEqual(LABELS);
    expect(p.sets[2].note).toBe(SILENT_T);
  });

  it("weekly wins stay several calendar positions (no cluster spans more than 7 days), so their weekday pattern counts", () => {
    // 9 wins on consecutive Fridays (2025-01-03 is a Friday): windows of at most 7 days give 5 clusters. Chains of
    // gaps <= 7 days would have made them one date, switched the calendar off and held the daily draws at 0.
    const fridays = Array.from({ length: 9 }, (_, q) => dateOnly(800 + q, addDays("2025-01-03", 7 * q)));
    const p = run(SYNTH, draws, fridays);
    expect(p.evidence!.counts.jackpotDates).toMatchObject({ used: 9, clusters: 5, effective: 5 });
    const weekday = p.evidence!.calendar!.find((f) => f.feature === "weekday")!;
    expect([weekday.strength, weekday.peak]).toEqual([2, "around Friday"]);
    expect(p.influence!.numbers.jackpotDates).toBeGreaterThan(0);
    expect(p.influence!.numbers.dailyDraws).toBeGreaterThan(0);
    expect(p.notes).not.toContain(SILENT_NOTE);
    expect(p.sets[2].note).toBe("Follows the draws held on calendar days similar to past jackpot dates.");
  });

  it("one more date outside that week makes two dates, not 3.5", () => {
    const p = run(SYNTH, draws, [...week, dateOnly(700, "2025-03-27")]);
    expect(p.evidence!.counts.jackpotDates).toMatchObject({ used: 8, clusters: 2, effective: 2 });
    const ctx = buildContext(SYNTH, draws, [...week, dateOnly(700, "2025-03-27")]);
    const fit = posteriorAt(ctx, draws.length, "2025-10-29").calendar!;
    expect([fit.dates, fit.clusters, fit.nEff]).toEqual([8, 2, 2]);
  });
});

describe("a single jackpot combination", () => {
  it("n_eff = 1, so the dates are silent; the combination alone moves the picks", () => {
    const draws = synthDraws(150, 9);
    const won = draws[60];
    const combo: Jackpot = {
      lotteryId: SYNTH.id,
      drawNo: won.draw_no,
      date: won.draw_date,
      letter: won.letter,
      numbers: [...won.numbers].sort((a, b) => a - b),
      bonus: null,
      jackpotWinners: 1,
      superPrizeAmount: 50_000_000,
      source: "nlb-prize-table",
      inDrawHistory: true,
    };
    const p = run(SYNTH, draws, [combo]);
    const ev = p.evidence!;
    expect(ev.status).toBe("combinations");
    expect(ev.counts.jackpotCombinations).toEqual({ used: 1, known: 1 });
    expect(ev.counts.jackpotDates).toMatchObject({ used: 1, clusters: 1, effective: 1 });
    expect(ev.counts.dailyDraws).toMatchObject({ used: 149, total: 150, excludedAsJackpot: 1 });
    expect(ev.calendar!.every((f) => f.strength === 0)).toBe(true);
    expect(ev.used).toEqual([{ drawNo: won.draw_no, date: won.draw_date, kind: "combination", source: "nlb-prize-table", knownFrom: addDays(won.draw_date, 1) }]);
    expect(p.influence!.numbers).toEqual({ jackpotCombinations: 1, jackpotDates: 0, dailyDraws: 0 });
    expect(p.damping!.numbers.dailyDraws).toBe(0);
    expect(p.notes).toContain(SILENT_NOTE);
    expect([ev.guard.perCombination, ev.guard.union]).toEqual([1, 2]);
    for (const s of p.sets) expect(s.numbers.filter((n) => combo.numbers!.includes(n)).length).toBeLessThanOrEqual(1);
    expect(p.sets.map((s) => s.label)).toEqual(LABELS);
    expect(p.sets.map((s) => s.note)).toEqual([
      "Jackpot combinations only; the jackpot dates show no calendar pattern yet.",
      "Follows the tens, odd/even mix, spread and letter of past jackpots.",
      SILENT_T,
      HELD_D,
      LUCKY,
    ]);
    expect(p.sets[0].orderHeld).toBe(true);
    // Before the jackpot is known, its draw is an ordinary daily draw.
    const ctx = buildContext(SYNTH, draws, [combo]);
    const before = posteriorAt(ctx, 61, draws[61].draw_date);
    expect(before.evidence.combinations).toHaveLength(0);
    expect(before.pool).toHaveLength(61);
    const after = posteriorAt(ctx, 62, draws[62].draw_date);
    expect(after.evidence.combinations).toHaveLength(1);
    expect(after.pool).toHaveLength(61);
  });
});

describe("a lottery's first jackpot: its checks wait for 30 test draws (5.2)", () => {
  /** The prize-table jackpot of draw `won` (known from the next day, so usable from draw won + 2 of daily draws). */
  const prizeTable = (won: Draw): Jackpot => ({
    lotteryId: SYNTH.id,
    drawNo: won.draw_no,
    date: won.draw_date,
    letter: won.letter,
    numbers: [...won.numbers].sort((a, b) => a - b),
    bonus: null,
    jackpotWinners: 1,
    superPrizeAmount: 50_000_000,
    source: "nlb-prize-table",
    inDrawHistory: true,
  });
  const walk = (draws: Draw[], jackpots: Jackpot[]) => {
    const ctx = buildContext(SYNTH, draws, jackpots);
    return { bt: walkForward(ctx), v1Hits: v1TopPickHits(ctx.history, ctx.lo, ctx.hi, ctx.k) };
  };
  const names = (bt: BacktestRun, v1Hits: number[]) => lotteryChecks(bt, v1Hits).map((c) => c.check);
  const BASE = ["hits", "previousModel", "rank", "dailyDraws"];
  const WITH_JACKPOT = ["hits", "previousModel", "rank", "jackpotNumbers", "jackpotCombinations", "dailyDraws"];

  it("usable on the last 2 draws, which share 2 of its numbers: no check of it is formed, nothing stays unusual", () => {
    const draws = synthDraws(160, 1);
    const N = draws.length;
    const jackpot = prizeTable(draws[N - 4]);
    const combo = jackpot.numbers!;
    // Each of the 2 draws after the jackpot became usable shares one of its numbers.
    for (const [t, n] of [
      [N - 2, combo[0]],
      [N - 1, combo[1]],
    ]) {
      draws[t] = { ...draws[t], numbers: [n, ...draws[t].numbers.filter((x) => !combo.includes(x)).slice(0, 3)] };
      expect(new Set(draws[t].numbers).size).toBe(4);
    }
    const { bt, v1Hits } = walk(draws, [jackpot]);
    expect([bt.copy.steps, bt.sourceSteps[0]]).toEqual([2, 2]);
    // The normal p of the jackpot-number count would be 0.008, below 0.05 / 6, so it would "survive" Holm over the 6
    // checks, while the true chance of 2 or more shared numbers over 2 fair draws is 1 - P0^2 - 2 P0 P1 = 5.3%
    // (P_x = C(4,x) C(76,4-x) / C(80,4)). The combinations lean moved the picks on these 2 draws only (raw z above 1.96).
    const jn = bt.jackpotNumbers;
    expect(jn.drawn).toBe(2);
    expect(normalP((jn.drawn - jn.expected) / Math.sqrt(jn.variance))).toBeLessThan(0.05 / 6);
    const P = (x: number) => (binom(4, x) * binom(76, 4 - x)) / binom(80, 4);
    expect(1 - P(0) ** 2 - 2 * P(0) * P(1)).toBeCloseTo(0.0535, 4);
    expect(bt.sourceZ[0] / Math.sqrt(bt.sourceVariance[0])).toBeGreaterThan(Z95);
    expect(names(bt, v1Hits)).toEqual(BASE);

    const d = run(SYNTH, draws, [jackpot]).backtestDetail!;
    expect(d.copyTilt!.steps).toBe(2); // still described
    expect(d.lifts.jackpotNumbersZ).toBeNull();
    expect(Object.keys(d.lifts.sourceZ)).toEqual(["dailyDraws"]);
    expect(d.holm.tests).toBe(4);
    expect(d.holm.anySignificant).toBe(false);
    expect(d.text.holm).toBeNull();
  });

  it(`the jackpot-number check and a lean's check join after ${CHECK_MIN_STEPS} test draws (and ${LIFT_MIN_EXPECTED} numbers expected by chance)`, () => {
    expect([CHECK_MIN_STEPS, LIFT_MIN_EXPECTED]).toEqual([V2_CONSTANTS.BT_MIN, 5]);
    const draws = synthDraws(160, 1);
    const N = draws.length;
    const short = walk(draws, [prizeTable(draws[N - 31])]); // usable on the last 29 draws
    expect([short.bt.copy.steps, short.bt.sourceSteps[0]]).toEqual([29, 29]);
    expect(names(short.bt, short.v1Hits)).toEqual(BASE);
    const d29 = run(SYNTH, draws, [prizeTable(draws[N - 31])]).backtestDetail!;
    expect(d29.lifts.jackpotNumbersZ).toBeNull();
    expect(Object.keys(d29.lifts.sourceZ)).toEqual(["dailyDraws"]);
    expect(d29.holm.tests).toBe(4);

    const full = walk(draws, [prizeTable(draws[N - 32])]); // usable on the last 30 draws: 30 x 16/80 = 6 expected
    expect([full.bt.copy.steps, full.bt.sourceSteps[0]]).toEqual([30, 30]);
    expect(full.bt.jackpotNumbers.expected).toBeCloseTo(6, 12);
    expect(names(full.bt, full.v1Hits)).toEqual(WITH_JACKPOT);
    const d30 = run(SYNTH, draws, [prizeTable(draws[N - 32])]).backtestDetail!;
    expect(d30.lifts.jackpotNumbersZ).not.toBeNull();
    expect(Object.keys(d30.lifts.sourceZ)).toEqual(["jackpotCombinations", "dailyDraws"]);
    expect(d30.holm.tests).toBe(6);

    // Each limit on its own, on that run: fewer than 5 numbers expected by chance, or a source on 29 test draws only.
    const thin: BacktestRun = { ...full.bt, jackpotNumbers: { ...full.bt.jackpotNumbers, expected: LIFT_MIN_EXPECTED - 0.01 } };
    expect(names(thin, full.v1Hits)).not.toContain("jackpotNumbers");
    const dates = (steps: number): BacktestRun => ({ ...full.bt, sourceZ: [1, 1, 1], sourceVariance: [1, 1, 1], sourceSteps: [30, steps, 30] });
    expect(names(dates(CHECK_MIN_STEPS - 1), full.v1Hits)).toEqual(WITH_JACKPOT);
    expect(names(dates(CHECK_MIN_STEPS), full.v1Hits)).toEqual([...WITH_JACKPOT.slice(0, 5), "jackpotDates", "dailyDraws"]);
  });
});

describe("a history too short for a backtest", () => {
  it("fewer than 31 draws: backtest.draws = 0, the prediction is still produced", () => {
    const draws = synthDraws(20);
    const p = run(SYNTH, draws, JACKPOTS);
    expect(p.backtest).toEqual({ draws: 0, avgHits: 0, randomBaseline: 0.2 });
    expect(p.backtestDetail).toBeUndefined();
    expect(p.sets).toHaveLength(5);
    expect(p.notes).toContain("There are too few draws to replay the picks against past results yet.");
    expect(p.modelVersion).toBe("win-lot-jackpot-v2");
    expect(p.previousModel!.backtest.draws).toBe(0);
  });
});
