// SPDX-License-Identifier: Apache-2.0
// Pick rules and the five cards of win-lot-jackpot-v2 (docs/MODEL-V2.md sections 2.13-2.16).
//
//   R1 copy guard (c, u)  at most c numbers shared with each usable own jackpot combination, at most u with their union
//   R2 typicality         odd count 1..3, sum inside the exact null 10-90% band, at most 1 consecutive pair
//   R3 not a past result  never identical to an earlier draw of this lottery (presentation only, decision D4)
//   R4 diversity          shares at most SET_OVERLAP numbers with every card selected before it (a balanced card:
//                         at most BALANCED_OVERLAP, when some ticket passes that)
//   R5 live balls         numbers only from the balls in use
//
// The guard rung is chance-calibrated: the strictest rung whose Bonferroni bound on the share of all tickets it
// excludes is at most GUARD_ALPHA. The Top pick is the best-scoring ticket among the CAND highest-lean numbers whose
// parts keep the order J >= T >= D. The view cards are deterministic constrained best tickets too: of their own source
// alone when it moves the picks, else of the full posterior (a balanced pick, kept clearly different from the cards
// before it: fewer shared numbers, an unused letter and bonus). Only the Lucky dip is random. One random stream per
// prediction, consumed in a fixed order, so the backtest's Top pick equals the one production would have published.

import { fnv1a, mulberry32 } from "../model";
import type { EvidenceSource } from "../types";
import { MODEL_VERSION_V2, V2_CONSTANTS } from "./constants";
import { cardLabel, type CardMode } from "./explain";
import {
  sourceActive,
  sourceLeanOf,
  SOURCE_NAMES,
  ticketKey,
  type Channel,
  type ModelContext,
  type Posterior,
  type Triple,
} from "./posterior";
import { binsOf, choose, isTypical } from "./shape";

// ---------------------------------------------------------------- guard ladder (R1)

/** Share of all k-tickets on L live balls that share more than c numbers with a fixed j-set (hypergeometric tail). */
export function hyperTail(L: number, j: number, k: number, c: number): number {
  let s = 0;
  for (let x = c + 1; x <= Math.min(k, j); x++) s += choose(j, x) * choose(L - j, k - x);
  return s / choose(L, k);
}

export interface GuardRung {
  /** Max numbers shared with any one own jackpot combination. */
  perCombination: number;
  /** Max numbers from the union of all own jackpot combinations. */
  union: number;
  /** Bonferroni bound on the share of all tickets the rung excludes (<= GUARD_ALPHA). */
  excludedShare: number;
}

/** Bonferroni bound of rung (c, u): sum over combos of H(L, |combo|, c) plus H(L, |union|, u). */
export function guardExcluded(L: number, comboSizes: readonly number[], unionSize: number, k: number, c: number, u: number): number {
  let E = 0;
  for (const size of comboSizes) E += hyperTail(L, size, k, c);
  E += hyperTail(L, unionSize, k, u);
  return E;
}

/**
 * The first (strictest) rung of GUARD_LADDER whose excluded share is at most GUARD_ALPHA. The loosest rung is used
 * if none qualifies (far beyond any realistic evidence; its share is then reported as it is).
 */
export function guardRung(L: number, comboSizes: readonly number[], unionSize: number, k: number): GuardRung {
  const ladder = V2_CONSTANTS.GUARD_LADDER;
  for (const [c, u] of ladder) {
    const E = guardExcluded(L, comboSizes, unionSize, k, c, u);
    if (E <= V2_CONSTANTS.GUARD_ALPHA) return { perCombination: c, union: u, excludedShare: E };
  }
  const [c, u] = ladder[ladder.length - 1];
  return { perCombination: c, union: u, excludedShare: guardExcluded(L, comboSizes, unionSize, k, c, u) };
}

/** Per-ball lookup tables for the guard: a check costs O(k x combos per number), not O(#combos). */
interface GuardIndex {
  rung: GuardRung;
  inUnion: Uint8Array;
  combosOf: number[][];
  scratch: Int32Array;
}

function guardIndex(ctx: ModelContext, post: Posterior): GuardIndex {
  const inUnion = new Uint8Array(ctx.M);
  for (const n of post.union) inUnion[n - ctx.lo] = 1;
  const combosOf: number[][] = Array.from({ length: ctx.M }, () => []);
  post.combos.forEach((combo, c) => {
    for (const n of combo) combosOf[n - ctx.lo].push(c);
  });
  return { rung: post.guard, inUnion, combosOf, scratch: new Int32Array(post.combos.length) };
}

