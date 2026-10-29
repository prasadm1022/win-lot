// SPDX-License-Identifier: Apache-2.0
// UI-only checks (components/, app/): the pure helpers and the markup rules the review findings guard. Components are
// rendered with react-dom/server, the way the static export renders them.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DISCLAIMER } from "../lib/model";
import type { BacktestDetail, JackpotStatus, Prediction, SourceSplit, Stats } from "../lib/types";
import { Backtest, pooledHeadline, pooledVerdict, v1BaselineNote, windowChecked } from "../components/charts/Backtest";
import { FrequencyBars } from "../components/charts/FrequencyBars";
import { NumberScoreHeatmap } from "../components/charts/Heatmaps";
import { SumLine } from "../components/charts/SumLine";
import { Hero, type Showcase } from "../components/Hero";
import { HowPicksAreMade } from "../components/HowPicksAreMade";
import { jackpotJustWon } from "../components/JackpotBadge";
import { JackpotWins } from "../components/JackpotWins";
import { jackpotNowLine, lastJackpotLine } from "../components/LotteryCard";
import { DISCLAIMER_TEXT } from "../components/Notices";
import { oddsFallback, PartsBar } from "../components/Picks";
import { BallRow } from "../components/Ball";
import { bonusLabelOf, bonusText, fmtDate, fmtDateShort, fmtDateTime, fmtMonth, fmtMonthYear } from "../components/util/format";

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
const FORBIDDEN = [/more likely/i, /better odds/i, /better chance/i, /\bbeats?\b/i, /lucky day/i, /\bdue\b/i, /overdue/i, /\bhot\b/i, /guarantee/i, /accuracy/i, /affinity/i, /jackpot-likeness/i];

describe("disclaimer", () => {
  it("is the model's disclaimer, word for word, everywhere it is shown", () => {
    expect(DISCLAIMER_TEXT).toBe(DISCLAIMER);
  });
});

describe("format", () => {
  it("spells months like the payload texts (Sep, never Sept) and never depends on ICU", () => {
    expect(fmtDate("2024-09-18")).toBe("18 Sep 2024");
    expect(fmtDate("2026-10-27")).toBe("27 Oct 2026");
    expect(fmtDateShort("2024-09-18")).toBe("18 Sep");
    expect(fmtMonth("2017-04")).toBe("Apr 2017");
    expect(fmtMonthYear("2026-03-28")).toBe("March 2026");
    expect(fmtDateTime("2026-10-27T15:05:00Z")).toBe("27 Oct, 20:35"); // Sri Lanka time
    expect(fmtDate(null)).toBe("-");
    expect(fmtDate("nonsense")).toBe("nonsense");
  });

  it("shows a structured bonus as its digits and speaks its label once", () => {
    const bonus = { label: "Sunday Bonus", digits: [0, 6, 0, 3] };
    expect(bonusText(bonus)).toBe("0603");
    expect(bonusLabelOf(bonus)).toBe("Sunday Bonus");
    expect(bonusText(15)).toBe("15");
    expect(bonusText(null)).toBeNull();
    const html = render(createElement(BallRow, { letter: "A", numbers: [1, 2, 3, 4], bonus, bonusLabel: "Sunday Bonus", size: "sm" }));
    expect(html).toContain('aria-label="Sunday Bonus 0603"');
    expect(html).not.toContain("Sunday Bonus Sunday Bonus");
    expect(html).toContain("ball-bonus wide");
    expect(html).toContain("letter A; numbers 1, 2, 3, 4; Sunday Bonus 0603");
  });
});

