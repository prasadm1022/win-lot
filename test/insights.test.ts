// SPDX-License-Identifier: Apache-2.0
// lib/insights.ts on synthetic draws: the rules behind the results archives, the lottery guide and the /guides articles.
// Nothing here reads data/, so the daily data commit can never break it (lesson L12).
import { describe, expect, it } from "vitest";
import type { PrizeRow } from "../lib/jackpots";
import {
  articleYear,
  ascendingCount,
  bonusSummary,
  choose,
  drawNoSteps,
  drawSchedule,
  frequencySpread,
  gapCheck,
  gapInRange,
  groupByYear,
  jackpotRun,
  letterSummary,
  liveNumbers,
  longestBreak,
  longestGap,
  outcomeCounts,
  overlapInRange,
  repeatChance,
  repeats,
  restartAmounts,
  resultRows,
  stableWindow,
  topOverlap,
  yearRow,
} from "../lib/insights";
import type { DrawSummary } from "../lib/types";

const DAY = 86_400_000;
const isoPlus = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Draws newest first, one per day from `start`, numbered from `firstNo`. */
function draws(rows: number[][], start = "2025-01-01", firstNo = 100, letter = "A"): DrawSummary[] {
  return rows
    .map((numbers, i) => ({ drawNo: firstNo + i, date: isoPlus(start, i), letter, numbers, bonus: null }))
    .reverse();
}

describe("results archive rows", () => {
  const ds = draws([
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
  ]);
  const rows: PrizeRow[] = [
    { drawNo: 100, date: "2025-01-01", superPrizeAmount: 1000, superPrizeWinners: 0, tier: "Super Prize" },
    { drawNo: 101, date: "2025-01-02", superPrizeAmount: 1100, superPrizeWinners: 2, tier: "Super Prize" },
    { drawNo: 102, date: "2025-01-03", superPrizeAmount: null, superPrizeWinners: null, tier: "none" },
  ];

  it("NLB: won from winners > 0 or a marked draw, not-won only from a row of 0 winners, else unknown", () => {
    const marked = ds.map((d) => (d.drawNo === 103 ? { ...d, jackpot: { winners: 1, amount: 5000, source: "nlb-prize-table" as const } } : d));
    const r = resultRows("NLB", marked, rows);
    expect(r.map((x) => x.drawNo)).toEqual([103, 102, 101, 100]);
    expect(r.map((x) => x.jackpot.kind)).toEqual(["won", "unknown", "won", "not-won"]);
    expect(r[0].jackpot).toEqual({ kind: "won", winners: 1, amount: 5000, inferred: false });
    expect(r[2].jackpot).toEqual({ kind: "won", winners: 2, amount: 1100, inferred: false });
    expect(r[3].jackpot).toEqual({ kind: "not-won", amount: 1000 });
    expect(outcomeCounts(r)).toEqual({ won: 2, notWon: 1, unknown: 1 });
  });

  it("DLB: never 'not-won', even next to a row of 0 winners; an inferred win stays labelled inferred", () => {
    const marked = ds.map((d) => (d.drawNo === 101 ? { ...d, jackpot: { winners: null, amount: null, source: "dlb-jackpot-reset" as const } } : d));
    const r = resultRows("DLB", marked, rows);
    expect(r.some((x) => x.jackpot.kind === "not-won")).toBe(false);
    expect(r.find((x) => x.drawNo === 101)!.jackpot).toEqual({ kind: "won", winners: null, amount: null, inferred: true });
    expect(r.filter((x) => x.jackpot.kind === "unknown").every((x) => x.jackpot.amount === null)).toBe(true);
  });

  it("groups by year, newest year first, keeping the newest-first order inside a year", () => {
    const d = draws([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4]], "2024-12-30");
    const g = groupByYear(d);
    expect(g.map((x) => x.year)).toEqual([2025, 2024]);
    expect(g[1].rows.map((x) => x.date)).toEqual(["2024-12-31", "2024-12-30"]);
    expect(g.reduce((s, x) => s + x.rows.length, 0)).toBe(d.length);
  });
});

describe("draw schedule", () => {
  it("counts draws per weekday and the breaks inside the window", () => {
    // 2025-01-05 is a Sunday; draws every day for two weeks except 2025-01-09..11
    const dates = Array.from({ length: 14 }, (_, i) => isoPlus("2025-01-05", i)).filter((d) => d < "2025-01-09" || d > "2025-01-11");
    const s = drawSchedule(dates)!;
    expect(s).toMatchObject({ from: "2025-01-05", to: "2025-01-18", days: 14, draws: 11, daysWithout: 3 });
    expect(s.weekdays.reduce((a, b) => a + b, 0)).toBe(11);
    expect(s.weekdays).toEqual([2, 2, 2, 2, 1, 1, 1]);
    expect(s.breaks).toEqual([{ from: "2025-01-09", to: "2025-01-11", days: 3 }]);
    expect(longestBreak(s.breaks)).toEqual({ from: "2025-01-09", to: "2025-01-11", days: 3 });
  });

  it("limits the window to the last `days` days and returns null without draws", () => {
    const dates = Array.from({ length: 30 }, (_, i) => isoPlus("2025-01-01", i));
    const s = drawSchedule(dates, 7)!;
    expect(s).toMatchObject({ from: "2025-01-24", to: "2025-01-30", days: 7, draws: 7, daysWithout: 0, breaks: [] });
    expect(drawSchedule([])).toBeNull();
    expect(longestBreak([])).toBeNull();
  });
});

