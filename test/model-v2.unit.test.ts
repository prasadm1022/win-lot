// SPDX-License-Identifier: Apache-2.0
// Unit tests of the win-lot-jackpot-v2 building blocks (docs/MODEL-V2.md section 6, "model-v2.unit" row):
// availability rule, regime, calendar fit, shape nulls, guard ladder, order cap and posterior, pick rules, card labels
// and notes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERY_BY_ID } from "../lib/lotteries";
import { mulberry32, nextDrawDate, predict } from "../lib/model";
import type { Draw } from "../lib/parsers";
import { predictionNotes } from "../lib/model-v2/explain";
import {
  CARD_LABELS,
  MODEL_VERSION_V2,
  V2_CONSTANTS,
  Z_POWER,
  a1inv,
  addDays,
  assembleChannel,
  binsOf,
  buildContext,
  calendarAngles,
  cardLabel,
  cardNote,
  cardsAt,
  choose,
  deadRun,
  decadeOf,
  declusterWeights,
  fitCalendar,
  guardExcluded,
  guardRung,
  holmAdjust,
  holmFirstCut,
  hyperTail,
  isTypical,
  knownFrom,
  leanOf,
  mdeSE,
  methodText,
  moonPhase,
  normalP,
  posteriorAt,
  predictV2,
  rayleighP,
  regimeAt,
  shapeNull,
  sourceState,
  splitText,
  streamAt,
  ticketKey,
  topPickAt,
  usableAt,
  wholePercents,
  type CardNoteInput,
  type Channel,
  type Posterior,
  type SourceStateName,
} from "../lib/model-v2";

const root = join(__dirname, "..");
const JACKPOTS = JSON.parse(readFileSync(join(root, "data", "jackpots.json"), "utf8")) as Jackpot[];

/** data/draws/<id>.json in the model's shape, oldest first. */
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

/** A lottery of the frozen data snapshot of the golden fixture (the data of 2026-10-27) and its jackpots.json. */
function frozen(id: string): { draws: Draw[]; jackpots: Jackpot[] } {
  const fixture = JSON.parse(readFileSync(join(root, "test", "fixtures", "model-v2-golden.json"), "utf8")) as {
    snapshot: { lotteries: { lottery: { id: string }; draws: Draw[] }[]; jackpots: Jackpot[] };
  };
  const entry = fixture.snapshot.lotteries.find((l) => l.lottery.id === id);
  if (!entry) throw new Error(`${id} is not in the frozen snapshot`);
  return { draws: entry.draws, jackpots: fixture.snapshot.jackpots };
}

/** Production posterior of a real lottery (t = N, tau = next draw date). */
function production(id: string): Posterior {
  const draws = loadDraws(id);
  const ctx = buildContext(LOTTERY_BY_ID[id], draws, JACKPOTS);
  return posteriorAt(ctx, draws.length, nextDrawDate(ctx.dates));
}

const channelsOf = (p: Posterior): [string, Channel][] =>
  [
    ["num", p.num],
    ["letter", p.letter],
    ["bonus", p.bonus],
    ["odd", p.odd],
    ["spread", p.spread],
  ].filter((x): x is [string, Channel] => x[1] !== null);

function expectChannelInvariants(ch: Channel) {
  const lo = 2 - V2_CONSTANTS.MAX_LIFT;
  const hi = V2_CONSTANTS.MAX_LIFT;
  for (let s = 0; s < 3; s++) {
    expect(ch.damping[s]).toBeGreaterThanOrEqual(0);
    expect(ch.damping[s]).toBeLessThanOrEqual(1);
  }
  // Order (2.11 b) among present sources: each at most ORDER x the share of the present source above it.
  const present = [0, 1, 2].filter((s) => ch.present[s]);
  for (let a = 0; a + 1 < present.length; a++) {
    expect(ch.share[present[a + 1]]).toBeLessThanOrEqual(V2_CONSTANTS.ORDER * ch.share[present[a]] + 1e-12);
  }
  for (let x = 0; x < ch.p0.length; x++) {
    if (ch.p0[x] <= 0) {
      expect(ch.theta[x]).toBe(0);
      continue;
    }
    const lean = leanOf(ch, x);
    expect(lean).toBeGreaterThanOrEqual(lo - 1e-12);
    expect(lean).toBeLessThanOrEqual(hi + 1e-12);
    expect(Math.abs(lean - 1 - (ch.parts[0][x] + ch.parts[1][x] + ch.parts[2][x]))).toBeLessThan(1e-12);
  }
}

// ---------------------------------------------------------------- constants

describe("constants", () => {
  it("are frozen owner policy, pinned", () => {
    expect(MODEL_VERSION_V2).toBe("win-lot-jackpot-v2");
    expect(Object.isFrozen(V2_CONSTANTS)).toBe(true);
    expect(JSON.parse(JSON.stringify(V2_CONSTANTS))).toEqual({
      W_J: 12,
      W_T: 4,
      W_D: 1,
      ORDER: 0.75,
      PRIOR: 50,
      MAX_LIFT: 1.25,
      J_PRIOR: 2,
      CAL_FEATURES: ["moonPhase", "dayOfMonth", "weekday"],
      KAPPA_MAX: 2,
      DECLUSTER_DAYS: 7,
      SYNODIC: 29.530588853,
      MOON_EPOCH: "2000-01-06T18:14:00Z",
      PRIZE_TABLE_LAG_DAYS: 1,
      GUARD_ALPHA: 0.05,
      GUARD_LADDER: [
        [1, 2],
        [1, 3],
        [2, 3],
        [2, 4],
        [3, 4],
      ],
      CAND: 24,
      SIR: 64,
      SIR_ROUNDS: 4,
      SET_OVERLAP: 2,
      BALANCED_OVERLAP: 1,
      TYPICAL: { oddMin: 1, oddMax: 3, sumLowQ: 0.1, sumHighQ: 0.9, maxConsecutivePairs: 1 },
      DEAD_P: 1e-6,
      BT_DRAWS: 200,
      BT_MIN: 30,
    });
  });

  it("method text is generated from the constants (spec 3.3 wording)", () => {
    expect(methodText()).toBe(
      "Fair-balls prior over the balls in use, plus three evidence sources in the owner's order. A jackpot-winning " +
        "combination counts as 12 draws, acting only through its decades, odd/even mix, spread and letter, with 2 average " +
        "pseudo-jackpots added. A jackpot-winning date counts as 4 draws, through draws held on calendar-similar days " +
        "(moon phase, day of month, weekday; fitted on this lottery's own dates; contrast with ordinary days). A daily draw " +
        "counts as 1. Each lower source is damped to at most 75% of the pull of the source above it, and no number's lean " +
        "leaves 0.75-1.25. Cards follow copy, typicality and diversity rules. Walk-forward backtest over the last 200 draws, " +
        "or fewer so that each replayed draw has at least 30 earlier draws, using only evidence known before each draw.",
    );
  });
});

