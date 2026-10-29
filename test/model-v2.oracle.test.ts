// SPDX-License-Identifier: Apache-2.0
// Oracle test of the Top-pick search (docs/MODEL-V2.md sections 2.10, 2.13, 2.14 and 2.15): on 3 small fixtures
// (balls 1-30, L = 30) the production search equals a brute-force implementation of the same definition, written
// here from the spec, at the production step and at every walk-forward step. The posterior (theta, leans, parts) is
// the model's; what is checked is the search: candidates, enumeration order, rules R1-R3, the order filter, the
// 1e-12 tie rule and the letter / bonus argmax with tie keys.
import { describe, expect, it } from "vitest";
import type { Jackpot } from "../lib/jackpots";
import type { Lottery } from "../lib/lotteries";
import { mulberry32, nextDrawDate } from "../lib/model";
import {
  addDays,
  buildContext,
  cardsAt,
  posteriorAt,
  streamAt,
  topPickAt,
  walkForward,
  type ModelContext,
  type Posterior,
  type Stream,
} from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import {
  SPEC,
  guardRungSpec,
  liveBallsAt,
  pastResults,
  shared,
  specViewCards,
  spreadEdges,
  typical,
  usableCombos,
} from "./helpers/v2-rules";

const TIMEOUT = 120_000;

function lotteryOf(id: string, bonus: boolean): Lottery {
  return {
    id,
    name: `Oracle ${id}`,
    board: "NLB",
    source_url: "",
    source_key: id,
    letter_kind: "letter",
    main_count: 4,
    main_min: 1,
    main_max: 30,
    has_bonus: bonus ? 1 : 0,
    bonus_label: bonus ? "Bonus" : null,
    bonus_min: bonus ? 1 : null,
    bonus_max: bonus ? 10 : null,
  };
}

/** Fair daily draws on 1..30 from 2025-01-01, letters A..Z, optional integer bonus 1..10. */
function fairDraws(n: number, seed: number, bonus: boolean): Draw[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const s = new Set<number>();
    while (s.size < 4) s.add(1 + Math.floor(rng() * 30));
    return {
      draw_no: 500 + i,
      draw_date: addDays("2025-01-01", i),
      letter: String.fromCharCode(65 + Math.floor(rng() * 26)),
      numbers: [...s],
      bonus: bonus ? 1 + Math.floor(rng() * 10) : null,
    };
  });
}

function combo(lottery: Lottery, d: Draw): Jackpot {
  return {
    lotteryId: lottery.id,
    drawNo: d.draw_no,
    date: d.draw_date,
    letter: d.letter,
    numbers: [...d.numbers].sort((a, b) => a - b),
    bonus: Number.isInteger(d.bonus) ? d.bonus : null,
    jackpotWinners: 1,
    superPrizeAmount: null,
    source: "nlb-prize-table",
    inDrawHistory: true,
  };
}

function dateOnly(lottery: Lottery, drawNo: number, date: string): Jackpot {
  return {
    lotteryId: lottery.id,
    drawNo,
    date,
    letter: null,
    numbers: null,
    bonus: null,
    jackpotWinners: 1,
    superPrizeAmount: null,
    source: "nlb-winners-directory",
    inDrawHistory: false,
    listedIn: [date.slice(0, 7)],
  };
}

interface Fixture {
  name: string;
  lottery: Lottery;
  draws: Draw[];
  jackpots: Jackpot[];
}

const FIXTURES: Fixture[] = (() => {
  const a = lotteryOf("oracle-all-sources", false);
  const aDraws = fairDraws(150, 11, false);
  const b = lotteryOf("oracle-flat", false);
  const bDraws = fairDraws(150, 12, false);
  const c = lotteryOf("oracle-many-combos", true);
  const cDraws = fairDraws(150, 13, true);
  return [
    {
      // J, T and D present: 3 combinations in the archive plus 4 older dates one synodic month apart (moon pattern).
      name: "all three sources",
      lottery: a,
      draws: aDraws,
      jackpots: [
        ...[40, 80, 120].map((i) => combo(a, aDraws[i])),
        ...[0, 1, 2, 3].map((q) => dateOnly(a, 100 + q, addDays("2024-03-10", Math.round(29.530588853 * q)))),
      ],
    },
    {
      // Every source silent or absent: dates spread over every calendar feature, no combination. theta = p0, so the
      // tie keys decide everything (never 1-2-3-4).
      name: "flat posterior (ties everywhere)",
      lottery: b,
      draws: bDraws,
      jackpots: Array.from({ length: 10 }, (_, q) => dateOnly(b, 200 + q, addDays("2024-01-01", 9 * q))),
    },
    {
      // 12 combinations on 30 balls: the guard ladder loosens and R1 bites; integer bonus channel present.
      name: "many combinations, integer bonus",
      lottery: c,
      draws: cDraws,
      jackpots: [10, 22, 31, 45, 52, 60, 77, 85, 98, 110, 121, 133].map((i) => combo(c, cDraws[i])),
    },
  ];
})();

