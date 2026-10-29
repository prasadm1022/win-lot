// SPDX-License-Identifier: Apache-2.0
// Independent re-implementations of the win-lot-jackpot-v2 rules, written from docs/MODEL-V2.md (not from
// lib/model-v2), for the invariants, oracle and leakage tests. Values are the spec's section 2.2 numbers.

import type { Jackpot } from "../../lib/jackpots";
import { knownFrom, type Channel, type DatedDraw, type Posterior } from "../../lib/model-v2";
import type { Draw } from "../../lib/parsers";

/** Section 2.2 values, as written in the spec. */
export const SPEC = Object.freeze({
  ORDER: 0.75,
  MAX_LIFT: 1.25,
  GUARD_ALPHA: 0.05,
  GUARD_LADDER: [
    [1, 2],
    [1, 3],
    [2, 3],
    [2, 4],
    [3, 4],
  ] as const,
  CAND: 24,
  SET_OVERLAP: 2,
  BALANCED_OVERLAP: 1,
  DEAD_P: 1e-6,
  ODD_MIN: 1,
  ODD_MAX: 3,
  MAX_CONSECUTIVE_PAIRS: 1,
  SUM_LOW_Q: 0.1,
  SUM_HIGH_Q: 0.9,
  DECLUSTER_DAYS: 7,
});

/**
 * De-clustering of jackpot dates (section 2.7 a), in fixed windows: the earliest date not yet in a cluster starts
 * one, which holds every later date at most DECLUSTER_DAYS after that first date (no cluster spans more than 7
 * days). Each cluster counts as ONE independent date, so the effective number of dates n_eff is this count.
 */
export function dateClusters(dates: readonly string[]): number {
  const days = dates.map((d) => Date.parse(`${d}T12:00:00Z`) / 86_400_000).sort((a, b) => a - b);
  let clusters = 0;
  let first = -Infinity;
  for (const day of days) {
    if (day - first > SPEC.DECLUSTER_DAYS) {
      clusters++;
      first = day;
    }
  }
  return clusters;
}

/** Exact binomial coefficient for the small sizes used here. */
export function binom(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let x = 1;
  for (let i = 1; i <= r; i++) x = (x * (n - r + i)) / i;
  return Math.round(x);
}

/** Live balls at step t (section 2.3): dead <=> t >= R and (never drawn in [0, t) or unseen for more than R draws). */
export function liveBallsAt(history: readonly (readonly number[])[], lo: number, hi: number, k: number, t: number): number[] {
  const M = hi - lo + 1;
  const R = Math.ceil(Math.log(SPEC.DEAD_P) / Math.log(1 - k / M));
  const last = new Map<number, number>();
  for (let i = 0; i < t; i++) for (const n of history[i]) last.set(n, i);
  const live: number[] = [];
  for (let n = lo; n <= hi; n++) {
    const seen = last.get(n);
    const dead = t >= R && (seen === undefined || t - seen > R);
    if (!dead) live.push(n);
  }
  return live;
}

/**
 * Regime start r_t (section 2.3): max(latest activation index < t, max{last_t(n) + 1 : n dead, drawn before}, 0).
 * Activation of n at i: n drawn at i and (first appearance with i >= R, or previous appearance p with i - p > R).
 */
export function regimeStartAt(history: readonly (readonly number[])[], lo: number, hi: number, k: number, t: number): number {
  const M = hi - lo + 1;
  const R = Math.ceil(Math.log(SPEC.DEAD_P) / Math.log(1 - k / M));
  const last = new Map<number, number>();
  let start = 0;
  for (let i = 0; i < t; i++) {
    for (const n of history[i]) {
      const p = last.get(n);
      if ((p === undefined && i >= R) || (p !== undefined && i - p > R)) start = Math.max(start, i);
      last.set(n, i);
    }
  }
  for (let n = lo; n <= hi; n++) {
    const p = last.get(n);
    const dead = t >= R && (p === undefined || t - p > R);
    if (dead && p !== undefined) start = Math.max(start, p + 1);
  }
  return start;
}

const bandCache = new Map<string, [number, number]>();

/**
 * Typicality sum band [s10, s90] (section 2.14 R2): the first sums at which the exact null CDF of the sum of a
 * uniformly random 4-subset of the live balls reaches 10% and 90%. Brute force over every 4-subset.
 */
export function sumBand(live: readonly number[]): [number, number] {
  const key = live.join(",");
  const hit = bandCache.get(key);
  if (hit) return hit;
  const L = live.length;
  const counts = new Float64Array(4 * live[L - 1] + 1);
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++)
      for (let c = b + 1; c < L; c++) {
        const s3 = live[a] + live[b] + live[c];
        for (let d = c + 1; d < L; d++) counts[s3 + live[d]]++;
      }
  const total = binom(L, 4);
  const first = (q: number) => {
    let cum = 0;
    for (let s = 0; s < counts.length; s++) {
      cum += counts[s];
      if (cum >= q * total - 1e-9) return s;
    }
    return counts.length - 1;
  };
  const band: [number, number] = [first(SPEC.SUM_LOW_Q), first(SPEC.SUM_HIGH_Q)];
  bandCache.set(key, band);
  return band;
}