describe("backtest copy", () => {
  it("says 'the same as random' only while |pooled z| <= 1.96 (the cut of the 95% ranges), and never celebrates or promises a follow-up", () => {
    expect(pooledVerdict({ z: -0.11 }, { tests: 7, minP: 0.05, anySignificant: false })).toBe("That is the same as random; the difference is luck.");
    expect(pooledVerdict({ z: 1.96 }, null)).toContain("the same as random");
    expect(pooledVerdict({ z: -1.96 }, null)).toContain("the same as random");
    expect(pooledVerdict({ z: 1.97 }, null)).not.toContain("the same as random");
    expect(pooledVerdict({ z: -1.97 }, { tests: 7, minP: 0.03, anySignificant: false })).not.toContain("the same as random");
    const unusual = pooledVerdict({ z: 2.4 }, { tests: 7, minP: 0.03, anySignificant: false });
    expect(unusual).toContain("outside the usual range of luck for one check");
    expect(unusual).toContain("7 checks");
    expect(unusual).toContain("allowing for that, it is within luck");
    expect(unusual).not.toContain("at least one"); // false for 4-7 checks (spec 5.4)
    const survives = pooledVerdict({ z: -3.1 }, { tests: 7, minP: 0.001, anySignificant: true });
    expect(survives).toContain("stays outside the usual range of luck even after allowing for the 7 checks");
    expect(survives).toContain("most likely a rare fluke or a fault in the data or the method, not a way to win");
    // Judged on the pooled z against the first Holm cut over the headline family (2.69 for 7 checks), not on whether one
    // lottery's own check survives (anySignificant).
    expect(pooledVerdict({ z: 2.0 }, { tests: 7, minP: 0.001, anySignificant: true })).toContain("allowing for that, it is within luck");
    expect(pooledVerdict({ z: -2.8 }, { tests: 7, minP: 0.2, anySignificant: false })).toContain("stays outside the usual range of luck");
    const alone = pooledVerdict({ z: 2.5 }, null);
    expect(alone).toContain("outside the usual range of luck for one check");
    expect(alone).toContain("most likely luck");
    for (const s of [unusual, survives, alone]) {
      expect(s).not.toMatch(/looked at|investigat|follow(ed)? up/i); // no promise the site cannot keep
      for (const re of FORBIDDEN) expect(s).not.toMatch(re);
    }
  });

  it("prints the pooled headline from the payload's numbers, never as a fixed claim", () => {
    const pooled = { lotteries: 7, draws: 1334, v2: { avgHits: 0.2016, lo: 0.19, hi: 0.21 }, random: { avgHits: 0.2029, lo: 0.19, hi: 0.21 }, v1: { avgHits: 0.18, lo: 0.17, hi: 0.19 }, z: -0.1084, pairedZ: 1.24, rankZ: 0.25 };
    expect(pooledHeadline(pooled, { tests: 7, minP: 0.0472, anySignificant: false })).toBe(
      "Across all 7 lotteries (1,334 draws) the Top pick matched 0.2016 numbers per draw; a random ticket matches 0.2029. That is the same as random; the difference is luck.",
    );
    expect(pooledHeadline({ ...pooled, z: 2.2 }, { tests: 7, minP: 0.01, anySignificant: false })).toContain("allowing for that, it is within luck");
  });

  it("only claims 'no jackpot was won' when the checked prize rows cover the window", () => {
    const nlb = { draws: 207, wins: 0, from: "2026-03-28", to: "2026-10-27" };
    expect(windowChecked(nlb, "2026-05-01", "2026-10-27")).toBe(true);
    expect(windowChecked(nlb, "2026-03-01", "2026-10-27")).toBe(false); // window starts before the checks
    expect(windowChecked(nlb, "2026-05-01", "2026-10-28")).toBe(false); // newest draw not checked yet
    expect(windowChecked(null, "2026-04-04", "2026-10-27")).toBe(false); // DLB
    expect(windowChecked({ draws: 0, wins: 0, from: null, to: null }, "2026-04-04", "2026-10-27")).toBe(false);
  });

  it("words the v1 baseline as a correction only when the values differ", () => {
    const same = { modelVersion: "v1", sets: [], backtest: { draws: 178, avgHits: 0.17, randomBaseline: 0.1951 }, honestRandomBaseline: 0.1951 };
    expect(v1BaselineNote(same, "1-82")).toBe("v1 used a baseline of 0.1951, which is also the honest value for 1-82.");
    const differ = { ...same, backtest: { ...same.backtest, randomBaseline: 0.2 }, honestRandomBaseline: 0.2105 };
    expect(v1BaselineNote(differ, "1-76")).toBe("v1 used a baseline of 0.2000; the honest value for 1-76 is 0.2105.");
  });

  const hit = (avgHits: number) => ({ avgHits, lo: avgHits - 0.03, hi: avgHits + 0.03 });
  const detail = (over: Partial<BacktestDetail>): BacktestDetail => ({
    draws: 200,
    from: "2026-04-04",
    to: "2026-10-27",
    v2: hit(0.255),
    random: hit(0.211),
    v1: { ...hit(0.185), pairedDiff: 0.07, pairedZ: 1.5 },
    z: 1.44,
    ci95: [-0.016, 0.105],
    rank: { pct: 0.4917, z: -0.829 },
    logScoreNats: -0.01,
    letter: null,
    bonus: null,
    lifts: { jackpotNumbersZ: null, sourceZ: { dailyDraws: 0.8179 } },
    copyTilt: null,
    orderHeld: { steps: 200, held: 200, filterChanged: 0 },
    jackpotDrawHits: [],
    outOfDomain: 0,
    pooled: { lotteries: 7, draws: 1334, v2: hit(0.2016), random: hit(0.2029), v1: hit(0.1829), z: -0.1084, pairedZ: 1.24, rankZ: 0.25 },
    holm: { tests: 4, minP: 0.0417, anySignificant: false },
    holmAll: { tests: 7, minP: 0.0472, anySignificant: false },
    power: { mdeShare: 0.29, pooledMdeShare: 0.11 },
    text: { verdict: "verdict text", power: "power text", holm: null, copyTilt: null },
    ...over,
  });

  it("never states 'not won' for a window the data cannot check (DLB, or NLB rows that do not cover it)", () => {
    const dlb = text(render(createElement(Backtest, { detail: detail({}), previous: null, liveCount: 76, mainCount: 4, mainMin: 1, board: "DLB", checked: null })));
    expect(dlb).toContain("No jackpot win inside this test window is known (DLB publishes no winners list).");
    expect(dlb).not.toContain("No jackpot was won");
    const partial = text(
      render(
        createElement(Backtest, {
          detail: detail({ from: "2026-03-01" }),
          previous: null,
          liveCount: 80,
          mainCount: 4,
          mainMin: 1,
          board: "NLB",
          checked: { draws: 207, wins: 0, from: "2026-03-28", to: "2026-10-27" },
        }),
      ),
    );
    expect(partial).toContain("is known (not every draw in it could be checked)");
    const covered = text(
      render(
        createElement(Backtest, {
          detail: detail({ from: "2026-05-01" }),
          previous: null,
          liveCount: 80,
          mainCount: 4,
          mainMin: 1,
          board: "NLB",
          checked: { draws: 207, wins: 0, from: "2026-03-28", to: "2026-10-27" },
        }),
      ),
    );
    expect(covered).toContain("No jackpot was won inside this test window.");
  });

  it("prints jackpot-draw hits with their unit, source names in words and the pooled verdict from the numbers", () => {
    const d = detail({
      jackpotDrawHits: [
        { drawNo: 2234, date: "2026-05-29", hits: 1 },
        { drawNo: 2289, date: "2026-07-25", hits: 0 },
      ],
      lifts: { jackpotNumbersZ: 0.77, sourceZ: { jackpotCombinations: 0.23, jackpotDates: -1.9 } },
      pooled: { lotteries: 7, draws: 1334, v2: hit(0.23), random: hit(0.2), v1: hit(0.18), z: 2.6, pairedZ: 1, rankZ: 1 },
    });
    const t = text(render(createElement(Backtest, { detail: d, previous: null, liveCount: 82, mainCount: 4, mainMin: 1, board: "NLB", checked: null })));
    expect(t).toContain("Hits on the known jackpot draws inside this window: #2234 (29 May 2026): 1 hit · #2289 (25 Jul 2026): 0 hits.");
    expect(t).toContain("Jackpot combinations z = +0.23, Jackpot dates z = -1.90");
    expect(t).not.toContain("jackpotCombinations");
    expect(t).not.toContain("That is the same as random");
    expect(t).toContain("allowing for that, it is within luck");
    expect(t).toContain("0 = top of the ranking, 1 = bottom");
    expect(t).toContain("the Random ticket bar is where luck alone lands");
  });

  it("claims no more power than the payload's figures support, and says why the jackpot-number check has no z yet", () => {
    const props = { previous: null, liveCount: 82, mainCount: 4, mainMin: 1, board: "NLB" as const, checked: null };
    const base = text(render(createElement(Backtest, { ...props, detail: detail({}) })));
    expect(base).toContain("power text"); // the payload's own sentence says what the figures mean
    expect(base).toContain("minimum detectable effect: about +29% of the baseline here, about +11% pooled");
    expect(base).not.toContain("smallest effect this test can notice");
    expect(base).toContain("past jackpot numbers n/a"); // no combination used in the walk-forward
    const young = text(
      render(
        createElement(Backtest, {
          ...props,
          detail: detail({ copyTilt: { steps: 12, avgPastJackpotNumbers: 0.5, random: 0.4, maxSharedWithOne: 1, maxFromUnion: 1 } }),
        }),
      ),
    );
    expect(young).toContain("past jackpot numbers too few draws to judge yet");
    expect(young).not.toContain("past jackpot numbers n/a");
    const formed = text(render(createElement(Backtest, { ...props, detail: detail({ lifts: { jackpotNumbersZ: -0.84, sourceZ: {} } }) })));
    expect(formed).toContain("past jackpot numbers z = -0.84");
  });
});