function passesGuard(sorted: readonly number[], g: GuardIndex, lo: number): boolean {
  let fromUnion = 0;
  for (const n of sorted) fromUnion += g.inUnion[n - lo];
  if (fromUnion > g.rung.union) return false;
  let ok = true;
  for (const n of sorted) for (const c of g.combosOf[n - lo]) if (++g.scratch[c] > g.rung.perCombination) ok = false;
  for (const n of sorted) for (const c of g.combosOf[n - lo]) g.scratch[c] = 0;
  return ok;
}

/** Numbers of the set that appear in the union of the usable own combinations. */
export function pastJackpotNumbers(set: readonly number[], post: Posterior): number {
  return set.filter((n) => post.union.includes(n)).length;
}

/** The most numbers the set shares with any one usable own combination. */
export function maxSharedWithOne(set: readonly number[], post: Posterior): number {
  let best = 0;
  for (const combo of post.combos) best = Math.max(best, set.filter((n) => combo.includes(n)).length);
  return best;
}

// ---------------------------------------------------------------- the random stream (2.16)

/**
 * The stream of one prediction (2.16), consumed in this fixed order: the tie keys of the numbers lo..hi, of the
 * letters U_t and of the bonus values (drawn here), then only the Lucky dip (its numbers, letter and bonus). The
 * Top pick and the view cards use the tie keys only; the backtest consumes nothing beyond them.
 */
export interface Stream {
  rng: () => number;
  /** Tie keys of the numbers lo..hi, of the letters U_t and of the bonus values (consumed first, in that order). */
  numberKeys: Float64Array;
  letterKeys: Float64Array;
  bonusKeys: Float64Array;
}

/** mulberry32(fnv1a(`${id}:${drawNo(d_{t-1})}:win-lot-jackpot-v2`)), with the tie keys already drawn. */
export function streamAt(ctx: ModelContext, post: Posterior): Stream {
  const rng = mulberry32(fnv1a(`${ctx.id}:${ctx.drawNos[post.t - 1]}:${MODEL_VERSION_V2}`));
  const draw = (n: number) => Float64Array.from({ length: n }, () => rng());
  const numberKeys = draw(ctx.M);
  const letterKeys = draw(post.letters.length);
  const bonusKeys = draw(post.bonusCount);
  return { rng, numberKeys, letterKeys, bonusKeys };
}

const SKIP_NONE: ReadonlySet<number> = new Set();

/**
 * Index of the largest weight; exact ties go to the smallest tie key. Indices in `skip` are passed over, unless every
 * index is in it (then the plain argmax).
 */
function argmaxByKey(values: ArrayLike<number>, keys: ArrayLike<number>, skip: ReadonlySet<number> = SKIP_NONE): number {
  let best = -1;
  for (let pass = 0; pass < 2 && best < 0; pass++) {
    for (let i = 0; i < values.length; i++) {
      if (pass === 0 && skip.has(i)) continue;
      if (best < 0 || values[i] > values[best] || (values[i] === values[best] && keys[i] < keys[best])) best = i;
    }
  }
  return Math.max(0, best);
}

/** Live ball indices by score descending, ties by tie key (then index, for completeness). */
function rankByScore(live: Uint8Array, score: ArrayLike<number>, keys: ArrayLike<number>): number[] {
  const idx: number[] = [];
  for (let j = 0; j < live.length; j++) if (live[j]) idx.push(j);
  return idx.sort((a, b) => score[b] - score[a] || keys[a] - keys[b] || a - b);
}

/** Candidate pool sizes: CAND, then the deterministic fallbacks 32, 48 and all live balls (2.15). */
function candidateSizes(L: number): number[] {
  const sizes = [V2_CONSTANTS.CAND, 32, 48, L].map((s) => Math.min(s, L));
  return sizes.filter((s, i) => i === 0 || s > sizes[i - 1]);
}

// ---------------------------------------------------------------- set parts, order, score

/** Pattern points of a set per source: sum of the number parts plus the odd and spread parts of its bins. */
export function setParts(post: Posterior, sorted: readonly number[], lo: number): Triple<number> {
  const bins = binsOf(sorted, post.shape);
  const out: Triple<number> = [0, 0, 0];
  for (let s = 0; s < 3; s++) {
    for (const n of sorted) out[s] += post.num.parts[s][n - lo];
    out[s] += post.odd.parts[s][bins.odd];
    out[s] += post.spread.parts[s][bins.spread];
  }
  return out;
}