const spreadEdgeCache = new Map<string, [number, number]>();

/** Spread terciles (2.5): the first spreads at which the exact null CDF reaches 1/3 and 2/3 (brute force). */
export function spreadEdges(live: readonly number[]): [number, number] {
  const key = live.join(",");
  const hit = spreadEdgeCache.get(key);
  if (hit) return hit;
  const counts = new Float64Array(live[live.length - 1] - live[0] + 1);
  const L = live.length;
  for (let a = 0; a < L; a++)
    for (let b = a + 1; b < L; b++)
      for (let c = b + 1; c < L; c++) for (let d = c + 1; d < L; d++) counts[live[d] - live[a]]++;
  const total = binom(L, 4);
  let cum = 0;
  let e1 = -1;
  let e2 = -1;
  for (let s = 0; s < counts.length; s++) {
    cum += counts[s];
    if (e1 < 0 && 3 * cum >= total) e1 = s;
    if (e2 < 0 && 3 * cum >= 2 * total) e2 = s;
  }
  const edges: [number, number] = [e1, e2];
  spreadEdgeCache.set(key, edges);
  return edges;
}

/** Odd class (0-1, 2, 3-4 odd numbers) and spread tercile of a 4-set on the live balls (2.5). */
export function shapeBins(set: readonly number[], live: readonly number[]): { odd: number; spread: number } {
  const s = [...set].sort((a, b) => a - b);
  const odd = s.filter((n) => n % 2 !== 0).length;
  const [e1, e2] = spreadEdges(live);
  const spread = s[s.length - 1] - s[0];
  return { odd: odd <= 1 ? 0 : odd === 2 ? 1 : 2, spread: spread <= e1 ? 0 : spread <= e2 ? 1 : 2 };
}

/** R2 typicality: odd count 1..3, sum inside [s10, s90], at most 1 consecutive pair. */
export function typical(set: readonly number[], live: readonly number[]): boolean {
  const s = [...set].sort((a, b) => a - b);
  const odd = s.filter((n) => n % 2 !== 0).length;
  const sum = s.reduce((a, b) => a + b, 0);
  let pairs = 0;
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] === 1) pairs++;
  const [lo, hi] = sumBand(live);
  return odd >= SPEC.ODD_MIN && odd <= SPEC.ODD_MAX && sum >= lo && sum <= hi && pairs <= SPEC.MAX_CONSECUTIVE_PAIRS;
}

export function shared(a: readonly number[], b: readonly number[]): number {
  return a.filter((n) => b.includes(n)).length;
}

/** Hypergeometric tail H(L, j, c): share of all 4-tickets on L balls sharing more than c numbers with a fixed j-set. */
export function hyperTailSpec(L: number, j: number, c: number): number {
  let s = 0;
  for (let x = c + 1; x <= Math.min(4, j); x++) s += binom(j, x) * binom(L - j, 4 - x);
  return s / binom(L, 4);
}

/** The guard rung (section 2.14): the first ladder rung whose Bonferroni bound is at most GUARD_ALPHA. */
export function guardRungSpec(
  L: number,
  combos: readonly (readonly number[])[],
): { perCombination: number; union: number; excludedShare: number; index: number } {
  const union = [...new Set(combos.flat())];
  const excluded = (c: number, u: number) =>
    combos.reduce((s, combo) => s + hyperTailSpec(L, combo.length, c), 0) + hyperTailSpec(L, union.length, u);
  for (let i = 0; i < SPEC.GUARD_LADDER.length; i++) {
    const [c, u] = SPEC.GUARD_LADDER[i];
    const e = excluded(c, u);
    if (e <= SPEC.GUARD_ALPHA) return { perCombination: c, union: u, excludedShare: e, index: i };
  }
  const [c, u] = SPEC.GUARD_LADDER[SPEC.GUARD_LADDER.length - 1];
  return { perCombination: c, union: u, excludedShare: excluded(c, u), index: SPEC.GUARD_LADDER.length - 1 };
}

/** Usable own jackpot combinations at target date tau (section 2.4), live numbers only, ascending by drawNo. */
export function usableCombos(
  lotteryId: string,
  jackpots: readonly Jackpot[],
  draws: readonly Draw[],
  tau: string,
  live: readonly number[],
): number[][] {
  const dated: DatedDraw[] = draws.map((d) => ({ drawNo: d.draw_no, date: d.draw_date }));
  return jackpots
    .filter((j) => j.lotteryId === lotteryId && j.numbers !== null)
    .filter((j) => {
      const known = knownFrom(j, dated);
      return known !== null && known < tau;
    })
    .sort((a, b) => a.drawNo - b.drawNo)
    .map((j) => (j.numbers as number[]).filter((n) => live.includes(n)));
}