describe("history charts", () => {
  const stats = (frequency: Stats["frequency"]): Stats => ({
    lotteryId: "x",
    window: "100",
    drawCount: 100,
    frequency,
    hot: [1],
    cold: [2],
    overdue: [],
    letterFrequency: [],
    sumSeries: [
      { drawNo: 1, date: "2026-10-25", sum: 120 },
      { drawNo: 2, date: "2026-10-26", sum: 150 },
      { drawNo: 3, date: "2026-10-27", sum: 90 },
    ],
    oddEven: [],
    highLow: [],
    pairs: [],
    positionHeat: [],
  });

  it("says a number was never drawn in the window instead of 'last seen null draws ago'", () => {
    const never = { n: 2, count: 0, lastSeenDrawsAgo: null as unknown as number, expectedGap: 20 }; // lib/stats.ts sets null
    const html = render(createElement(FrequencyBars, { stats: stats([{ n: 1, count: 5, lastSeenDrawsAgo: 1, expectedGap: 20 }, never]) }));
    expect(html).toContain("Number 1: 5 draws, last seen 1 draw ago, most drawn");
    expect(html).toContain("Number 2: 0 draws, never drawn in this window, least drawn");
    expect(html).not.toContain("null");
    expect(html).toContain('class="chart-scroll"');
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
  });

  it("scrolls the sum chart sideways on phones like the other charts (chart-scroll) and keeps it one tab stop", () => {
    const html = render(createElement(SumLine, { series: stats([]).sumSeries, mainCount: 4, mainMin: 1, mainMax: 80 }));
    expect(html).toMatch(/<div class="chart-scroll"><svg[^>]*tabindex="0"/);
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html).toContain('aria-live="polite"');
  });

  it("makes the Number scores grid one tab stop with every cell's facts kept as text", () => {
    const scores = Array.from({ length: 80 }, (_, i) => ({ n: i + 1, score: (i % 10) / 10 }));
    const html = render(createElement(NumberScoreHeatmap, { scores, mainMin: 1, excluded: [77, 78, 79, 80], since: "2023-07-04" }));
    expect(html.match(/tabindex="0"/g)?.length).toBe(1);
    expect(html).toContain('role="group" tabindex="0" aria-label="Pattern score per number. Use the arrow keys to read each number."');
    expect(html.match(/role="listitem"/g)?.length).toBe(80);
    expect(html).toContain('aria-label="Number 3: pattern score 20 of 100" title="#3 · pattern score 20"');
    expect(html).toContain('aria-label="Number 80: not in use, not drawn since 4 Jul 2023"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Dashed cells 77-80: balls not in use, not drawn since 4 Jul 2023. They have no score.");
  });
});