/** Parts follow J >= T >= D over the sources present in the number channel (tolerance 1e-12). */
export function partsOrdered(parts: Triple<number>, present: Triple<boolean>): boolean {
  const pr = [0, 1, 2].filter((s) => present[s]);
  for (let a = 0; a + 1 < pr.length; a++) if (parts[pr[a]] < parts[pr[a + 1]] - 1e-12) return false;
  return true;
}

/** v1 convention for `score`: mean of the min-max normalised theta of the set's numbers (0.5 when flat). */
export function setScore(post: Posterior, set: readonly number[], lo: number): number {
  const { theta } = post.num;
  const live = post.regime.live;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < live.length; j++) {
    if (!live[j]) continue;
    if (theta[j] < min) min = theta[j];
    if (theta[j] > max) max = theta[j];
  }
  let s = 0;
  for (const n of set) s += max > min ? (theta[n - lo] - min) / (max - min) : 0.5;
  return s / set.length;
}

// ---------------------------------------------------------------- search

interface SearchInput {
  /** Candidate ball indices in enumeration (tie-key) order. */
  cand: readonly number[];
  k: number;
  lo: number;
  /** ln-score per ball index. */
  lnNum: ArrayLike<number>;
  /** ln-score of the set's shape bins. */
  shapeScore: (sorted: readonly number[]) => number;
  accept: (sorted: readonly number[]) => boolean;
  /** When given, also track the best set satisfying it (evaluated lazily, only on improvements). */
  ordered: ((sorted: readonly number[]) => boolean) | null;
}

/** Best-scoring k-subset of the candidates; ties (|delta| <= 1e-12) keep the first in enumeration order. */
function searchBest(input: SearchInput): { best: number[] | null; bestOrdered: number[] | null } {
  const { cand, k, lo, lnNum, shapeScore, accept, ordered } = input;
  const n = cand.length;
  let best: number[] | null = null;
  let bestOrdered: number[] | null = null;
  if (n < k) return { best, bestOrdered };
  let bestValue = -Infinity;
  let bestOrderedValue = -Infinity;
  const pos = Array.from({ length: k }, (_, i) => i);
  const sorted = new Array<number>(k);
  for (;;) {
    let v = 0;
    for (let i = 0; i < k; i++) {
      v += lnNum[cand[pos[i]]];
      // insertion into the ascending scratch set
      const x = lo + cand[pos[i]];
      let q = i;
      while (q > 0 && sorted[q - 1] > x) {
        sorted[q] = sorted[q - 1];
        q--;
      }
      sorted[q] = x;
    }
    if (accept(sorted)) {
      v += shapeScore(sorted);
      if (v > bestValue + 1e-12) {
        bestValue = v;
        best = sorted.slice();
      }
      if (ordered && v > bestOrderedValue + 1e-12 && ordered(sorted)) {
        bestOrderedValue = v;
        bestOrdered = sorted.slice();
      }
    }
    // next combination in lexicographic order of positions
    let i = k - 1;
    while (i >= 0 && pos[i] === n - k + i) i--;
    if (i < 0) break;
    pos[i]++;
    for (let q = i + 1; q < k; q++) pos[q] = pos[q - 1] + 1;
  }
  return { best, bestOrdered };
}

/**
 * The R1-R3 (+ R4 when `taken` is given) acceptance test. R5 holds by construction (candidates are live). `overlap`
 * is the most numbers a ticket may share with each taken card: SET_OVERLAP (R4), or BALANCED_OVERLAP for a balanced
 * card (2.15).
 */
function rulesFor(
  ctx: ModelContext,
  post: Posterior,
  past: ReadonlySet<number>,
  taken: readonly (readonly number[])[] | null,
  overlap: number = V2_CONSTANTS.SET_OVERLAP,
): (sorted: readonly number[]) => boolean {
  const g = guardIndex(ctx, post);
  return (sorted) => {
    if (!isTypical(sorted, post.shape)) return false;
    if (!passesGuard(sorted, g, ctx.lo)) return false;
    if (past.has(ticketKey(sorted))) return false;
    if (taken) {
      for (const other of taken) {
        let shared = 0;
        for (const n of sorted) if (other.includes(n)) shared++;
        if (shared > overlap) return false;
      }
    }
    return true;
  };
}