interface Pick {
  numbers: number[];
  orderHeld: boolean;
  letter: string | null;
  bonus: number | null;
}

/** Brute force of the Top-pick definition (2.15) and the letter / bonus argmax (2.13) at one step. */
function bruteTopPick(
  fx: Fixture,
  post: Posterior,
  stream: Stream,
  t: number,
  tau: string,
): Pick {
  const lo = fx.lottery.main_min;
  const history = fx.draws.map((d) => d.numbers);
  const live = liveBallsAt(history, lo, fx.lottery.main_max, 4, t);
  expect(Array.from(post.regime.live).flatMap((v, j) => (v ? [lo + j] : []))).toEqual(live);
  const combos = usableCombos(fx.lottery.id, fx.jackpots, fx.draws, tau, live);
  const rung = guardRungSpec(live.length, combos);
  const union = [...new Set(combos.flat())];
  const past = new Set<string>();
  for (let i = 0; i < t; i++) past.add([...fx.draws[i].numbers].sort((x, y) => x - y).join("-"));
  const [e1, e2] = spreadEdges(live);
  const theta = (n: number) => post.num.theta[n - lo];
  const key = (n: number) => stream.numberKeys[n - lo];
  const oddBin = (s: readonly number[]) => {
    const odd = s.filter((n) => n % 2 !== 0).length;
    return odd <= 1 ? 0 : odd === 2 ? 1 : 2;
  };
  const spreadBin = (s: readonly number[]) => {
    const spread = s[3] - s[0];
    return spread <= e1 ? 0 : spread <= e2 ? 1 : 2;
  };
  const passes = (s: readonly number[]) =>
    combos.every((c) => shared(s, c) <= rung.perCombination) &&
    shared(s, union) <= rung.union &&
    typical(s, live) &&
    !past.has(s.join("-"));
  const present = [0, 1, 2].filter((s) => post.num.present[s]);

  for (const size of [SPEC.CAND, 32, 48, live.length].map((s) => Math.min(s, live.length)).filter((s, i, a) => i === 0 || s > a[i - 1])) {
    const cand = [...live]
      .sort((a, b) => theta(b) - theta(a) || key(a) - key(b))
      .slice(0, size)
      .sort((a, b) => key(a) - key(b));
    let best: number[] | null = null;
    let bestScore = -Infinity;
    let bestOrdered: number[] | null = null;
    let bestOrderedScore = -Infinity;
    const m = cand.length;
    for (let a = 0; a < m; a++)
      for (let b = a + 1; b < m; b++)
        for (let c = b + 1; c < m; c++)
          for (let d = c + 1; d < m; d++) {
            const s = [cand[a], cand[b], cand[c], cand[d]].sort((x, y) => x - y);
            if (!passes(s)) continue;
            const ob = oddBin(s);
            const sb = spreadBin(s);
            let score = 0;
            for (const n of s) score += Math.log(theta(n));
            score += Math.log(post.odd.theta[ob] / post.odd.p0[ob]) + Math.log(post.spread.theta[sb] / post.spread.p0[sb]);
            const parts = [0, 1, 2].map((src) => {
              let v = post.odd.parts[src][ob] + post.spread.parts[src][sb];
              for (const n of s) v += post.num.parts[src][n - lo];
              return v;
            });
            if (score > bestScore + 1e-12) {
              bestScore = score;
              best = s;
            }
            const ordered = present.every((src, q) => q === 0 || parts[present[q - 1]] >= parts[src] - 1e-12);
            if (ordered && score > bestOrderedScore + 1e-12) {
              bestOrderedScore = score;
              bestOrdered = s;
            }
          }
    if (!best) continue;
    const argmax = (values: ArrayLike<number>, keys: ArrayLike<number>) => {
      let i0 = 0;
      for (let i = 1; i < values.length; i++) if (values[i] > values[i0] || (values[i] === values[i0] && keys[i] < keys[i0])) i0 = i;
      return i0;
    };
    return {
      numbers: bestOrdered ?? best,
      orderHeld: bestOrdered !== null,
      letter: post.letter ? post.letters[argmax(post.letter.theta, stream.letterKeys)] : null,
      bonus: post.bonus ? post.bonusMin + argmax(post.bonus.theta, stream.bonusKeys) : null,
    };
  }
  throw new Error("brute force: no ticket passes");
}