describe("jackpot status copy", () => {
  const status = (over: Partial<JackpotStatus>): JackpotStatus => ({
    lotteryId: "dhana-nidhanaya",
    wins: [],
    lastWin: { drawNo: 2319, date: "2026-08-24", inArchive: true },
    drawsSinceLastWin: 64,
    daysSinceLastWin: 64,
    current: { amount: 93874580, drawNo: 2383, date: "2026-10-27", kind: "last-draw" },
    latestDraw: { drawNo: 2383, date: "2026-10-27", outcome: "not-won" },
    checked: { draws: 207, wins: 3, from: "2026-03-28", to: "2026-10-27" },
    notes: [],
    ...over,
  });

  it("stops calling the amount just paid out the jackpot 'now'", () => {
    expect(jackpotJustWon(status({}))).toBe(false);
    const wonDay = status({
      current: { amount: 87804496, drawNo: 2319, date: "2026-08-24", kind: "last-draw" },
      latestDraw: { drawNo: 2319, date: "2026-08-24", outcome: "won" },
      drawsSinceLastWin: 0,
      daysSinceLastWin: 0,
    });
    expect(jackpotJustWon(wonDay)).toBe(true);
    expect(jackpotNowLine(wonDay)).toBe("Won at draw #2319: Rs. 87.8 M (next jackpot not published yet)");
    expect(jackpotNowLine(status({}))).toBe("Jackpot now: Rs. 93.9 M (at draw #2383)");
    const dlb = status({ current: { amount: 397249249, drawNo: 2505, date: null, kind: "advertised-next" }, lastWin: null });
    expect(jackpotJustWon(dlb)).toBe(false);
    expect(jackpotNowLine(dlb)).toBe("Advertised jackpot for draw #2505: Rs. 397.2 M");
    const html = text(render(createElement(JackpotWins, { status: wonDay, lottery: { name: "Dhana Nidhanaya", board: "NLB", bonusLabel: null, firstDate: "2026-03-27" } })));
    expect(html).toContain("Won at draw #2319");
    expect(html).not.toContain("Jackpot now");
  });

  it("calls a win before the archive the last known one, since earlier draws could not all be checked", () => {
    const mega = status({ lastWin: { drawNo: 2440, date: "2026-02-01", inArchive: false }, drawsSinceLastWin: 261, daysSinceLastWin: 268 });
    expect(lastJackpotLine(mega)).toBe("Last known jackpot: 1 Feb 2026 (#2440), before our archive (not every draw since could be checked)");
    expect(lastJackpotLine(status({}))).toBe("Last jackpot: 24 Aug 2026 (#2319) · 64 draws ago");
    expect(lastJackpotLine(status({ drawsSinceLastWin: 1 }))).toBe("Last jackpot: 24 Aug 2026 (#2319) · 1 draw ago");
    // The day the jackpot is won on the newest draw: never "0 draws ago" above "Won at draw #N".
    expect(lastJackpotLine(status({ drawsSinceLastWin: 0, daysSinceLastWin: 0 }))).toBe("Last jackpot: 24 Aug 2026 (#2319) · won at the latest draw");
    expect(lastJackpotLine(null)).toBe("No jackpot win recorded yet");
    const html = text(render(createElement(JackpotWins, { status: mega, lottery: { name: "Mega Power", board: "NLB", bonusLabel: "Super Number", firstDate: "2026-03-27" } })));
    expect(html).toContain("Since the last known win");
    expect(html).toContain("before our archive; not every draw before 28 Mar 2026 could be checked");
  });
});