/** ln(theta_f / p0_f) of the set's odd and spread bins (the shape term of logScore). */
function posteriorShapeScore(post: Posterior): (sorted: readonly number[]) => number {
  const lnOdd = Array.from(post.odd.theta, (v, b) => Math.log(v / post.odd.p0[b]));
  const lnSpread = Array.from(post.spread.theta, (v, b) => Math.log(v / post.spread.p0[b]));
  return (sorted) => {
    const bins = binsOf(sorted, post.shape);
    return lnOdd[bins.odd] + lnSpread[bins.spread];
  };
}

// ---------------------------------------------------------------- Top pick (2.15)

export interface TopPick {
  numbers: number[];
  /** The parts follow J >= T >= D over present sources. */
  orderHeld: boolean;
  /** The order filter changed the pick (the best ticket overall was not ordered). */
  filterChanged: boolean;
  letter: string | null;
  bonus: number | null;
  /** Candidate pool size actually searched (CAND unless the fallback ladder was needed). */
  searched: number;
}

/**
 * Top pick: argmax of logScore(S) = sum ln theta_num + sum_f ln lean_f over the k-subsets of the CAND highest-theta
 * live numbers that pass R1-R3, preferring sets whose parts satisfy J >= T >= D. Letter and integer bonus are the
 * argmax of their channels (ties by tie keys). `past` = ticket keys of draws [0, t).
 */
export function topPickAt(ctx: ModelContext, post: Posterior, stream: Stream, past: ReadonlySet<number>): TopPick {
  const theta = post.num.theta;
  const ranked = rankByScore(post.regime.live, theta, stream.numberKeys);
  const lnNum = Array.from(theta, (v) => (v > 0 ? Math.log(v) : -Infinity));
  const accept = rulesFor(ctx, post, past, null);
  const shapeScore = posteriorShapeScore(post);
  const present = post.num.present;
  const ordered = (sorted: readonly number[]) => partsOrdered(setParts(post, sorted, ctx.lo), present);
  const letter = post.letter ? post.letters[argmaxByKey(post.letter.theta, stream.letterKeys)] : null;
  const bonus = post.bonus ? post.bonusMin + argmaxByKey(post.bonus.theta, stream.bonusKeys) : null;
  for (const size of candidateSizes(post.regime.count)) {
    const cand = ranked.slice(0, size).sort((a, b) => stream.numberKeys[a] - stream.numberKeys[b] || a - b);
    const { best, bestOrdered } = searchBest({ cand, k: ctx.k, lo: ctx.lo, lnNum, shapeScore, accept, ordered });
    if (!best) continue;
    if (bestOrdered) {
      return {
        numbers: bestOrdered,
        orderHeld: true,
        filterChanged: bestOrdered.join() !== best.join(),
        letter,
        bonus,
        searched: size,
      };
    }
    return { numbers: best, orderHeld: false, filterChanged: false, letter, bonus, searched: size };
  }
  throw new Error(`model-v2: no ticket passes the pick rules for ${ctx.id} at step ${post.t}`);
}

// ---------------------------------------------------------------- view cards and Lucky dip

export interface Card {
  label: string;
  source: "all" | EvidenceSource | "luckyDip";
  /** How the card was chosen: top (Top pick), source (best ticket of its own source alone), balanced (best ticket of
   *  the full posterior: its source is absent, silent or held back) or uniform (Lucky dip). */
  mode: CardMode;
  numbers: number[];
  letter: string | null;
  bonus: number | null;
  /** Position in the selection order (0 = Top pick, 4 = Lucky dip). R4 is checked against the cards selected before. */
  selection: number;
  /** True only for a Lucky dip drawn from the stream (false for its deterministic fallback and for every other card). */
  sampled: boolean;
}

/** Lower bound for a source-only lean inside logarithms (a damped contrast can in principle reach <= 0). */
const LEAN_FLOOR = 1e-9;

/** What a deterministic view card maximises (2.15). */
interface CardScore {
  /** Per ball index: the value the candidates are ranked by (highest first, ties by tie key). */
  rank: ArrayLike<number>;
  /** Per ball index: the ball term of the score (the logarithm of `rank`). */
  lnNum: ArrayLike<number>;
  /** The shape term of the score: ln lean of the set's odd and spread bins. */
  shapeScore: (sorted: readonly number[]) => number;
  /** Letter and integer-bonus weights (argmax, exact ties to the smallest tie key); null without the channel. */
  letter: ArrayLike<number> | null;
  bonus: ArrayLike<number> | null;
}