/** The set of earlier results (sorted numbers joined by "-") of draws [0, t). */
export function pastResults(draws: readonly Draw[], t: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < t; i++) out.add(ticketText(draws[i].numbers));
  return out;
}

export function ticketText(numbers: readonly number[]): string {
  return [...numbers].sort((a, b) => a - b).join("-");
}

/**
 * The rules R1-R5 of section 2.14 for one card; returns the broken rules (empty = passes). R4 needs the earlier cards.
 */
export function brokenRules(
  set: readonly number[],
  ctx: {
    live: readonly number[];
    combos: readonly (readonly number[])[];
    rung: { perCombination: number; union: number };
    past: ReadonlySet<string>;
    earlier?: readonly (readonly number[])[];
  },
): string[] {
  const out: string[] = [];
  const union = [...new Set(ctx.combos.flat())];
  if (ctx.combos.some((c) => shared(set, c) > ctx.rung.perCombination) || shared(set, union) > ctx.rung.union) out.push("R1");
  if (!typical(set, ctx.live)) out.push("R2");
  if (ctx.past.has(ticketText(set))) out.push("R3");
  if ((ctx.earlier ?? []).some((e) => shared(set, e) > SPEC.SET_OVERLAP)) out.push("R4");
  if (!set.every((n) => ctx.live.includes(n)) || new Set(set).size !== set.length || set.length !== 4) out.push("R5");
  return out;
}

/** Every number in a value (recursively), with its JSON path. */
export function numbersIn(value: unknown, path = "$"): { path: string; value: number }[] {
  if (typeof value === "number") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => numbersIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => numbersIn(v, `${path}.${k}`));
  }
  return [];
}

/** Every string in a value (recursively), with its JSON path. */
export function stringsIn(value: unknown, path = "$"): { path: string; value: string }[] {
  if (typeof value === "string") return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => stringsIn(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => stringsIn(v, `${path}.${k}`));
  }
  return [];
}

/** A source moves the picks (section 2.15): present, and its damped pull in the number channel is above 0. */
export function sourceMoves(post: Posterior, s: number): boolean {
  return post.num.present[s] && post.num.pull[s] * post.num.damping[s] > 0;
}

/** One view card of the spec definition (section 2.15), by source: 0 = Jackpot pattern, 1 = Jackpot days, 2 = Daily draws. */
export interface SpecViewCard {
  source: number;
  moves: boolean;
  numbers: number[];
  letter: string | null;
  bonus: number | null;
}

/**
 * The view cards 2-4 of section 2.15, brute force from the spec text. Each card is the best score among the 4-subsets
 * of the CAND live numbers ranked highest (ties: tie key), enumerated in tie-key order, passing R1-R4 against the cards
 * selected before it (the Top pick first); fallback CAND 32, 48, all live balls; ties within 1e-12 keep the first.
 * A card whose source moves the picks scores with the source-only lean lambda_s = 1 + part_s (A + m) / (A + m_s) in
 * every channel (floored at 1e-9): sum ln lambda_s(n) + ln lambda_s(odd bin) + ln lambda_s(spread bin), letter and
 * bonus = argmax lambda_s. A balanced card scores with the Top pick's logScore (sum ln theta(n) + the shape leans) and
 * is a clearly different alternative: it shares at most BALANCED_OVERLAP = 1 number with every card selected before
 * it (only if no ticket passes that after the CAND fallbacks, the R4 limit of 2), and its letter and bonus are the
 * argmax of theta over the letters / bonus values that no card selected before it uses (all of them when every one is
 * used). Exact letter / bonus ties go to the smallest tie key. Selection order: the cards whose source moves the picks
 * in the owner's order J, T, D, then the balanced cards in the same order ("display" picks them in display order
 * instead, to show that the order matters).
 */