describe("hero", () => {
  const showcase = (outcome: Showcase["latest"] extends infer L ? (L extends { outcome: infer O } ? O : never) : never): Showcase => ({
    lottery: { id: "dhana-nidhanaya", name: "Dhana Nidhanaya", board: "NLB", bonusLabel: "Sunday Bonus" },
    pick: { label: "Top pick", letter: "A", numbers: [3, 17, 42, 66], bonus: null, score: 0.5, note: "All three sources together, jackpot combinations first." },
    nextDrawDate: "2026-10-28",
    latest: { drawNo: 2319, date: "2026-08-24", jackpot: { winners: 1, amount: 87804496, source: "nlb-prize-table" }, outcome },
  });

  it("renders the jackpot badge of a won latest draw in markup a browser parses the same way (no <details> inside <p>)", () => {
    const html = render(createElement(Hero, { items: [showcase("won"), showcase("not-won")], nlbCheckedFrom: "2026-03-28" }));
    expect(html).toContain('<div class="hero-latest">');
    expect(html).not.toContain('<p class="hero-latest">');
    expect(html).toMatch(/<div class="hero-latest">[\s\S]*?<details/);
    // The showcase is not a live region while it rotates on its own; the dots are plain pressed buttons, not tabs.
    expect(html).toContain('aria-live="off"');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('role="group" aria-label="Showcased lottery"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Pause");
    // Copy: the claim is about the jackpot days we know of, and the note's full stop does not precede the separator.
    expect(html).toContain("Known jackpot days marked.");
    expect(html).toContain("jackpot combinations first · for fun, not a forecast");
    expect(html).toContain("NLB prize tables from March 2026");
  });
});

describe("how the picks are made", () => {
  const split = (j: number, t: number, d: number): SourceSplit => ({ jackpotCombinations: j, jackpotDates: t, dailyDraws: d });
  const prediction = (over: Partial<Prediction> & { evidence: Prediction["evidence"] }): Prediction => ({
    lotteryId: "x",
    generatedAt: "2026-10-28T00:00:00Z",
    basedOnDraws: 100,
    nextDrawDate: "2026-10-28",
    nextDrawNo: 860,
    sets: [],
    numberScores: [],
    method: "method text",
    disclaimer: DISCLAIMER,
    backtest: { draws: 0, avgHits: 0, randomBaseline: 0.2 },
    modelVersion: "win-lot-jackpot-v2",
    weights: { jackpotCombination: 12, jackpotDate: 4, dailyDraw: 1, orderRatio: 0.75, maxLean: 1.25, jackpotPrior: 2 },
    influence: { numbers: split(0, 0, 1), letters: null, bonus: null, odd: split(0, 0, 1), spread: split(0, 0, 1) },
    damping: { numbers: split(1, 1, 1), letters: null, bonus: null },
    patternLean: 3.1,
    ...over,
  });
  const evidence = (over: Partial<NonNullable<Prediction["evidence"]>>): NonNullable<Prediction["evidence"]> => ({
    status: "none",
    asOf: "2026-10-28",
    counts: {
      jackpotCombinations: { used: 0, known: 0 },
      jackpotDates: { used: 0, known: 0, undated: 0, olderThanArchive: 0, clusters: 0, effective: 0 },
      dailyDraws: { used: 500, total: 500, since: "2024-01-01", excludedAsJackpot: 0 },
    },
    mass: split(0, 0, 500),
    used: [],
    pending: [],
    calendar: null,
    calendarEss: null,
    guard: { perCombination: 1, union: 2, excludedShare: 0 },
    ...over,
  });
  const lottery = { name: "Synth", letterKind: "letter" as const, bonusLabel: null, mainMin: 1 };

  it("says 'none known yet' only while no win is listed at all", () => {
    const t = text(render(createElement(HowPicksAreMade, { prediction: prediction({ evidence: evidence({}) }), lottery })));
    expect(t).toContain("Jackpot combinations 0% · Jackpot dates 0% · Daily draws 100%");
    expect(t).toContain("0% - none known yet");
    expect(t).toContain("No jackpot win is known yet, so there is nothing to keep in order");
    expect(t).toContain("No jackpot dates are known for Synth, so there is no calendar fit.");
    expect(t).toContain("Pattern lean: 3.1 out of 100");
    expect(t).not.toContain("Model win-lot-jackpot-v2 Jackpot"); // the model id lives in the maths view only
  });

  it("follows the payload once a win is listed but cannot be used yet (published too recently, or inferred)", () => {
    const ev = evidence({
      counts: {
        jackpotCombinations: { used: 0, known: 1 },
        jackpotDates: { used: 0, known: 1, undated: 0, olderThanArchive: 0, clusters: 0, effective: 0 },
        dailyDraws: { used: 500, total: 500, since: "2024-01-01", excludedAsJackpot: 0 },
      },
      pending: [{ drawNo: 858, date: "2026-10-26", knownFrom: null }],
    });
    const t = text(render(createElement(HowPicksAreMade, { prediction: prediction({ evidence: ev }), lottery })));
    expect(t).toContain("0% - none can be used yet");
    expect(t).not.toContain("none known yet");
    expect(t).toContain("No jackpot win can be used yet, so there is nothing to keep in order");
    expect(t).toContain("No jackpot date of Synth can be used yet, so there is no calendar fit.");
    expect(t).toContain("counts once draw #860 is published");
  });

  it("prints every split in whole percents that add up to 100, like the payload texts", () => {
    const dhana = split(0.5361, 0.2651, 0.1988); // rounds to 54 / 27 / 20 = 101 one by one
    const ev = evidence({
      status: "combinations",
      counts: {
        jackpotCombinations: { used: 3, known: 3 },
        jackpotDates: { used: 7, known: 7, undated: 0, olderThanArchive: 4, clusters: 6, effective: 6 },
        dailyDraws: { used: 205, total: 208, since: "2026-03-27", excludedAsJackpot: 3 },
      },
      calendar: [
        { feature: "moonPhase", strength: 1.24, peak: "about 2 days before the full moon", rayleighP: 0.087, holmP: 0.261 },
        { feature: "dayOfMonth", strength: 0.1, peak: "around the 23rd", rayleighP: 0.38, holmP: 0.76 },
        { feature: "weekday", strength: 0, peak: "none", rayleighP: 0.7, holmP: 0.76 },
      ],
      calendarEss: 127.1,
      guard: { perCombination: 1, union: 2, excludedShare: 0.0246 },
    });
    const p = prediction({
      evidence: ev,
      influence: { numbers: dhana, letters: split(0.6, 0.25, 0.15), bonus: null, odd: dhana, spread: dhana },
      damping: { numbers: split(1, 1, 0.0896), letters: split(1, 1, 0.1), bonus: null },
    });
    const t = text(render(createElement(HowPicksAreMade, { prediction: p, lottery })));
    expect(t).toContain("Jackpot combinations 54% · Jackpot dates 26% · Daily draws 20%");
    expect(t).toContain("Daily draws are turned down to 9% of their pull so they never outweigh the dates.");
    expect(t).toContain("7 jackpot dates in 6 groups (dates within a week count as one)");
    expect(t).toContain("None of these is clear after allowing for 3 checks");
    expect(t).not.toContain("This is most likely a ticket-sales effect");
    expect(t).toContain("rules out at most 2.5% of all tickets (never more than 5%)");
    const share = render(createElement(PartsBar, { parts: dhana, kind: "share", label: "Share" }));
    expect(share).toContain("Jackpot combinations 54 percent, Jackpot dates 26 percent, Daily draws 20 percent");
    const points = render(createElement(PartsBar, { parts: split(0.242, 0.1477, -0.0289), kind: "points", scale: 0.4, label: "Top pick" }));
    expect(points).toContain("+0.24 pts");
    expect(points).toContain("-0.03 pts");
    expect(points).toContain("pattern points");
  });

  it("holds the daily draws back in the payload's words while the dates show no pattern", () => {
    const ev = evidence({
      status: "dates-only",
      counts: {
        jackpotCombinations: { used: 0, known: 0 },
        jackpotDates: { used: 1, known: 1, undated: 0, olderThanArchive: 0, clusters: 1, effective: 1 },
        dailyDraws: { used: 500, total: 500, since: "2024-01-01", excludedAsJackpot: 0 },
      },
      calendar: [{ feature: "moonPhase", strength: 0, peak: "none", rayleighP: 1, holmP: 1 }],
    });
    const p = prediction({
      evidence: ev,
      influence: { numbers: split(0, 0, 0), letters: null, bonus: null, odd: split(0, 0, 0), spread: split(0, 0, 0) },
      damping: { numbers: split(1, 1, 0), letters: null, bonus: null },
    });
    const t = text(render(createElement(HowPicksAreMade, { prediction: p, lottery })));
    expect(t).toContain("Daily draws are held back while the dates show no pattern.");
    expect(t).toContain("0% - no calendar pattern yet");
    // The state line matches the payload's card note: only the dates are silent here.
    expect(t).toContain("0% - held back while the dates show no pattern");
    expect(t).not.toContain("sources above");
    // Both sources above are silent (the jackpot numbers show no pattern, so the dates are held back too).
    const both = prediction({
      evidence: evidence({
        status: "combinations",
        counts: {
          jackpotCombinations: { used: 1, known: 1 },
          jackpotDates: { used: 1, known: 1, undated: 0, olderThanArchive: 0, clusters: 1, effective: 1 },
          dailyDraws: { used: 500, total: 500, since: "2024-01-01", excludedAsJackpot: 1 },
        },
      }),
      influence: { numbers: split(0, 0, 0), letters: null, bonus: null, odd: split(0, 0, 0), spread: split(0, 0, 0) },
      damping: { numbers: split(1, 0, 0), letters: null, bonus: null },
    });
    const t2 = text(render(createElement(HowPicksAreMade, { prediction: both, lottery })));
    expect(t2).toContain("0% - held back while the jackpot numbers show no pattern");
    expect(t2).toContain("0% - held back while the sources above them show no pattern");
    expect(t2).toContain("Daily draws are held back while the sources above them show no pattern.");
  });
});

describe("odds line", () => {
  it("names the balls in use in the fallback line, like the payload's odds text", () => {
    const odds = { numbers: 1282975, numbersAndLetter: 33357350, basis: "76 numbers in use, 26 letters" };
    expect(oddsFallback(odds, { count: 76, excluded: [77, 78, 79, 80], since: "2023-07-04" })).toBe(
      "Every ticket has the same chance: 1 in 1,282,975 for the four numbers (76 balls in use; 1 in 33,357,350 with the letter).",
    );
    expect(oddsFallback(odds, { count: 80, excluded: [], since: "2026-03-27" })).toBe(
      "Every ticket has the same chance: 1 in 1,282,975 for the four numbers (1 in 33,357,350 with the letter).",
    );
    expect(oddsFallback({ ...odds, numbersAndLetter: null }, null)).toBe("Every ticket has the same chance: 1 in 1,282,975 for the four numbers.");
    expect(oddsFallback(undefined)).toBeNull();
  });
});