/**
 * Source-only score of source s: its lean lambda_s in every channel (numbers, odd, spread, letter, bonus), floored at
 * LEAN_FLOOR. The source-only logScore of a set is sum ln lambda_s(n) + sum_f ln lambda_s^f(bin_f).
 */
function sourceScore(post: Posterior, s: number): CardScore {
  const lean = (ch: Channel) => Array.from(ch.p0, (_, x) => Math.max(LEAN_FLOOR, sourceLeanOf(ch, s, x)));
  const num = lean(post.num);
  const lnOdd = lean(post.odd).map((v) => Math.log(v));
  const lnSpread = lean(post.spread).map((v) => Math.log(v));
  return {
    rank: num,
    lnNum: num.map((v) => Math.log(v)),
    shapeScore: (sorted) => {
      const b = binsOf(sorted, post.shape);
      return lnOdd[b.odd] + lnSpread[b.spread];
    },
    letter: post.letter ? lean(post.letter) : null,
    bonus: post.bonus ? lean(post.bonus) : null,
  };
}

/** Full-posterior score of a balanced card: the Top pick's logScore (ln theta plus the shape leans) and theta. */
function posteriorScore(post: Posterior): CardScore {
  const theta = post.num.theta;
  return {
    rank: theta,
    lnNum: Array.from(theta, (v) => (v > 0 ? Math.log(v) : -Infinity)),
    shapeScore: posteriorShapeScore(post),
    letter: post.letter ? post.letter.theta : null,
    bonus: post.bonus ? post.bonus.theta : null,
  };
}

/**
 * Constrained best ticket of a view card (2.15): the best score among the k-subsets of the CAND live numbers ranked
 * highest by `score.rank` (ties: tie key), enumerated in tie-key order, that pass `accept` (R1-R4 against the cards
 * selected before it); ties (|delta| <= 1e-12) keep the first in enumeration order. Deterministic fallback when
 * nothing passes: CAND 32, then 48, then all live balls; null when nothing passes at all.
 */
function bestTicketOrNull(
  ctx: ModelContext,
  post: Posterior,
  stream: Stream,
  score: Pick<CardScore, "rank" | "lnNum" | "shapeScore">,
  accept: (sorted: readonly number[]) => boolean,
): number[] | null {
  const ranked = rankByScore(post.regime.live, score.rank, stream.numberKeys);
  for (const size of candidateSizes(post.regime.count)) {
    const cand = ranked.slice(0, size).sort((a, b) => stream.numberKeys[a] - stream.numberKeys[b] || a - b);
    const { best } = searchBest({ cand, k: ctx.k, lo: ctx.lo, lnNum: score.lnNum, shapeScore: score.shapeScore, accept, ordered: null });
    if (best) return best;
  }
  return null;
}

/** bestTicketOrNull, which must find a ticket (R1 admits >= 95% and R2 about 70% of all tickets). */
function bestTicket(
  ctx: ModelContext,
  post: Posterior,
  stream: Stream,
  score: Pick<CardScore, "rank" | "lnNum" | "shapeScore">,
  accept: (sorted: readonly number[]) => boolean,
): number[] {
  const best = bestTicketOrNull(ctx, post, stream, score, accept);
  if (!best) throw new Error(`model-v2: no card passes the pick rules for ${ctx.id} at step ${post.t}`);
  return best;
}