export function specViewCards(x: {
  post: Posterior;
  keys: { numbers: ArrayLike<number>; letters: ArrayLike<number>; bonus: ArrayLike<number> };
  lo: number;
  live: readonly number[];
  combos: readonly (readonly number[])[];
  rung: { perCombination: number; union: number };
  past: ReadonlySet<string>;
  top: readonly number[];
  /** The Top pick's letter and bonus (a balanced card never repeats a letter or bonus already taken). */
  topLetter: string | null;
  topBonus: number | null;
  order?: "selection" | "display";
}): SpecViewCard[] {
  const { post, keys, lo, live } = x;
  const union = [...new Set(x.combos.flat())];
  const [e1, e2] = spreadEdges(live);
  const oddBin = (s: readonly number[]) => {
    const odd = s.filter((n) => n % 2 !== 0).length;
    return odd <= 1 ? 0 : odd === 2 ? 1 : 2;
  };
  const spreadBin = (s: readonly number[]) => {
    const spread = s[3] - s[0];
    return spread <= e1 ? 0 : spread <= e2 ? 1 : 2;
  };
  const sourceLean = (ch: Channel, s: number, i: number) =>
    Math.max(1e-9, ch.present[s] && ch.p0[i] > 0 ? 1 + (ch.parts[s][i] * ch.total) / (ch.prior + ch.mass[s]) : 1);
  /** argmax with exact ties to the smallest tie key, over the indices not in `taken` (all, when every one is taken). */
  const argmax = (values: number[], tieKeys: ArrayLike<number>, taken: readonly number[] = []) => {
    const open = values.map((_, i) => i).filter((i) => !taken.includes(i));
    const pool = open.length ? open : values.map((_, i) => i);
    let best = pool[0];
    for (const i of pool) if (values[i] > values[best] || (values[i] === values[best] && tieKeys[i] < tieKeys[best])) best = i;
    return best;
  };
  const moving = [0, 1, 2].filter((s) => sourceMoves(post, s));
  const order = x.order === "display" ? [0, 1, 2] : [...moving, ...[0, 1, 2].filter((s) => !moving.includes(s))];
  const earlier: (readonly number[])[] = [x.top];
  const lettersTaken: number[] = x.topLetter !== null ? [post.letters.indexOf(x.topLetter)] : [];
  const bonusTaken: number[] = x.topBonus !== null ? [x.topBonus - post.bonusMin] : [];
  const out: SpecViewCard[] = [];
  for (const s of order) {
    const moves = moving.includes(s);
    const rank = (n: number) => (moves ? sourceLean(post.num, s, n - lo) : post.num.theta[n - lo]);
    const ball = (n: number) => Math.log(rank(n));
    const shape = (set: readonly number[]) => {
      const ob = oddBin(set);
      const sb = spreadBin(set);
      return moves
        ? Math.log(sourceLean(post.odd, s, ob)) + Math.log(sourceLean(post.spread, s, sb))
        : Math.log(post.odd.theta[ob] / post.odd.p0[ob]) + Math.log(post.spread.theta[sb] / post.spread.p0[sb]);
    };
    const passes = (set: readonly number[], overlap: number) =>
      x.combos.every((c) => shared(set, c) <= x.rung.perCombination) &&
      shared(set, union) <= x.rung.union &&
      typical(set, live) &&
      !x.past.has(set.join("-")) &&
      earlier.every((e) => shared(set, e) <= overlap);
    const key = (n: number) => keys.numbers[n - lo];
    const sizes = [SPEC.CAND, 32, 48, live.length].map((v) => Math.min(v, live.length)).filter((v, i, a) => i === 0 || v > a[i - 1]);
    const search = (overlap: number): number[] | null => {
      for (const size of sizes) {
        const cand = [...live]
          .sort((a, b) => rank(b) - rank(a) || key(a) - key(b))
          .slice(0, size)
          .sort((a, b) => key(a) - key(b));
        let best: number[] | null = null;
        let bestScore = -Infinity;
        const m = cand.length;
        for (let a = 0; a < m; a++)
          for (let b = a + 1; b < m; b++)
            for (let c = b + 1; c < m; c++)
              for (let d = c + 1; d < m; d++) {
                const set = [cand[a], cand[b], cand[c], cand[d]].sort((p, q) => p - q);
                if (!passes(set, overlap)) continue;
                const score = ball(cand[a]) + ball(cand[b]) + ball(cand[c]) + ball(cand[d]) + shape(set);
                if (score > bestScore + 1e-12) {
                  bestScore = score;
                  best = set;
                }
              }
        if (best) return best;
      }
      return null;
    };
    const best = (moves ? null : search(SPEC.BALANCED_OVERLAP)) ?? search(SPEC.SET_OVERLAP);
    if (!best) throw new Error(`specViewCards: no ticket passes for source ${s}`);
    earlier.push(best);
    const weights = (ch: Channel) => Array.from(ch.p0, (_, i) => (moves ? sourceLean(ch, s, i) : ch.theta[i]));
    const li = post.letter ? argmax(weights(post.letter), keys.letters, moves ? [] : lettersTaken) : -1;
    const bi = post.bonus ? argmax(weights(post.bonus), keys.bonus, moves ? [] : bonusTaken) : -1;
    if (li >= 0) lettersTaken.push(li);
    if (bi >= 0) bonusTaken.push(bi);
    out[s] = {
      source: s,
      moves,
      numbers: best,
      letter: post.letter ? post.letters[li] : null,
      bonus: post.bonus ? post.bonusMin + bi : null,
    };
  }
  return out;
}