describe("result format facts", () => {
  it("summarises a number bonus and a digits bonus with their weekdays", () => {
    const d = draws([[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12]], "2025-01-05");
    const num = d.map((x, i) => ({ ...x, bonus: i === 2 ? null : 7 + i }));
    expect(bonusSummary(num)).toEqual({ draws: 2, first: "2025-01-06", last: "2025-01-07", weekdays: [1, 2], min: 7, max: 8, digits: null });
    const dig = d.map((x) => (x.date === "2025-01-05" ? { ...x, bonus: { label: "Sunday Bonus", digits: [0, 6, 0, 3] } } : x));
    expect(bonusSummary(dig)).toMatchObject({ draws: 1, weekdays: [0], min: null, max: null, digits: 4 });
    expect(bonusSummary(d)).toBeNull();
  });

  it("counts letters, ascending results and draw-number steps", () => {
    const d = draws([[1, 2, 3, 4], [4, 3, 2, 1], [5, 6, 7, 8]]);
    expect(letterSummary(d)).toEqual({ letters: ["A"], draws: 3 });
    expect(ascendingCount(d)).toBe(2);
    const gap = d.map((x) => (x.drawNo === 102 ? { ...x, drawNo: 105 } : x));
    expect(drawNoSteps(gap)).toEqual({ steps: 2, byOne: 1 });
    expect(drawNoSteps([])).toEqual({ steps: 0, byOne: 0 });
  });
});

describe("numbers in use and frequency", () => {
  it("keeps every number of the range while the archive is shorter than the window", () => {
    const d = draws([[1, 2, 3, 4]]);
    expect(liveNumbers(d, 1, 6, 5)).toEqual([1, 2, 3, 4, 5, 6]);
    const long = draws(Array.from({ length: 6 }, () => [1, 2, 3, 4]));
    expect(liveNumbers(long, 1, 6, 5)).toEqual([1, 2, 3, 4]);
  });

  it("starts the stable window at the newest return of a number away for the retirement window", () => {
    const rows = [[1, 2, 3, 9], ...Array.from({ length: 300 }, () => [1, 2, 3, 4]), [9, 2, 3, 4], [1, 2, 3, 4]];
    const d = draws(rows, "2024-01-01");
    const w = stableWindow(d, [1, 2, 3, 4, 9]);
    expect(w.change).toMatchObject({ number: 9, missed: 300 });
    expect(w.draws.length).toBe(2);
    expect(stableWindow(d.slice(0, 50), [1, 2, 3, 4]).change).toBeNull();
  });

  it("measures the spread of the counts against the binomial average and its 1.96 range", () => {
    const d = draws([[1, 2, 3, 4], [1, 2, 5, 6], [1, 3, 5, 7], [2, 4, 6, 8]]);
    const live = [1, 2, 3, 4, 5, 6, 7, 8];
    const s = frequencySpread(d, live)!;
    expect(s.expected).toBeCloseTo(2, 10);
    expect(s.sd).toBeCloseTo(Math.sqrt(4 * 0.5 * 0.5), 10);
    expect(s.max).toEqual({ count: 3, numbers: [1, 2] });
    expect(s.min).toEqual({ count: 1, numbers: [7, 8] });
    expect(s.inRange).toBe(8); // |count - 2| <= 1.96 for every count 1..3
    expect(frequencySpread([], live)).toBeNull();
  });

  it("compares the top numbers of the two halves with the hypergeometric average and variance", () => {
    const d = draws([[1, 2, 3, 4], [1, 2, 3, 4], [5, 6, 7, 8], [5, 6, 7, 8]]);
    const live = Array.from({ length: 20 }, (_, i) => i + 1);
    const o = topOverlap(d, live, 4)!;
    expect(o).toMatchObject({ top: 4, older: 2, newer: 2, shared: 0 });
    expect(o.chance).toBeCloseTo(16 / 20, 10);
    expect(o.variance).toBeCloseTo((16 / 20) * (16 / 20) * (16 / 19), 10);
    expect(overlapInRange(0, o.chance, o.variance)).toBe(true);
    expect(overlapInRange(4, o.chance, o.variance)).toBe(false);
  });

  it("finds the longest run a number in use stayed out", () => {
    const d = draws([[1, 2, 3, 4], [2, 3, 4, 5], [2, 3, 4, 5], [1, 2, 3, 4]]);
    expect(longestGap(d, [1, 2, 3, 4, 5])).toEqual({ number: 1, draws: 2, endedOn: "2025-01-04" });
  });
});