// ---------------------------------------------------------------- availability (2.4)

describe("knownFrom / usableAt", () => {
  const item = (over: Partial<Jackpot>): Jackpot => ({
    lotteryId: "x",
    drawNo: 100,
    date: "2026-08-24",
    letter: null,
    numbers: null,
    bonus: null,
    jackpotWinners: null,
    superPrizeAmount: null,
    source: "nlb-prize-table",
    inDrawHistory: true,
    ...over,
  });

  it("NLB prize table: the day after the draw", () => {
    expect(knownFrom(item({}), [])).toBe("2026-08-25");
    expect(knownFrom(item({ listedIn: ["2026-08"] }), [])).toBe("2026-08-25"); // the prize-table rule wins
    expect(knownFrom(item({ date: "2026-12-31" }), [])).toBe("2027-01-01");
  });

  it("NLB winners directory: end of the earliest listing month, never before the draw", () => {
    const dir = (date: string, listedIn: string[]) => item({ source: "nlb-winners-directory", date, listedIn });
    expect(knownFrom(dir("2019-11-08", ["2020-01"]), [])).toBe("2020-01-31");
    expect(knownFrom(dir("2019-11-08", ["2020-03", "2020-01"]), [])).toBe("2020-01-31");
    expect(knownFrom(dir("2024-02-10", ["2024-02"]), [])).toBe("2024-02-29");
    expect(knownFrom(dir("2019-12-04", ["2019-11"]), [])).toBe("2019-12-04");
    expect(knownFrom(dir("2026-10-20", ["latest"]), [])).toBe("2026-10-21");
    expect(knownFrom(item({ source: "nlb-winners-directory", date: "2026-10-20" }), [])).toBe("2026-10-21");
  });

  it("DLB inferred win: the date of draw K+2 by draw number, null while it is not archived", () => {
    const draws = [
      { drawNo: 100, date: "2026-01-01" },
      { drawNo: 101, date: "2026-01-03" },
      { drawNo: 103, date: "2026-01-09" },
      { drawNo: 102, date: "2026-01-07" },
    ];
    const reset = (drawNo: number) => item({ source: "dlb-jackpot-reset", drawNo, date: "2026-01-01" });
    expect(knownFrom(reset(100), draws)).toBe("2026-01-07"); // not 2026-01-03 (+2 days)
    expect(knownFrom(reset(101), draws)).toBe("2026-01-09");
    expect(knownFrom(reset(102), draws)).toBeNull();
  });

  it("undated items and unknown sources are never usable", () => {
    expect(knownFrom(item({ date: null }), [])).toBeNull();
    expect(knownFrom(item({ source: "something-else" as Jackpot["source"] }), [])).toBeNull();
    expect(usableAt(null, "2030-01-01")).toBe(false);
    expect(usableAt("2026-08-25", "2026-08-25")).toBe(false); // strict: the test draw's own jackpot is never used
    expect(usableAt("2026-08-25", "2026-08-26")).toBe(true);
    expect(addDays("2024-02-28", 2)).toBe("2024-03-01");
  });
});

// ---------------------------------------------------------------- regime (2.3)

/** Direct implementation of the 2.3 definitions (quadratic, for checking only). */
function bruteRegime(hist: number[][], lo: number, hi: number, k: number, t: number) {
  const R = deadRun(hi - lo + 1, k);
  const lastBefore = (n: number, end: number) => {
    for (let i = end - 1; i >= 0; i--) if (hist[i].includes(n)) return i;
    return -1;
  };
  let start = 0;
  for (let i = 0; i < t; i++) {
    for (const n of hist[i]) {
      const p = lastBefore(n, i);
      if ((p < 0 && i >= R) || (p >= 0 && i - p > R)) start = Math.max(start, i);
    }
  }
  const excluded: number[] = [];
  for (let n = lo; n <= hi; n++) {
    const last = lastBefore(n, t);
    if (t >= R && (last < 0 || t - last > R)) {
      excluded.push(n);
      if (last >= 0) start = Math.max(start, last + 1);
    }
  }
  return { excluded, start };
}

describe("regime", () => {
  it("R = 270 for 1..80 and 277 for 1..82", () => {
    expect(deadRun(80, 4)).toBe(270);
    expect(deadRun(82, 4)).toBe(277);
  });

  it("retires balls 77-80 after a range change, and reactivates a returning ball", () => {
    const rng = mulberry32(11);
    const drawOn = (max: number) => {
      const s: number[] = [];
      while (s.length < 4) {
        const n = 1 + Math.floor(rng() * max);
        if (!s.includes(n)) s.push(n);
      }
      return s;
    };
    const hist: number[][] = [];
    for (let i = 0; i < 330; i++) hist.push(drawOn(80));
    for (let i = 330; i < 640; i++) hist.push(drawOn(76));
    const lastIndexOf = (n: number) => hist.reduce((last, d, i) => (d.includes(n) ? i : last), -1);
    const lastOld = Math.max(...[77, 78, 79, 80].map(lastIndexOf));
    expect(lastOld).toBeLessThan(330);

    for (const t of [100, 400, 500, 640]) {
      const r = regimeAt(hist, 1, 80, 4, t);
      const b = bruteRegime(hist, 1, 80, 4, t);
      expect(r.excluded).toEqual(b.excluded);
      expect(r.start).toBe(b.start);
      expect(r.count).toBe(80 - b.excluded.length);
    }
    const now = regimeAt(hist, 1, 80, 4, 640);
    expect(now.excluded).toEqual([77, 78, 79, 80]);
    expect(now.start).toBe(lastOld + 1);
    expect([77, 78, 79, 80].every((n) => now.live[n - 1] === 0)).toBe(true);

    // Ball 77 comes back: a new regime starts at its return and it is live again.
    hist.push([5, 23, 41, 77]);
    for (let i = 0; i < 9; i++) hist.push(drawOn(76));
    const back = regimeAt(hist, 1, 80, 4, hist.length);
    expect(back.excluded).toEqual([78, 79, 80]);
    expect(back.start).toBe(640);
    expect(bruteRegime(hist, 1, 80, 4, hist.length)).toEqual({ excluded: back.excluded, start: back.start });
  });

  it("matches today's measured regimes", () => {
    expect(production("dhana-nidhanaya").regime).toMatchObject({ count: 82, start: 0, excluded: [] });
    const ada = production("ada-kotipathi");
    expect(ada.regime.excluded).toEqual([77, 78, 79, 80]);
    expect(ada.regime.count).toBe(76);
    // 1..76 since 2023-07-04 (spec 2.3). The pool is every regime draw that is not a usable jackpot draw (partition
    // rule), so its size follows the archive: 1,189 on 2026-10-27, one more with each daily draw.
    const adaDraws = loadDraws("ada-kotipathi");
    expect(adaDraws[ada.regime.start].draw_date).toBe("2023-07-04");
    const asJackpot = ada.evidence.excluded.filter((i) => i >= ada.regime.start).length;
    expect(ada.pool).toHaveLength(adaDraws.length - ada.regime.start - asJackpot);
    expect(production("kapruka").regime.excluded).toEqual([76, 77, 78, 79, 80]);
  });
});