/** A uniform index 0..n-1 from one draw of the stream. */
function uniformIndex(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

/**
 * Lucky dip numbers (2.15): uniform over the tickets that pass R1-R4 against the four cards selected before it. Up to
 * SIR_ROUNDS rounds of SIR candidates, each k live balls drawn uniformly one by one without replacement from the
 * stream; the first round with a passing candidate returns one of its passing candidates, chosen uniformly by one more
 * draw. If no round finds one, the first passing ticket in tie-key order (deterministic fallback).
 */
function luckyDipNumbers(
  ctx: ModelContext,
  post: Posterior,
  stream: Stream,
  accept: (sorted: readonly number[]) => boolean,
): { numbers: number[]; sampled: boolean } {
  const { M, k, lo } = ctx;
  const C = V2_CONSTANTS;
  const live = post.regime.live;
  for (let round = 0; round < C.SIR_ROUNDS; round++) {
    const passing: number[][] = [];
    for (let a = 0; a < C.SIR; a++) {
      const rem: number[] = [];
      for (let j = 0; j < M; j++) if (live[j]) rem.push(j);
      const pick: number[] = [];
      for (let q = 0; q < k; q++) pick.push(rem.splice(uniformIndex(stream.rng, rem.length), 1)[0]);
      const set = pick.map((j) => lo + j).sort((x, y) => x - y);
      if (accept(set)) passing.push(set);
    }
    if (passing.length) return { numbers: passing[uniformIndex(stream.rng, passing.length)], sampled: true };
  }
  const flat = { rank: new Array<number>(M).fill(1), lnNum: new Array<number>(M).fill(0), shapeScore: () => 0 };
  return { numbers: bestTicket(ctx, post, stream, flat, accept), sampled: false };
}

/**
 * The five cards (2.15), returned in display order (Top pick, Jackpot pattern, Jackpot days, Daily draws, Lucky dip)
 * but chosen in the selection order: the Top pick; then the cards whose source moves the picks, in the owner's order
 * J, T, D (each the best ticket of its own source alone, R4 against the cards selected before it, the argmax letter
 * and bonus of its own source); then the balanced cards, in the same order; then the Lucky dip. So the sources that
 * move the picks get the strongest tickets. A balanced card is a clearly different alternative: the best ticket of the
 * full posterior that shares at most BALANCED_OVERLAP numbers with every card selected before it (if none passes after
 * the CAND fallbacks, the R4 rule), with the best letter and bonus (full posterior, tie keys) that no card selected
 * before it uses. Cards 2-4 are deterministic (tie keys only); only the Lucky dip consumes the stream after the tie
 * keys: its numbers, then its letter, then its bonus.
 */
export function cardsAt(ctx: ModelContext, post: Posterior, stream: Stream, past: ReadonlySet<number>, top: TopPick): Card[] {
  const taken: number[][] = [top.numbers];
  // Letter and bonus indices of the cards selected so far (a balanced card takes the best one not among them).
  const lettersTaken = new Set<number>();
  const bonusTaken = new Set<number>();
  const keep = (letter: string | null, bonus: number | null) => {
    if (letter !== null) lettersTaken.add(post.letters.indexOf(letter));
    if (bonus !== null) bonusTaken.add(bonus - post.bonusMin);
  };
  keep(top.letter, top.bonus);
  const active = [0, 1, 2].map((s) => sourceActive(post.num, s));
  const order = [...[0, 1, 2].filter((s) => active[s]), ...[0, 1, 2].filter((s) => !active[s])];
  const views: Card[] = [];
  order.forEach((s, q) => {
    const balanced = !active[s];
    const score = balanced ? posteriorScore(post) : sourceScore(post, s);
    const numbers = balanced
      ? (bestTicketOrNull(ctx, post, stream, score, rulesFor(ctx, post, past, taken, V2_CONSTANTS.BALANCED_OVERLAP)) ??
        bestTicket(ctx, post, stream, score, rulesFor(ctx, post, past, taken)))
      : bestTicket(ctx, post, stream, score, rulesFor(ctx, post, past, taken));
    const letter =
      post.letter && score.letter ? post.letters[argmaxByKey(score.letter, stream.letterKeys, balanced ? lettersTaken : SKIP_NONE)] : null;
    const bonus =
      post.bonus && score.bonus ? post.bonusMin + argmaxByKey(score.bonus, stream.bonusKeys, balanced ? bonusTaken : SKIP_NONE) : null;
    taken.push(numbers);
    keep(letter, bonus);
    views[s] = {
      label: cardLabel(SOURCE_NAMES[s]),
      source: SOURCE_NAMES[s],
      mode: active[s] ? "source" : "balanced",
      numbers,
      letter,
      bonus,
      selection: q + 1,
      sampled: false,
    };
  });
  const dip = luckyDipNumbers(ctx, post, stream, rulesFor(ctx, post, past, taken));
  const dipLetter = post.letter ? post.letters[uniformIndex(stream.rng, post.letters.length)] : null;
  const dipBonus = post.bonus ? post.bonusMin + uniformIndex(stream.rng, post.bonusCount) : null;
  return [
    {
      label: cardLabel("all"),
      source: "all",
      mode: "top",
      numbers: top.numbers,
      letter: top.letter,
      bonus: top.bonus,
      selection: 0,
      sampled: false,
    },
    ...views,
    {
      label: cardLabel("luckyDip"),
      source: "luckyDip",
      mode: "uniform",
      numbers: dip.numbers,
      letter: dipLetter,
      bonus: dipBonus,
      selection: 4,
      sampled: dip.sampled,
    },
  ];
}