describe("gap check", () => {
  it("tallies each number in use by draws since it last came out, with the fair rate per pair", () => {
    // live 1..8, 4 per draw (p = 0.5). Draw 0: 1-4. Draw 1: 1,2,5,6. Draw 2: 1,3,5,7.
    const d = draws([[1, 2, 3, 4], [1, 2, 5, 6], [1, 3, 5, 7]]);
    const live = [1, 2, 3, 4, 5, 6, 7, 8];
    const g = gapCheck([{ draws: d, live }], [
      { label: "1", lo: 1, hi: 1 },
      { label: "2+", lo: 2, hi: Infinity },
    ]);
    // before draw 1: 1-4 at gap 1 (hits 1, 2). Before draw 2: 1, 2, 5, 6 at gap 1 (hits 1, 5); 3, 4 at gap 2 (hit 3).
    expect(g[0]).toMatchObject({ trials: 8, hits: 4 });
    expect(g[1]).toMatchObject({ trials: 2, hits: 1 });
    expect(g[0].expected).toBeCloseTo(4, 10);
    expect(g[0].variance).toBeCloseTo(2, 10);
    expect(gapInRange(g[0])).toBe(true);
    expect(gapInRange({ trials: 0, hits: 0, expected: 0, variance: 0 })).toBe(false);
    expect(gapInRange({ trials: 1000, hits: 200, expected: 50, variance: 47.5 })).toBe(false);
  });
});

describe("repeats and the year", () => {
  it("uses 1 - C(L - k, k) / C(L, k) for a repeat between consecutive fair draws", () => {
    expect(choose(80, 4)).toBe(1_581_580);
    expect(repeatChance(80, 4)).toBeCloseTo(1 - choose(76, 4) / choose(80, 4), 12);
    const d = draws([[1, 2, 3, 4], [4, 5, 6, 7], [8, 9, 10, 11]]);
    expect(repeats(d, d)).toEqual({ draws: 2, repeated: 1 });
  });

  it("covers the newest year, or the year before until March", () => {
    expect(articleYear("2026-11-04")).toBe(2026);
    expect(articleYear("2027-02-28")).toBe(2026);
    expect(articleYear("2027-03-01")).toBe(2027);
  });

  it("summarises one year: draws, breaks from 1 January, top letter and repeats across the new year", () => {
    const d = draws([[1, 2, 3, 4], [4, 5, 6, 7], [8, 9, 10, 11], [8, 12, 13, 14]], "2024-12-31").map((x) =>
      x.date === "2025-01-03" ? { ...x, letter: "B" } : x,
    );
    const noDay2 = d.filter((x) => x.date !== "2025-01-02");
    const y = yearRow(noDay2, Array.from({ length: 14 }, (_, i) => i + 1), 2025);
    expect(y).toMatchObject({ draws: 2, first: "2025-01-01", last: "2025-01-03", daysWithout: 1 });
    expect(y.longestBreak).toEqual({ from: "2025-01-02", to: "2025-01-02", days: 1 });
    expect(y.topLetter).toEqual({ count: 1, letters: ["A", "B"] });
    // 1 Jan repeats 4 from 31 Dec (the year before counts as the draw before); 3 Jan shares nothing with 1 Jan
    expect(y.repeat).toEqual({ draws: 2, repeated: 1 });
  });
});

describe("jackpot runs", () => {
  const rows: PrizeRow[] = [
    { drawNo: 10, date: "2025-01-01", superPrizeAmount: 100, superPrizeWinners: 0, tier: "Super Prize" },
    { drawNo: 11, date: "2025-01-02", superPrizeAmount: 120, superPrizeWinners: 1, tier: "Super Prize" },
    { drawNo: 12, date: "2025-01-03", superPrizeAmount: 80, superPrizeWinners: 0, tier: "Super Prize" },
    { drawNo: 13, date: "2025-01-04", superPrizeAmount: 90, superPrizeWinners: 0, tier: "Super Prize" },
  ];

  it("runs from the draw after the last win to the newest checked draw", () => {
    expect(jackpotRun(rows)).toEqual({
      from: { drawNo: 12, date: "2025-01-03", amount: 80 },
      to: { drawNo: 13, date: "2025-01-04", amount: 90 },
      draws: 2,
      sinceChecksBegan: false,
    });
    expect(jackpotRun(rows.filter((r) => r.drawNo !== 11))!.sinceChecksBegan).toBe(true);
    expect(jackpotRun(rows.slice(0, 2))).toBeNull(); // won on the newest checked draw: no run yet
    expect(jackpotRun([])).toBeNull();
  });

  it("lists the amount a jackpot restarted at after each win", () => {
    expect(restartAmounts(rows)).toEqual([{ winDrawNo: 11, nextDrawNo: 12, amount: 80 }]);
  });
});