// ---------------------------------------------------------------- calendar (2.7)

describe("calendar fit", () => {
  const spread = Array.from({ length: 10 }, (_, i) => addDays("2025-01-01", 9 * i));

  it("A1inv (Best-Fisher) is increasing and unbounded at 1", () => {
    expect(a1inv(0)).toBe(0);
    expect(a1inv(0.1)).toBeCloseTo(0.2 + 0.001 + 0.00000833, 8);
    let prev = -1;
    for (let r = 0; r < 0.999; r += 0.001) {
      const v = a1inv(r);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(a1inv(1)).toBe(Infinity);
  });

  it("uniformly spread dates give kappa = 0 for every feature", () => {
    const fit = fitCalendar(spread);
    expect(fit.clusters).toBe(10);
    expect(fit.nEff).toBe(10);
    for (const f of fit.features) expect(f.kappa).toBe(0);
  });

  it("7 dates one synodic month apart (all at the same moon phase) give kappa_moon = KAPPA_MAX", () => {
    const dates = Array.from({ length: 7 }, (_, i) => addDays("2025-01-13", Math.round(i * V2_CONSTANTS.SYNODIC)));
    const fit = fitCalendar(dates);
    expect(fit.clusters).toBe(7);
    expect(fit.features[0].feature).toBe("moonPhase");
    expect(fit.features[0].kappa).toBe(V2_CONSTANTS.KAPPA_MAX);
    expect(fit.features[0].rayleighP).toBeLessThan(0.01);
  });

  it("de-clusters wins within 7 days of a cluster's first date; each cluster counts as one independent date (n_eff = clusters)", () => {
    // 01-05 is 4 days after 01-01 (same cluster); 01-12 is 11 days after the cluster's first date, so it starts a new
    // one, although it is only 7 days after 01-05 (fixed windows, not chains); 02-01 is a cluster of its own.
    const w = declusterWeights(["2025-01-01", "2025-01-05", "2025-01-12", "2025-02-01"]);
    expect(w.clusters).toBe(3);
    expect(w.weights).toEqual([1 / 2, 1 / 2, 1, 1]);
    expect(fitCalendar(["2025-01-01", "2025-01-05", "2025-01-12", "2025-02-01"]).nEff).toBe(3);
    // A date exactly DECLUSTER_DAYS after the first is still inside its window.
    expect(declusterWeights(["2025-01-01", "2025-01-08"]).clusters).toBe(1);
    expect(declusterWeights(["2025-01-01", "2025-01-09"]).clusters).toBe(2);
    const same = fitCalendar(Array(7).fill("2025-05-05"));
    expect(same.clusters).toBe(1);
    expect(same.nEff).toBe(1);
    for (const f of same.features) {
      expect(f.kappa).toBe(0);
      expect(f.rayleighP).toBe(1);
    }
    expect(fitCalendar(["2025-05-05"]).nEff).toBe(1);
    // No jump between one cluster and two: 7 near-identical dates plus 1 far away are 2 dates (the Kish size of the
    // weights would say 3.5), and adding dates to an existing cluster never raises n_eff.
    const sevenPlusOne = fitCalendar([...Array(7).fill("2025-05-05"), "2025-09-01"]);
    expect([sevenPlusOne.clusters, sevenPlusOne.nEff]).toEqual([2, 2]);
    expect(fitCalendar(["2025-05-05", "2025-09-01"]).nEff).toBe(2);
    expect(fitCalendar(["2025-05-05", "2025-05-06", "2025-09-01", "2025-09-03"]).nEff).toBe(2);
    // n_eff never exceeds the number of dates or of clusters.
    for (let n = 1; n <= 12; n++) {
      const dates = Array.from({ length: n }, (_, i) => addDays("2025-01-01", 5 * i + (i % 3 === 0 ? 20 * i : 0)));
      const fit = fitCalendar(dates);
      expect(fit.nEff).toBe(fit.clusters);
      expect(fit.nEff).toBeLessThanOrEqual(n);
    }
    // The own dates of 2026-10-27 (frozen snapshot): Dhana Nidhanaya 7 dates in 6 clusters (a pair 2 days apart), so
    // n_eff = 6.
    const { draws, jackpots } = frozen("dhana-nidhanaya");
    const dhana = posteriorAt(buildContext(LOTTERY_BY_ID["dhana-nidhanaya"], draws, jackpots), draws.length, "2026-10-28").calendar!;
    expect([dhana.dates, dhana.clusters, dhana.nEff]).toEqual([7, 6, 6]);
  });

  it("no cluster spans more than 7 days: weekly wins and long chains stay several calendar positions", () => {
    // 9 wins on consecutive Fridays (7 days apart): fixed windows give 5 clusters (pairs and a last single), so the
    // weekday pattern is seen. Chains of gaps <= 7 days would have made them one cluster, n_eff = 1, every kappa 0.
    const fridays = Array.from({ length: 9 }, (_, q) => addDays("2024-03-01", 7 * q)); // 2024-03-01 is a Friday
    const weekly = fitCalendar(fridays);
    expect([weekly.dates, weekly.clusters, weekly.nEff]).toEqual([9, 5, 5]);
    const weekday = weekly.features[2];
    expect(weekday.feature).toBe("weekday");
    expect(weekday.resultant).toBeCloseTo(1, 12);
    expect(weekday.kappa).toBe(V2_CONSTANTS.KAPPA_MAX);
    expect(weekday.rayleighP).toBeLessThan(0.05);
    // The same weekday 14 days apart: 9 clusters, the same weekday pattern.
    const fortnightly = fitCalendar(Array.from({ length: 9 }, (_, q) => addDays("2024-03-01", 14 * q)));
    expect(fortnightly.clusters).toBe(9);
    expect(fortnightly.features[2].kappa).toBe(V2_CONSTANTS.KAPPA_MAX);
    // 30 dates with gaps of 6 and 7 days (about 195 days): one chain, but 14 or more windows of at most 7 days.
    const chain: string[] = [];
    for (let q = 0, d = "2024-01-02"; q < 30; q++, d = addDays(d, q % 2 ? 6 : 7)) chain.push(d);
    const long = fitCalendar(chain);
    const span = (Date.parse(chain[29]) - Date.parse(chain[0])) / 86_400_000;
    expect(span).toBeGreaterThan(180);
    expect(long.clusters).toBeGreaterThanOrEqual(Math.ceil(span / 14));
    for (const { weights, clusters } of [declusterWeights(chain), declusterWeights(fridays)]) {
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(clusters, 12);
    }
    // Every cluster's dates lie within 7 days of its first date.
    const w = declusterWeights(chain).weights;
    for (let i = 0; i < chain.length; ) {
      const size = Math.round(1 / w[i]);
      expect((Date.parse(chain[i + size - 1]) - Date.parse(chain[i])) / 86_400_000).toBeLessThanOrEqual(V2_CONSTANTS.DECLUSTER_DAYS);
      i += size;
    }
  });

  it("the bias correction and the Rayleigh test use n_eff = clusters", () => {
    // Two clusters at (almost) the same moon phase, one of them 7 dates: R near 1, Rc^2 = (2 R^2 - 1) / (2 - 1).
    const fit = fitCalendar([...Array(7).fill("2025-01-13"), addDays("2025-01-13", Math.round(3 * V2_CONSTANTS.SYNODIC))]);
    expect(fit.nEff).toBe(2);
    const moon = fit.features[0];
    expect(moon.resultant).toBeGreaterThan(0.99);
    const rc2 = (2 * moon.resultant * moon.resultant - 1) / (2 - 1);
    expect(moon.kappa).toBe(Math.min(V2_CONSTANTS.KAPPA_MAX, a1inv(Math.sqrt(rc2))));
    expect(moon.kappa).toBe(V2_CONSTANTS.KAPPA_MAX);
    expect(moon.rayleighP).toBe(rayleighP(2, moon.resultant));
    // The same 8 dates under the old Kish size (3.5) would have given a smaller p-value: n_eff is the cluster count.
    expect(moon.rayleighP).toBeGreaterThan(rayleighP(3.5, moon.resultant));
  });

  it("moon phase: published full and new moons", () => {
    for (const fullMoon of ["2025-03-14", "2025-09-07", "2026-03-03", "2026-08-28"]) {
      expect(Math.abs(moonPhase(fullMoon) - 0.5)).toBeLessThan(0.04); // total/partial lunar eclipses
    }
    for (const newMoon of ["2024-04-08", "2026-08-12"]) {
      const p = moonPhase(newMoon); // total solar eclipses
      expect(Math.min(p, 1 - p)).toBeLessThan(0.04);
    }
  });

  it("angles, Rayleigh and Holm", () => {
    const [, dom, wd] = calendarAngles("2026-10-25"); // a Sunday
    expect(wd).toBe(0);
    expect(dom).toBeCloseTo((2 * Math.PI * 24.5) / 31, 12);
    expect(rayleighP(7, 0)).toBe(1);
    expect(rayleighP(7, 0.5)).toBeGreaterThan(rayleighP(7, 0.8));
    const holm = holmAdjust([0.068, 0.345, 0.676]);
    expect(holm[0]).toBeCloseTo(0.204, 12);
    expect(holm[1]).toBeCloseTo(0.69, 12);
    expect(holm[2]).toBeCloseTo(0.69, 12);
  });
});

// ---------------------------------------------------------------- shape nulls (2.5)

function subsets(support: number[], k: number): number[][] {
  const out: number[][] = [];
  const rec = (from: number, acc: number[]) => {
    if (acc.length === k) {
      out.push([...acc]);
      return;
    }
    for (let i = from; i < support.length; i++) rec(i + 1, [...acc, support[i]]);
  };
  rec(0, []);
  return out;
}

describe("shape nulls", () => {
  for (const support of [
    Array.from({ length: 20 }, (_, i) => i + 1),
    [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20],
  ]) {
    it(`match brute force on C(${support.length},4)`, () => {
      const st = shapeNull(support, 4);
      const all = subsets(support, 4);
      expect(st.total).toBe(all.length);
      expect(choose(support.length, 4)).toBe(all.length);
      const sums = new Map<number, number>();
      const spreads = new Map<number, number>();
      const odds = new Map<number, number>();
      for (const s of all) {
        const sum = s.reduce((a, b) => a + b, 0);
        sums.set(sum, (sums.get(sum) ?? 0) + 1);
        spreads.set(s[3] - s[0], (spreads.get(s[3] - s[0]) ?? 0) + 1);
        const odd = s.filter((n) => n % 2).length;
        odds.set(odd, (odds.get(odd) ?? 0) + 1);
      }
      st.sumCounts.forEach((c, x) => expect(c).toBe(sums.get(x) ?? 0));
      st.spreadCounts.forEach((c, x) => expect(c).toBe(spreads.get(x) ?? 0));
      st.oddCounts.forEach((c, x) => expect(c).toBe(odds.get(x) ?? 0));
      // Tercile edges: first spreads where the null CDF reaches 1/3 and 2/3; band: first sums reaching 10% and 90%.
      const firstReaching = (counts: Map<number, number>, q: number) => {
        const keys = [...counts.keys()].sort((a, b) => a - b);
        let cum = 0;
        for (const x of keys) {
          cum += counts.get(x)!;
          if (cum / all.length >= q - 1e-12) return x;
        }
        return NaN;
      };
      expect(st.spreadEdges).toEqual([firstReaching(spreads, 1 / 3), firstReaching(spreads, 2 / 3)]);
      expect(st.sumBand).toEqual([firstReaching(sums, 0.1), firstReaching(sums, 0.9)]);
      // Bin probabilities sum to 1 and equal the brute-force bin shares.
      for (const f of ["odd", "spread"] as const) {
        expect(st.p0[f].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
        const counts = [0, 0, 0];
        for (const s of all) counts[binsOf(s, st)[f]]++;
        counts.forEach((c, b) => expect(st.p0[f][b]).toBeCloseTo(c / all.length, 14));
      }
      const oddBinOf = (s: number[]) => {
        const o = s.filter((n) => n % 2).length;
        return o <= 1 ? 0 : o === 2 ? 1 : 2;
      };
      for (const s of all.slice(0, 500)) expect(binsOf(s, st).odd).toBe(oddBinOf(s));
    });
  }

  it("typicality: 1-2-3-4 fails, the sum band is inclusive, odd 1..3, at most one consecutive pair", () => {
    const st = shapeNull(Array.from({ length: 80 }, (_, i) => i + 1), 4);
    expect(isTypical([1, 2, 3, 4], st)).toBe(false);
    expect(isTypical([10, 25, 47, 63], st)).toBe(true);
    expect(isTypical([10, 11, 30, 31], st)).toBe(false); // two consecutive pairs
    expect(isTypical([20, 21, 50, 63], st)).toBe(true); // one pair is fine
    expect(isTypical([10, 20, 40, 60], st)).toBe(false); // no odd number
    expect(isTypical([11, 21, 41, 61], st)).toBe(false); // four odd numbers
    const [s10, s90] = st.sumBand;
    const withSum = (sum: number) => [6, 21, 40, sum - 67];
    expect(isTypical(withSum(s10), st)).toBe(true);
    expect(isTypical(withSum(s10 - 1), st)).toBe(false);
    const high = (sum: number) => [30, 45, 61, sum - 136];
    expect(isTypical(high(s90), st)).toBe(true);
    expect(isTypical(high(s90 + 1), st)).toBe(false);
  });
});

// ---------------------------------------------------------------- guard ladder (2.14)

describe("guard ladder", () => {
  it("hypergeometric tails and today's rungs", () => {
    const tail = (L: number, j: number, c: number) => {
      let s = 0;
      for (let x = c + 1; x <= Math.min(4, j); x++) s += choose(j, x) * choose(L - j, 4 - x);
      return s / choose(L, 4);
    };
    expect(hyperTail(82, 4, 4, 1)).toBeCloseTo(tail(82, 4, 1), 15);
    expect(hyperTail(82, 4, 4, 1)).toBeCloseTo(0.01048, 5);
    expect(hyperTail(82, 12, 4, 2)).toBeCloseTo(0.00909, 5);
    expect(hyperTail(80, 4, 4, 4)).toBe(0);
    const dhana = guardRung(82, [4, 4, 4], 12, 4);
    expect([dhana.perCombination, dhana.union]).toEqual([1, 2]);
    expect(dhana.excludedShare).toBeCloseTo(0.0405, 4);
    const gov = guardRung(80, [4, 4], 8, 4);
    expect([gov.perCombination, gov.union]).toEqual([1, 2]);
    expect(gov.excludedShare).toBeCloseTo(0.0246, 4);
    expect(guardRung(80, [], 0, 4)).toEqual({ perCombination: 1, union: 2, excludedShare: 0 });
  });

  it("loosens as disjoint combinations accumulate and never excludes more than GUARD_ALPHA", () => {
    const rungAt = (n: number) => {
      const r = guardRung(80, new Array(n).fill(4), Math.min(80, 4 * n), 4);
      expect(r.excludedShare).toBeLessThanOrEqual(V2_CONSTANTS.GUARD_ALPHA);
      expect(r.excludedShare).toBeCloseTo(guardExcluded(80, new Array(n).fill(4), Math.min(80, 4 * n), 4, r.perCombination, r.union), 15);
      return `${r.perCombination},${r.union}`;
    };
    for (let n = 1; n <= 3; n++) expect(rungAt(n)).toBe("1,2");
    expect(rungAt(4)).toBe("1,3");
    for (let n = 5; n <= 9; n++) expect(rungAt(n)).toBe("2,3");
    for (const n of [10, 20, 100, 259]) expect(rungAt(n)).toBe("2,4");
    expect(rungAt(260)).toBe("3,4");
  });
});

// ---------------------------------------------------------------- order cap and posterior (2.9, 2.10)

describe("order cap and posterior", () => {
  const p0 = new Float64Array(10).fill(0.1);
  const counts = (m: number, tilt: number[]) => Float64Array.from(p0, (p, x) => m * p + (tilt[x] ?? 0));

  it("damps lower sources to ORDER of the source above, never inflates, keeps leans bounded and parts exact", () => {
    const J = { e: counts(40, [3, -3]), m: 40 };
    const T = { e: counts(60, [10, 0, -10]), m: 60 };
    const D = { e: counts(500, [0, 40, 0, -40, 20, -20]), m: 500 };
    const ch = assembleChannel([J, T, D], p0, 50);
    expectChannelInvariants(ch);
    expect(ch.damping[0]).toBe(1);
    expect(ch.share[1]).toBeCloseTo(0.75 * ch.share[0], 12);
    expect(ch.share[2]).toBeCloseTo(0.75 * ch.share[1], 12);
    expect(ch.share[0] + ch.share[1] + ch.share[2]).toBeCloseTo(1, 12);
    expect(ch.pull).toEqual([6, 20, 120]);
  });

  it("an absent source passes the ceiling through; a silent one holds everything below it at 0", () => {
    const J = { e: counts(40, [3, -3]), m: 40 };
    const D = { e: counts(500, [0, 40, -40]), m: 500 };
    const absentT = assembleChannel([J, { e: new Float64Array(10), m: 0 }, D], p0, 50);
    expect(absentT.present).toEqual([true, false, true]);
    expect(absentT.damping[1]).toBe(1);
    expect(absentT.share[1]).toBe(0);
    expect(absentT.share[2]).toBeCloseTo(0.75 * absentT.share[0], 12);
    const silentT = assembleChannel([J, { e: counts(60, []), m: 60 }, D], p0, 50);
    expect(silentT.present).toEqual([true, true, true]);
    expect(silentT.pull[1]).toBe(0);
    expect(silentT.damping[2]).toBe(0);
    expect(silentT.share).toEqual([1, 0, 0]);
    expectChannelInvariants(silentT);
    const none = assembleChannel([{ e: new Float64Array(10), m: 0 }, { e: new Float64Array(10), m: 0 }, { e: new Float64Array(10), m: 0 }], p0, 50);
    expect(none.share).toEqual([0, 0, 0]);
    for (let x = 0; x < 10; x++) expect(none.theta[x]).toBe(0.1);
  });

  it("raises the prior (MAX_LIFT) instead of letting a lone strong source leave the lean bounds", () => {
    const D = { e: counts(1000, [300, -300, 150, -150]), m: 1000 };
    const ch = assembleChannel([{ e: new Float64Array(10), m: 0 }, { e: new Float64Array(10), m: 0 }, D], p0, 50);
    expectChannelInvariants(ch);
    expect(ch.flatten).toBeGreaterThan(1);
    expect(Math.max(...Array.from(ch.theta, (v) => v / 0.1))).toBeCloseTo(V2_CONSTANTS.MAX_LIFT, 12);
  });

  for (const id of ["dhana-nidhanaya", "govisetha", "mega-power", "kapruka"]) {
    it(`${id}: every channel keeps the order, the bounds and exact parts`, () => {
      for (const [, ch] of channelsOf(production(id))) expectChannelInvariants(ch);
    });
  }

  it("the jackpot-combination number part is constant within each decade (no exact-number favouring)", () => {
    for (const id of ["dhana-nidhanaya", "govisetha"]) {
      const p = production(id);
      expect(p.num.present[0]).toBe(true);
      const byDecade = new Map<number, number>();
      for (let j = 0; j < p.num.p0.length; j++) {
        if (!p.regime.live[j]) continue;
        const g = decadeOf(j + 1);
        if (!byDecade.has(g)) byDecade.set(g, p.num.parts[0][j]);
        expect(p.num.parts[0][j]).toBe(byDecade.get(g));
      }
      expect(new Set(byDecade.values()).size).toBeGreaterThan(1);
    }
    expect([1, 10, 11, 70, 71, 80, 81, 82].map(decadeOf)).toEqual([0, 0, 1, 6, 7, 7, 7, 7]);
  });

  it("uses only the lottery's own jackpot items", () => {
    // On the frozen snapshot of 2026-10-27 (draws and jackpots.json of the golden fixture), so the pinned counts stay
    // those of that day while data/ grows.
    const { draws, jackpots } = frozen("govisetha");
    const own = jackpots.filter((j) => j.lotteryId === "govisetha");
    const a = posteriorAt(buildContext(LOTTERY_BY_ID.govisetha, draws, jackpots), draws.length, "2026-10-28");
    const b = posteriorAt(buildContext(LOTTERY_BY_ID.govisetha, draws, [...own].reverse()), draws.length, "2026-10-28");
    expect(Array.from(b.num.theta)).toEqual(Array.from(a.num.theta));
    expect(b.evidence.combinations.map((c) => c.drawNo)).toEqual([4415, 4419]);
    expect(b.evidence.excluded).toHaveLength(2);
    expect(draws).toHaveLength(208);
    expect(b.pool).toHaveLength(206);
    // The same rule on the live data, whatever it holds: every own item counts, another lottery's never does.
    const live = loadDraws("govisetha");
    const liveOwn = JACKPOTS.filter((j) => j.lotteryId === "govisetha");
    const c = posteriorAt(buildContext(LOTTERY_BY_ID.govisetha, live, JACKPOTS), live.length, nextDrawDate(live.map((d) => d.draw_date)));
    const d = posteriorAt(buildContext(LOTTERY_BY_ID.govisetha, live, [...liveOwn].reverse()), live.length, nextDrawDate(live.map((x) => x.draw_date)));
    expect(Array.from(d.num.theta)).toEqual(Array.from(c.num.theta));
    expect(d.pool).toHaveLength(live.length - d.regime.start - d.evidence.excluded.filter((i) => i >= d.regime.start).length);
  });
});

// ---------------------------------------------------------------- cards, rules and labels (2.14, 2.15)

describe("cards", () => {
  it("every card passes R1-R5 and the cards differ pairwise (R4)", () => {
    const id = "dhana-nidhanaya";
    const draws = loadDraws(id);
    const lottery = LOTTERY_BY_ID[id];
    const p = predictV2({ lottery, draws, jackpots: JACKPOTS, generatedAt: "2026-10-28T00:00:00Z", v1: predict(lottery, draws, "x") });
    const post = production(id);
    const past = new Set(draws.map((d) => ticketKey([...d.numbers].sort((a, b) => a - b))));
    expect(p.sets.map((s) => s.source)).toEqual(["all", "jackpotCombinations", "jackpotDates", "dailyDraws", "luckyDip"]);
    for (const s of p.sets) {
      expect(s.numbers).toHaveLength(4);
      expect([...s.numbers].sort((a, b) => a - b)).toEqual(s.numbers);
      expect(s.numbers.every((n) => post.regime.live[n - 1] === 1)).toBe(true); // R5
      expect(isTypical(s.numbers, post.shape)).toBe(true); // R2
      expect(past.has(ticketKey(s.numbers))).toBe(false); // R3
      // R1 at the rung of the day ((1, 2) on 2026-10-27; it loosens by itself as jackpot combinations accumulate)
      for (const combo of post.combos) expect(s.numbers.filter((n) => combo.includes(n)).length).toBeLessThanOrEqual(post.guard.perCombination);
      expect(s.numbers.filter((n) => post.union.includes(n)).length).toBeLessThanOrEqual(post.guard.union);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
    for (let a = 0; a < p.sets.length; a++) {
      for (let b = a + 1; b < p.sets.length; b++) {
        const shared = p.sets[a].numbers.filter((n) => p.sets[b].numbers.includes(n)).length;
        expect(shared).toBeLessThanOrEqual(V2_CONSTANTS.SET_OVERLAP); // R4
      }
    }
    expect(p.sets[0].orderHeld).toBe(true);
  });

  it("only the Lucky dip draws from the stream after the tie keys; cards 2-4 are deterministic, chosen in the selection order", () => {
    for (const id of ["dhana-nidhanaya", "mega-power", "kapruka"]) {
      const draws = loadDraws(id);
      const ctx = buildContext(LOTTERY_BY_ID[id], draws, JACKPOTS);
      const post = posteriorAt(ctx, draws.length, nextDrawDate(ctx.dates));
      const past = new Set(ctx.keys.filter((k) => k >= 0));
      const stream = streamAt(ctx, post);
      const top = topPickAt(ctx, post, stream, past);
      const cards = cardsAt(ctx, post, stream, past, top);
      // The same tie keys with a different stream afterwards: cards 1-4 stay, the Lucky dip moves.
      const other = { ...streamAt(ctx, post), rng: mulberry32(12345) };
      const again = cardsAt(ctx, post, other, past, topPickAt(ctx, post, other, past));
      const ticket = (c: { letter: string | null; numbers: number[]; bonus: number | null }) => `${c.letter} ${c.numbers.join(" ")} ${c.bonus}`;
      expect(again.slice(0, 4).map(ticket), id).toEqual(cards.slice(0, 4).map(ticket));
      expect(ticket(again[4]), id).not.toBe(ticket(cards[4]));
      expect(cards.map((c) => c.sampled)).toEqual([false, false, false, false, true]);
      // Selection order: Top pick, the cards whose source moves the picks (J, T, D), the balanced cards, the Lucky dip.
      const moving = [0, 1, 2].filter((s) => cards[s + 1].mode === "source");
      const balanced = [0, 1, 2].filter((s) => cards[s + 1].mode === "balanced");
      expect(moving.length + balanced.length).toBe(3);
      expect([...moving, ...balanced].map((s) => cards[s + 1].selection)).toEqual([1, 2, 3]);
      expect([cards[0].selection, cards[4].selection]).toEqual([0, 4]);
    }
  });

  it("card labels for absent and silent sources: always the short base label; the reason is in the note", () => {
    const sources = ["all", "jackpotCombinations", "jackpotDates", "dailyDraws", "luckyDip"] as const;
    expect(sources.map((s) => cardLabel(s))).toEqual(["Top pick", "Jackpot pattern", "Jackpot days", "Daily draws", "Lucky dip"]);
    expect(Object.values(CARD_LABELS)).toEqual(sources.map((s) => cardLabel(s)));

    const states = (present: boolean[], pull: number[], damping: number[]) => {
      const num = { present, pull, damping } as unknown as Channel;
      return [0, 1, 2].map((s) => sourceState(num, s)) as [SourceStateName, SourceStateName, SourceStateName];
    };
    const notes = (status: CardNoteInput["status"], st: CardNoteInput["states"]) => {
      const x = { status, states: st };
      return sources.map((s, i) => {
        const mode = i === 0 ? "top" : i === 4 ? "uniform" : st[i - 1] === "active" ? "source" : "balanced";
        return cardNote(s, mode, x);
      });
    };
    const LUCKY = "A random ticket that follows the same pick rules. It has exactly the same chance as every other card.";
    const ABSENT_J = "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence.";

    // No own jackpot item (DLB): daily draws only.
    const none = states([false, false, true], [0, 0, 5], [1, 1, 1]);
    expect(none).toEqual(["absent", "absent", "active"]);
    expect(notes("none", none)).toEqual([
      "Daily draws only; no jackpot win is known yet.",
      ABSENT_J,
      "No jackpot dates are known yet, so this card is a balanced pick from all the evidence.",
      "What the daily draws alone point to.",
      LUCKY,
    ]);
    // Dates but no winning numbers (Mega Power).
    const datesOnly = states([false, true, true], [0, 4, 5], [1, 1, 0.5]);
    expect(notes("dates-only", datesOnly).slice(0, 3)).toEqual([
      "Jackpot dates and daily draws together; no jackpot numbers are known yet.",
      ABSENT_J,
      "Follows the draws held on calendar days similar to past jackpot dates.",
    ]);
    // Silent dates (strict chain): nothing moves the picks.
    const silent = states([false, true, true], [0, 0, 5], [1, 1, 0]);
    expect(silent).toEqual(["absent", "silent", "held"]);
    expect(notes("dates-only", silent)).toEqual([
      "No source moves the picks yet, so every ball counts the same.",
      ABSENT_J,
      "The jackpot dates show no calendar pattern yet, so this card is a balanced pick from all the evidence.",
      "Daily draws are held back while the dates show no pattern, so this card is a balanced pick.",
      LUCKY,
    ]);
    // Combinations whose dates are silent: the combinations alone.
    const comboOnly = states([true, true, true], [3, 0, 5], [1, 1, 0]);
    expect(notes("combinations", comboOnly).slice(0, 4)).toEqual([
      "Jackpot combinations only; the jackpot dates show no calendar pattern yet.",
      "Follows the tens, odd/even mix, spread and letter of past jackpots.",
      "The jackpot dates show no calendar pattern yet, so this card is a balanced pick from all the evidence.",
      "Daily draws are held back while the dates show no pattern, so this card is a balanced pick.",
    ]);
    // All three sources move the picks.
    const all = states([true, true, true], [3, 2, 5], [1, 1, 0.1]);
    expect(notes("combinations", all)).toEqual([
      "All three sources together, jackpot combinations first.",
      "Follows the tens, odd/even mix, spread and letter of past jackpots.",
      "Follows the draws held on calendar days similar to past jackpot dates.",
      "What the daily draws alone point to.",
      LUCKY,
    ]);
    // Silent combinations hold the dates back too.
    const silentJ = states([true, true, true], [0, 2, 5], [1, 0, 0]);
    expect(silentJ).toEqual(["silent", "held", "held"]);
    expect(notes("combinations", silentJ).slice(0, 4)).toEqual([
      "No source moves the picks yet, so every ball counts the same.",
      "The jackpot numbers show no pattern yet, so this card is a balanced pick from all the evidence.",
      "Jackpot dates are held back while the jackpot numbers show no pattern, so this card is a balanced pick.",
      "Daily draws are held back while the sources above them show no pattern, so this card is a balanced pick.",
    ]);
  });

  it("the order note speaks only of the numbers the Top pick was chosen among (CAND, or the fallback pool)", () => {
    const base = {
      name: "Test Lotto",
      status: "combinations" as const,
      known: { wins: 1, combinations: 1, dates: 1 },
      datesUsed: 1,
      datesOlderThanArchive: 0,
      datesSilent: false,
      topLetter: null,
      jackpotLetters: [],
      unmodelledBonus: null,
      present: [true, true, true] as const,
      pending: [],
      excludedBalls: [],
      deadRun: 270,
      regimeSince: "2026-03-27",
      backtestDraws: 178,
    };
    expect(predictionNotes({ ...base, orderHeld: true, orderSearched: 24 }).some((n) => /keeps the order/.test(n))).toBe(false);
    for (const size of [24, 32]) {
      expect(predictionNotes({ ...base, orderHeld: false, orderSearched: size })).toContain(
        `Among the ${size} highest-lean numbers, no ticket that follows the pick rules keeps the order jackpot combinations, ` +
          "then jackpot dates, then daily draws, so the Top pick is the best of them without that order.",
      );
    }
  });

  it("the order note names only the sources present, like explanation.sets (no jackpot combinations for Mega Power)", () => {
    // Mega Power today: dates and daily draws present, no jackpot numbers. The order checked is dates >= daily draws.
    const datesOnly = predictionNotes({
      name: "Mega Power",
      status: "dates-only",
      known: { wins: 11, combinations: 0, dates: 9 },
      datesUsed: 9,
      datesOlderThanArchive: 9,
      datesSilent: false,
      topLetter: null,
      jackpotLetters: [],
      unmodelledBonus: null,
      present: [false, true, true],
      orderHeld: false,
      orderSearched: 24,
      pending: [],
      excludedBalls: [],
      deadRun: 270,
      regimeSince: "2026-03-27",
      backtestDraws: 178,
    });
    const order = datesOnly.filter((n) => /keeps the order/.test(n));
    expect(order).toEqual([
      "Among the 24 highest-lean numbers, no ticket that follows the pick rules keeps the order jackpot dates, then daily " +
        "draws, so the Top pick is the best of them without that order.",
    ]);
    expect(order[0]).not.toMatch(/jackpot combinations/);
  });

  it("an absent source with items known but not usable yet says 'can be used yet', never 'known yet'", () => {
    const states: CardNoteInput["states"] = ["absent", "absent", "active"];
    const pending = { status: "none" as const, states, known: { wins: 1, combinations: 1, dates: 1 } };
    expect(cardNote("all", "top", pending)).toBe("Daily draws only; no jackpot win can be used yet.");
    expect(cardNote("jackpotCombinations", "balanced", pending)).toBe(
      "No jackpot numbers can be used yet, so this card is a balanced pick from all the evidence.",
    );
    expect(cardNote("jackpotDates", "balanced", pending)).toBe(
      "No jackpot dates can be used yet, so this card is a balanced pick from all the evidence.",
    );
    // Only undated wins: no numbers and no dates are known, but a win is.
    const undated = { status: "none" as const, states, known: { wins: 2, combinations: 0, dates: 0 } };
    expect(cardNote("all", "top", undated)).toBe("Daily draws only; no jackpot win can be used yet.");
    expect(cardNote("jackpotCombinations", "balanced", undated)).toBe(
      "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence.",
    );
    // Mega Power today: dates in use, no numbers known at all.
    const datesOnly = { status: "dates-only" as const, states: ["absent", "active", "active"] as CardNoteInput["states"], known: { wins: 11, combinations: 0, dates: 9 } };
    expect(cardNote("all", "top", datesOnly)).toBe("Jackpot dates and daily draws together; no jackpot numbers are known yet.");
  });
});

// ---------------------------------------------------------------- whole percents (13)

describe("wholePercents", () => {
  const split = (j: number, t: number, d: number) => ({ jackpotCombinations: j, jackpotDates: t, dailyDraws: d });

  it("whole percents that add up to 100 by the largest remainder; ties in the owner's order J, T, D", () => {
    // Dhana Nidhanaya today: 53.61 / 26.51 / 19.88 -> the two largest remainders (D .88, J .61) get the missing points.
    expect(wholePercents(split(0.5361, 0.2651, 0.1988))).toEqual(split(54, 26, 20));
    expect(splitText(split(0.5361, 0.2651, 0.1988))).toBe("Jackpot combinations 54% · Jackpot dates 26% · Daily draws 20%");
    expect(wholePercents(split(0, 0.5714, 0.4286))).toEqual(split(0, 57, 43)); // Mega Power
    expect(wholePercents(split(0, 0, 1))).toEqual(split(0, 0, 100)); // DLB
    expect(wholePercents(split(1 / 3, 1 / 3, 1 / 3))).toEqual(split(34, 33, 33)); // a three-way tie: J first
    expect(wholePercents(split(0.3333, 0.3333, 0.3333))).toEqual(split(34, 33, 33)); // r4 shares that sum to 0.9999
    expect(wholePercents(split(0.3333, 0.3333, 0.3334))).toEqual(split(33, 33, 34));
    expect(wholePercents(split(0.005, 0.005, 0.99))).toEqual(split(1, 0, 99)); // a tie of .5 and .5: J before T
    expect(wholePercents(split(0.25, 0.25, 0.5))).toEqual(split(25, 25, 50)); // exact: nothing to distribute
    expect(wholePercents(split(0.29, 0.71, 0))).toEqual(split(29, 71, 0)); // float noise (100 x 0.29 = 28.999...)
  });

  it("an absent (0) source stays 0, all 0 gives all 0, and non-finite or negative shares count as 0", () => {
    expect(wholePercents(split(0, 0.335, 0.665))).toEqual(split(0, 34, 66)); // the tie goes to T; J stays 0
    expect(wholePercents(split(0, 0, 0))).toEqual(split(0, 0, 0));
    expect(wholePercents(split(Number.NaN, -0.2, 1))).toEqual(split(0, 0, 100));
  });

  it("always 100 when any share is above 0, each within one point of its exact percent (seeded property check)", () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 2000; i++) {
      const raw = [rng(), rng(), rng()].map((v) => (v < 0.2 ? 0 : v)); // some absent sources
      const total = raw[0] + raw[1] + raw[2];
      if (total === 0) continue;
      const shares = raw.map((v) => Math.round((v / total) * 1e4) / 1e4); // r4, as in the payload
      const p = wholePercents(split(shares[0], shares[1], shares[2]));
      const got = [p.jackpotCombinations, p.jackpotDates, p.dailyDraws];
      expect(got[0] + got[1] + got[2]).toBe(100);
      const sum = shares[0] + shares[1] + shares[2];
      for (let s = 0; s < 3; s++) {
        expect(Number.isInteger(got[s])).toBe(true);
        expect(Math.abs(got[s] - (100 * shares[s]) / sum)).toBeLessThan(1);
        if (shares[s] === 0) expect(got[s]).toBe(0);
      }
    }
  });
});

// ---------------------------------------------------------------- power at the verdict's cut (5.2, 5.4)

describe("power: the effect the power sentence names survives the verdict's Holm judgement 4 times in 5", () => {
  /** Does check 0 (the hit check) survive Holm at 5% over these z-scores? Exactly the verdict's rule (holmView). */
  const hitSurvives = (zs: number[]) => holmAdjust(zs.map(normalP))[0] < 0.05;

  it("holmFirstCut(m) is the first Holm step over m checks (two-sided p = 0.05 / m); Z_POWER is the 80% point", () => {
    for (const [m, z] of [
      [1, 1.96],
      [4, 2.4977],
      [5, 2.5758],
      [7, 2.6901],
    ] as const) {
      expect(holmFirstCut(m)).toBeCloseTo(z, 3);
      expect(Math.abs(normalP(holmFirstCut(m)) - 0.05 / m)).toBeLessThan(1e-12);
    }
    expect(Z_POWER).toBeCloseTo(0.8416, 4);
    expect(mdeSE(7)).toBeCloseTo(holmFirstCut(7) + Z_POWER, 12);
    // Past the cut, the hit check survives Holm whatever the other checks show; just inside it, with null others, not.
    for (const m of [2, 4, 5, 7]) {
      const cut = holmFirstCut(m);
      for (const others of [Array(m - 1).fill(0), Array(m - 1).fill(4), Array.from({ length: m - 1 }, (_, i) => (i % 2 ? 3 : -0.5))]) {
        expect(hitSurvives([cut + 1e-6, ...others]), `m ${m}`).toBe(true);
      }
      expect(hitSurvives([cut - 1e-6, ...Array(m - 1).fill(0)]), `m ${m}`).toBe(false);
    }
  });

  it("a true effect of mdeSE(m) standard errors survives Holm over m checks in about 80% of seeded runs; 2.8 SE did not", () => {
    const rng = mulberry32(5402);
    const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    const power = (delta: number, m: number, runs: number) => {
      let survived = 0;
      for (let r = 0; r < runs; r++) {
        const zs = [delta + gauss()];
        for (let j = 1; j < m; j++) zs.push(gauss()); // the other checks of the family, at chance
        if (hitSurvives(zs)) survived++;
      }
      return survived / runs;
    };
    for (const m of [4, 5, 7]) {
      // 20,000 runs: SE 0.003 around the analytic 0.80.
      expect(power(mdeSE(m), m, 20_000), `m ${m}`).toBeGreaterThan(0.79);
      // The first version's 2.8 SE (the 95% range's cut + 0.84) is noticed by the verdict only 55-62% of the time.
      expect(power(2.8, m, 20_000), `m ${m}`).toBeLessThan(0.65);
    }
  });
});