function pastKeys(ctx: ModelContext, t: number): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < t; i++) if (ctx.keys[i] >= 0) s.add(ctx.keys[i]);
  return s;
}

describe.each(FIXTURES)("oracle: $name", (fx) => {
  it(
    "production Top pick equals the brute force of the spec definition",
    () => {
      const ctx = buildContext(fx.lottery, fx.draws, fx.jackpots);
      const N = fx.draws.length;
      const tau = nextDrawDate(ctx.dates);
      const post = posteriorAt(ctx, N, tau);
      const stream = streamAt(ctx, post);
      const top = topPickAt(ctx, post, stream, pastKeys(ctx, N));
      expect({ numbers: top.numbers, orderHeld: top.orderHeld, letter: top.letter, bonus: top.bonus }).toEqual(
        bruteTopPick(fx, post, stream, N, tau),
      );
    },
    TIMEOUT,
  );

  it(
    "production view cards 2-4 equal the brute force of their definition (selection order, R1-R4, tie keys)",
    () => {
      const ctx = buildContext(fx.lottery, fx.draws, fx.jackpots);
      const N = fx.draws.length;
      const tau = nextDrawDate(ctx.dates);
      const post = posteriorAt(ctx, N, tau);
      const stream = streamAt(ctx, post);
      const past = pastKeys(ctx, N);
      const top = topPickAt(ctx, post, stream, past);
      const cards = cardsAt(ctx, post, stream, past, top);
      const live = liveBallsAt(fx.draws.map((d) => d.numbers), fx.lottery.main_min, fx.lottery.main_max, 4, N);
      const combos = usableCombos(fx.lottery.id, fx.jackpots, fx.draws, tau, live);
      const spec = specViewCards({
        post,
        keys: { numbers: stream.numberKeys, letters: stream.letterKeys, bonus: stream.bonusKeys },
        lo: fx.lottery.main_min,
        live,
        combos,
        rung: guardRungSpec(live.length, combos),
        past: pastResults(fx.draws, N),
        top: top.numbers,
        topLetter: top.letter,
        topBonus: top.bonus,
      });
      expect(cards.slice(1, 4).map((c) => ({ numbers: c.numbers, letter: c.letter, bonus: c.bonus }))).toEqual(
        spec.map((v) => ({ numbers: v.numbers, letter: v.letter, bonus: v.bonus })),
      );
      expect(cards.slice(1, 4).map((c) => c.mode)).toEqual(spec.map((v) => (v.moves ? "source" : "balanced")));
    },
    TIMEOUT,
  );

  it(
    "every walk-forward Top pick equals the brute force at its step",
    () => {
      const ctx = buildContext(fx.lottery, fx.draws, fx.jackpots);
      const run = walkForward(ctx, { records: true });
      expect(run.records!.length).toBe(120);
      const mismatches: string[] = [];
      for (const rec of run.records!) {
        const tau = fx.draws[rec.t].draw_date;
        const post = posteriorAt(ctx, rec.t, tau);
        const brute = bruteTopPick(fx, post, streamAt(ctx, post), rec.t, tau);
        const got = { numbers: rec.numbers, orderHeld: rec.orderHeld, letter: rec.letter, bonus: rec.bonus };
        if (JSON.stringify(got) !== JSON.stringify(brute)) mismatches.push(`t=${rec.t}: ${JSON.stringify(got)} vs ${JSON.stringify(brute)}`);
      }
      expect(mismatches).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("oracle fixtures exercise what they claim", () => {
  it("all sources present; a flat posterior with tie keys (not 1-2-3-4); a loosened guard rung with an integer bonus", () => {
    const [all, flat, many] = FIXTURES.map((fx) => {
      const ctx = buildContext(fx.lottery, fx.draws, fx.jackpots);
      const post = posteriorAt(ctx, fx.draws.length, nextDrawDate(ctx.dates));
      return { ctx, post, top: topPickAt(ctx, post, streamAt(ctx, post), pastKeys(ctx, fx.draws.length)) };
    });
    expect(all.post.num.present).toEqual([true, true, true]);
    expect(all.post.num.share.every((s) => s > 0)).toBe(true);
    // The order filter really changes picks in the walk-forward of this fixture.
    expect(walkForward(all.ctx).filterChanged).toBeGreaterThan(0);
    expect(new Set(Array.from(flat.post.num.theta)).size).toBe(1);
    expect(flat.top.numbers).not.toEqual([1, 2, 3, 4]);
    expect(many.post.guard.perCombination + many.post.guard.union).toBeGreaterThan(3);
    expect(many.post.bonus).not.toBeNull();
    expect(many.top.bonus).not.toBeNull();
  });
});
