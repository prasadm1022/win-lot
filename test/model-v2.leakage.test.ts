// SPDX-License-Identifier: Apache-2.0
// Leakage tests of the win-lot-jackpot-v2 walk-forward (docs/MODEL-V2.md sections 2.4, 5.1 and 6):
//   (1) future corruption: changing anything at or after draw t (results, extra draws, jackpot items known from
//       date(d_t) on) leaves the step-t record byte-identical;
//   (2) truncation equivalence: predictV2 on draws < t with the jackpots usable before date(d_t) equals the backtest
//       record at t;
//   (3) same-day canary: a jackpot on the last test draw's own date and a DLB reset on the draw before it change
//       nothing; planted at an earlier t, they change no record before step t + 2;
//   (4) evidence-only order: the order of the jackpots.json items does not matter;
//   (5) a winners-directory card first seen on page 1 after the last draw (labelled with that month) changes nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { directoryMonth, type Jackpot, type JackpotSource } from "../lib/jackpots";
import { LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { mulberry32, nextDrawDate, r4 } from "../lib/model";
import {
  addDays,
  backtestStart,
  buildContext,
  knownFrom,
  leanOf,
  posteriorAt,
  predictAllV2,
  predictV2,
  streamAt,
  topPickAt,
  usableAt,
  walkForward,
  type ModelContext,
  type StepRecord,
} from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import { loadDraws, loadJackpots, loadV2Inputs, sha256Json, v2Input } from "../scripts/model-v2-data";

const TIMEOUT = 120_000;
const GENERATED_AT = "2026-10-28T00:00:00Z";
const JACKPOTS = loadJackpots();
/** Combinations (Dhana Nidhanaya, Govisetha), dates only (Mega Power) and a DLB lottery with an integer bonus. */
const LEAK_IDS = ["dhana-nidhanaya", "govisetha", "mega-power", "kapruka"];

const dated = (draws: readonly Draw[]) => draws.map((d) => ({ drawNo: d.draw_no, date: d.draw_date }));
const typed = (_key: string, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v);

/**
 * Everything the walk-forward computes at step t (posterior of every channel, regime, evidence, calendar, pool,
 * guard, tie keys and the Top pick), as JSON. drawBins is cut to the draws before t: it is a per-draw cache over the
 * whole archive, and only its first t entries can be read at step t.
 */
function stepRecord(ctx: ModelContext, t: number, tau: string = ctx.dates[t]): string {
  const post = posteriorAt(ctx, t, tau);
  const stream = streamAt(ctx, post);
  const past = new Set<number>();
  for (let i = 0; i < t; i++) if (ctx.keys[i] >= 0) past.add(ctx.keys[i]);
  const top = topPickAt(ctx, post, stream, past);
  const { drawBins, ...rest } = post;
  return JSON.stringify(
    { post: rest, drawBins: drawBins.subarray(0, 2 * t), keys: [stream.numberKeys, stream.letterKeys, stream.bonusKeys], top },
    typed,
  );
}

function randomTicket(rng: () => number, lottery: Lottery): number[] {
  const s = new Set<number>();
  while (s.size < lottery.main_count) s.add(lottery.main_min + Math.floor(rng() * (lottery.main_max - lottery.main_min + 1)));
  return [...s].sort((a, b) => a - b);
}

function item(lottery: Lottery, d: Draw, source: JackpotSource, numbers: number[] | null, extra: Partial<Jackpot> = {}): Jackpot {
  return {
    lotteryId: lottery.id,
    drawNo: d.draw_no,
    date: d.draw_date,
    letter: d.letter,
    numbers,
    bonus: null,
    jackpotWinners: source === "dlb-jackpot-reset" ? null : 1,
    superPrizeAmount: null,
    source,
    inDrawHistory: true,
    ...extra,
  };
}

/**
 * Corrupt everything that must not be visible at step t: shuffle and overwrite the results of draws t..N-1 (dates and
 * draw numbers stay, so date(d_t) is the same target), append future draws, alter the lottery's own jackpot items
 * that are not known before date(d_t), and add new ones (the test draw's own jackpot, later prize tables, DLB resets of
 * draws t-2.., a directory card listed in date(d_t)'s month, an undated card). Also adds another lottery's jackpot
 * known long before, which must be ignored (own evidence only). Returns the added/altered own items for a sanity check.
 */
function corrupt(lottery: Lottery, draws: Draw[], jackpots: Jackpot[], t: number, seed: number) {
  const rng = mulberry32(seed);
  const letter = () => String.fromCharCode(65 + Math.floor(rng() * 26));
  const out = draws.map((d) => ({ ...d, numbers: [...d.numbers] }));
  const results = out.slice(t).map((d) => ({ numbers: d.numbers, letter: d.letter, bonus: d.bonus }));
  for (let i = results.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [results[i], results[j]] = [results[j], results[i]];
  }
  results.forEach((r, q) => Object.assign(out[t + q], r));
  for (let i = t; i < out.length; i += 3) {
    out[i].numbers = randomTicket(rng, lottery);
    out[i].letter = letter();
  }
  const last = out[out.length - 1];
  for (let q = 1; q <= 5; q++) {
    out.push({ draw_no: last.draw_no + q, draw_date: addDays(last.draw_date, q), letter: letter(), numbers: randomTicket(rng, lottery), bonus: last.bonus });
  }

  const tau = draws[t].draw_date;
  const archive = dated(out);
  const notKnown = (j: Jackpot) => !usableAt(knownFrom(j, archive), tau);
  const own: Jackpot[] = [];
  const altered = jackpots.map((j) => {
    if (j.lotteryId !== lottery.id || usableAt(knownFrom(j, dated(draws)), tau)) return j;
    const changed: Jackpot = {
      ...j,
      numbers: j.numbers ? randomTicket(rng, lottery) : j.numbers,
      letter: j.letter ? letter() : j.letter,
      date: j.date && j.date >= tau ? addDays(j.date, 3) : j.date,
    };
    own.push(changed);
    return changed;
  });
  const d = (i: number) => out[Math.min(Math.max(i, 0), out.length - 1)];
  const added: Jackpot[] = [
    item(lottery, draws[t], "nlb-prize-table", [...draws[t].numbers].sort((a, b) => a - b)), // the test draw's own jackpot
    item(lottery, d(t + 1), "nlb-prize-table", randomTicket(rng, lottery)),
    item(lottery, d(t + 4), "nlb-prize-table", randomTicket(rng, lottery)),
    item(lottery, d(t - 2), "dlb-jackpot-reset", [...d(t - 2).numbers].sort((a, b) => a - b)),
    item(lottery, d(t - 1), "dlb-jackpot-reset", null),
    item(lottery, d(t), "dlb-jackpot-reset", randomTicket(rng, lottery)),
    item(lottery, d(t - 3), "nlb-winners-directory", null, { listedIn: [tau.slice(0, 7)], inDrawHistory: false }),
    item(lottery, d(t - 5), "nlb-winners-directory", null, { date: null, listedIn: ["2017-04"], inDrawHistory: false }),
  ].filter(notKnown);
  own.push(...added);
  const other: Jackpot = {
    ...item(lottery, draws[0], "nlb-prize-table", randomTicket(rng, lottery)),
    lotteryId: lottery.id === "govisetha" ? "mega-power" : "govisetha",
  };
  return { draws: out, jackpots: [other, ...altered, ...added], own, added, tau, archive };
}

/** Test indices near the wanted positions where v1's nextDrawDate of the draws before t is date(d_t). */
function cutPoints(draws: readonly Draw[], wanted: readonly number[]): number[] {
  const dates = draws.map((d) => d.draw_date);
  const out: number[] = [];
  for (const w of wanted) {
    for (let t = w; t < draws.length; t++) {
      if (nextDrawDate(dates.slice(0, t)) === dates[t] && !out.includes(t)) {
        out.push(t);
        break;
      }
    }
  }
  return out;
}

/** Window start, a jackpot draw in the window if there is one (else the middle), and the last test draw. */
function leakCuts(id: string, draws: readonly Draw[]): number[] {
  const N = draws.length;
  const start = backtestStart(N);
  const index = new Map(draws.map((d, i) => [d.draw_no, i] as const));
  const inWindow = JACKPOTS.filter((j) => j.lotteryId === id)
    .map((j) => index.get(j.drawNo) ?? -1)
    .filter((i) => i >= start)
    .sort((a, b) => a - b);
  return [start, inWindow[0] ?? Math.floor((start + N) / 2), N - 1];
}

describe("(1) future corruption leaves the step-t record byte-identical", () => {
  for (const id of LEAK_IDS) {
    it(`${id}: 3 cut points x 2 corruptions`, () => {
      const lottery = LOTTERY_BY_ID[id];
      const draws = loadDraws(id);
      const base = buildContext(lottery, draws, JACKPOTS);
      for (const t of leakCuts(id, draws)) {
        const expected = stepRecord(base, t);
        for (const seed of [1, 2]) {
          const c = corrupt(lottery, draws, JACKPOTS, t, 1000 * t + seed);
          // Sanity: every altered or added own item is unknown before date(d_t), and the corruption is real.
          for (const j of c.own) expect(usableAt(knownFrom(j, c.archive), c.tau)).toBe(false);
          expect(c.added.length).toBeGreaterThanOrEqual(5);
          expect(c.draws.slice(t).map((d) => d.numbers.join())).not.toEqual(draws.slice(t).map((d) => d.numbers.join()));
          const ctx = buildContext(lottery, c.draws, c.jackpots);
          expect(ctx.items.length).toBeGreaterThan(base.items.length);
          expect(stepRecord(ctx, t)).toBe(expected);
        }
      }
    }, TIMEOUT);
  }
});

describe("(2) truncation equivalence: predictV2 on draws < t equals the backtest record at t", () => {
  const records = new Map<string, StepRecord[]>();
  beforeAll(() => {
    for (const id of LEAK_IDS) {
      const ctx = buildContext(LOTTERY_BY_ID[id], loadDraws(id), JACKPOTS);
      records.set(id, walkForward(ctx, { records: true }).records!);
    }
  }, TIMEOUT);

  for (const id of LEAK_IDS) {
    it(`${id}: 3 cut points`, () => {
      const lottery = LOTTERY_BY_ID[id];
      const draws = loadDraws(id);
      const N = draws.length;
      const start = backtestStart(N);
      const cuts = cutPoints(draws, [start + 1, Math.floor((start + N) / 2), N - 3]);
      expect(cuts).toHaveLength(3);
      const full = buildContext(lottery, draws, JACKPOTS);
      for (const t of cuts) {
        const tau = draws[t].draw_date;
        const known = JACKPOTS.filter((j) => j.lotteryId !== id || usableAt(knownFrom(j, dated(draws)), tau));
        const head = draws.slice(0, t);
        const p = predictV2(v2Input(lottery, head, known, GENERATED_AT));
        const rec = records.get(id)!.find((r) => r.t === t)!;
        expect(rec).toBeDefined();
        expect(p.nextDrawDate).toBe(tau);
        // The whole posterior and Top pick (raw floats) are byte-identical.
        expect(stepRecord(buildContext(lottery, head, known), t, p.nextDrawDate)).toBe(stepRecord(full, t));
        // The published payload is the r4 of the backtest record.
        const top = p.sets[0];
        expect({ numbers: top.numbers, letter: top.letter, bonus: top.bonus, orderHeld: top.orderHeld }).toEqual({
          numbers: rec.numbers,
          letter: rec.letter,
          bonus: rec.bonus,
          orderHeld: rec.orderHeld,
        });
        const post = posteriorAt(full, t, tau);
        const lo = lottery.main_min;
        expect(p.numberLean).toEqual(
          p.numberLean!.map((x) => ({
            n: x.n,
            lean: r4(leanOf(post.num, x.n - lo)),
            j: r4(rec.parts[0][x.n - lo]),
            t: r4(rec.parts[1][x.n - lo]),
            d: r4(rec.parts[2][x.n - lo]),
          })),
        );
        expect(rec.theta).toEqual(Array.from(post.num.theta));
        const split = (v: number[]) => ({ jackpotCombinations: r4(v[0]), jackpotDates: r4(v[1]), dailyDraws: r4(v[2]) });
        expect(p.influence!.numbers).toEqual(split(rec.share));
        expect(p.damping!.numbers).toEqual(split(rec.damping));
        expect(p.evidence!.guard).toEqual({
          perCombination: rec.guard.perCombination,
          union: rec.guard.union,
          excludedShare: r4(rec.guard.excludedShare),
        });
      }
    }, TIMEOUT);
  }
});

describe("(3) same-day canary", () => {
  const CANARY_IDS = ["dhana-nidhanaya", "kapruka"];
  const plant = (lottery: Lottery, d: Draw, source: JackpotSource) =>
    item(lottery, d, source, [...d.numbers].sort((a, b) => a - b), { jackpotWinners: source === "dlb-jackpot-reset" ? null : 1 });
  /**
   * The walk-forward as JSON, without its descriptive jackpotDrawHits list. That list (spec 5.2: Top-pick hits on the
   * actual jackpot draws inside the window) states facts, like DrawSummary.jackpot (3.1), so a planted jackpot draw is
   * listed there by definition; it feeds no pick and no metric. It is checked separately below.
   */
  const runParts = (lottery: Lottery, draws: Draw[], jackpots: Jackpot[]) => {
    const { jackpotDrawHits, ...rest } = walkForward(buildContext(lottery, draws, jackpots), { records: true });
    return { json: JSON.stringify(rest, typed), jackpotDrawHits, hits: rest.hits, start: rest.start };
  };

  for (const id of CANARY_IDS) {
    it(`${id}: planted on the last test draw (and a DLB reset on the one before) the whole backtest is byte-identical`, () => {
      const lottery = LOTTERY_BY_ID[id];
      const draws = loadDraws(id);
      const N = draws.length;
      const planted = [...JACKPOTS, plant(lottery, draws[N - 1], "nlb-prize-table"), plant(lottery, draws[N - 2], "dlb-jackpot-reset")];
      const before = runParts(lottery, draws, JACKPOTS);
      const after = runParts(lottery, draws, planted);
      expect(after.json).toBe(before.json); // every step record and every sum behind the metrics
      // The descriptive list gains exactly the two planted draws, with the hits their steps already had.
      const listed = [N - 2, N - 1].map((i) => ({ drawNo: draws[i].draw_no, date: draws[i].draw_date, hits: before.hits[i - before.start] }));
      expect(after.jackpotDrawHits).toEqual([...before.jackpotDrawHits, ...listed]);
      // The backtest payload is the same too (apart from that list).
      const strip = (p: ReturnType<typeof predictV2>) => ({ ...p.backtestDetail!, jackpotDrawHits: null });
      expect(strip(predictV2(v2Input(lottery, draws, planted, GENERATED_AT)))).toEqual(
        strip(predictV2(v2Input(lottery, draws, JACKPOTS, GENERATED_AT))),
      );
    }, TIMEOUT);

    it(`${id}: planted at an earlier step t, they change no record before step t + 2 (each one alone)`, () => {
      const lottery = LOTTERY_BY_ID[id];
      const draws = loadDraws(id);
      const N = draws.length;
      const start = backtestStart(N);
      // A test draw followed by a draw on the next day (so the 1-day prize-table lag ends exactly at draw t + 1).
      let t = Math.floor((start + N) / 2);
      while (addDays(draws[t].draw_date, 1) !== draws[t + 1].draw_date) t++;
      const base = walkForward(buildContext(lottery, draws, JACKPOTS), { records: true }).records!;
      for (const extra of [plant(lottery, draws[t], "nlb-prize-table"), plant(lottery, draws[t - 1], "dlb-jackpot-reset")]) {
        const recs = walkForward(buildContext(lottery, draws, [...JACKPOTS, extra]), { records: true }).records!;
        const changed = recs.findIndex((r, q) => JSON.stringify(r) !== JSON.stringify(base[q]));
        expect(recs[changed]?.t).toBe(t + 2);
      }
    }, TIMEOUT);
  }
});

describe("(5) a winners-directory card first seen late reaches no earlier step", () => {
  it("a page-1 card is labelled with the month it was read in, so it counts only from that month's end", () => {
    const lottery = LOTTERY_BY_ID["mega-power"];
    const draws = loadDraws(lottery.id);
    const N = draws.length;
    // An old win (before the archive), claimed late: its card first shows up on the winners page 1 in a month after the
    // last archived draw. The daily update labels it with that month (lib/jackpots.ts directoryMonth).
    const runMonth = directoryMonth(new Date(`${addDays(draws[N - 1].draw_date, 10)}T12:00:00Z`));
    const card = (listedIn: string[]): Jackpot => ({
      lotteryId: lottery.id,
      drawNo: 2450,
      date: addDays(draws[0].draw_date, -40),
      letter: null,
      numbers: null,
      bonus: null,
      jackpotWinners: null,
      superPrizeAmount: null,
      source: "nlb-winners-directory",
      inDrawHistory: false,
      listedIn,
    });
    const known = knownFrom(card([runMonth]), dated(draws));
    expect(known! > draws[N - 1].draw_date).toBe(true);
    const base = JSON.stringify(walkForward(buildContext(lottery, draws, JACKPOTS), { records: true }), typed);
    expect(JSON.stringify(walkForward(buildContext(lottery, draws, [...JACKPOTS, card([runMonth])]), { records: true }), typed)).toBe(base);
    // Labelled "latest" (as page-1 cards were before), the same card counted from the day after its draw and so
    // changed every step: the leak this label prevents.
    expect(knownFrom(card(["latest"]), dated(draws))).toBe(addDays(card([]).date!, 1));
    expect(JSON.stringify(walkForward(buildContext(lottery, draws, [...JACKPOTS, card(["latest"])]), { records: true }), typed)).not.toBe(base);
  }, TIMEOUT);
});

describe("(4) evidence-only order", () => {
  it("shuffling the order of the jackpots.json items leaves the payload sha256 equal", () => {
    const expected = sha256Json(predictAllV2(loadV2Inputs(JACKPOTS)));
    const rng = mulberry32(42);
    const shuffled = JACKPOTS.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    expect(shuffled.map((j) => `${j.lotteryId}:${j.drawNo}`)).not.toEqual(JACKPOTS.map((j) => `${j.lotteryId}:${j.drawNo}`));
    expect(sha256Json(predictAllV2(loadV2Inputs(shuffled)))).toBe(expected);
    expect(sha256Json(predictAllV2(loadV2Inputs(JACKPOTS.slice().reverse())))).toBe(expected);
  }, TIMEOUT);
});
