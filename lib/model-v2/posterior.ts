// SPDX-License-Identifier: Apache-2.0
// The win-lot-jackpot-v2 posterior at one walk-forward step (docs/MODEL-V2.md sections 2.5-2.10).
//
// Three evidence sources, in the owner's order, become pseudo-counts in every channel (numbers, letters, integer
// bonus, odd class, spread tercile):
//   J  jackpot-winning combinations (structure only: decades, letter, shape bins; Dirichlet-shrunk),
//   T  jackpot-winning dates (calendar fit on the own dates, used as a contrast with ordinary days),
//   D  daily draws (the pool, without the draws already counted as combinations).
// The order cap damps each lower source to at most ORDER of the pull of the source above it, and the prior is raised
// until every lean lies in [2 - MAX_LIFT, MAX_LIFT]. Every lean splits exactly into per-source parts.
//
// posteriorAt(ctx, t, tau) uses only draws [0, t) and evidence known strictly before tau, so production (t = N,
// tau = next draw date) and the backtest (tau = date of draw t) run the same code. Pure: no fs, no clock, no
// Math.random; Map/Set are used for lookups only.

import type { Jackpot } from "../jackpots";
import type { Lottery } from "../lotteries";
import type { Draw } from "../parsers";
import type { EvidenceSource } from "../types";
import { calendarAngles, calendarWeight, fitCalendar, type CalendarFit } from "./calendar";
import { V2_CONSTANTS } from "./constants";
import { cmp, dailyPool, evidenceAt, ownItems, type EvidenceAt, type OwnItem } from "./evidence";
import { deadRun, regimeAt, type Regime } from "./regime";
import { guardRung, type GuardRung } from "./sets";
import { binsOf, ShapeCache, SHAPE_FEATURES, type ShapeFeature, type ShapeNull } from "./shape";

/** Per-source values in the owner's order: index 0 = J (combinations), 1 = T (dates), 2 = D (daily draws). */
export type Triple<T> = [T, T, T];

/** Payload names of the sources, in Triple order. */
export const SOURCE_NAMES: Readonly<Triple<EvidenceSource>> = Object.freeze(["jackpotCombinations", "jackpotDates", "dailyDraws"]) as Readonly<Triple<EvidenceSource>>;

// ---------------------------------------------------------------- context (built once per lottery)

/** Everything about one lottery that does not depend on the step t. */
export interface ModelContext {
  lottery: Lottery;
  id: string;
  name: string;
  lo: number;
  hi: number;
  /** Configured range size hi - lo + 1. */
  M: number;
  /** Main numbers per draw. */
  k: number;
  /** Dead-ball run length (section 2.3). */
  R: number;
  hasLetters: boolean;
  /** Integer bonus range from the config (Mega Power 1..26, Kapruka 1..40), or null when there is none. */
  bonusRange: { min: number; max: number } | null;
  /** Archive, oldest first. */
  history: number[][];
  dates: string[];
  drawNos: number[];
  letters: (string | null)[];
  /** Integer bonus of each draw, else null (the Dhana Nidhanaya Sunday Bonus digits are not modelled). */
  intBonus: (number | null)[];
  /** First archive index with an integer bonus (Infinity if none): the bonus channel exists from there on. */
  firstIntBonus: number;
  /** calendarAngles() of every draw date. */
  angles: number[][];
  /** ticketKey() of every draw (R3 "not a past result"), -1 when the draw is not a valid ticket. */
  keys: number[];
  /** Own jackpot items, canonical order, with knownFrom and archive index. */
  items: OwnItem[];
  shapes: ShapeCache;
}

/** Integer key of an ascending ticket (numbers 0..255); equal tickets have equal keys. */
export function ticketKey(sorted: readonly number[]): number {
  let key = 0;
  for (const n of sorted) key = key * 256 + n;
  return key;
}

export function buildContext(lottery: Lottery, draws: readonly Draw[], jackpots: readonly Jackpot[]): ModelContext {
  const lo = lottery.main_min;
  const hi = lottery.main_max;
  const M = hi - lo + 1;
  const k = lottery.main_count;
  const history = draws.map((d) => [...d.numbers]);
  const intBonus = draws.map((d) => (Number.isInteger(d.bonus) ? (d.bonus as number) : null));
  const firstInt = intBonus.findIndex((b) => b !== null);
  const bonusRange =
    lottery.has_bonus && lottery.bonus_min !== null && lottery.bonus_max !== null
      ? { min: lottery.bonus_min, max: lottery.bonus_max }
      : null;
  const keys = history.map((nums) => {
    const s = [...nums].sort((a, b) => a - b);
    const valid = s.length === k && s.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 255 && (i === 0 || n > s[i - 1]));
    return valid ? ticketKey(s) : -1;
  });
  const dated = draws.map((d) => ({ drawNo: d.draw_no, date: d.draw_date }));
  return {
    lottery,
    id: lottery.id,
    name: lottery.name,
    lo,
    hi,
    M,
    k,
    R: deadRun(M, k),
    hasLetters: lottery.letter_kind !== "none",
    bonusRange,
    history,
    dates: draws.map((d) => d.draw_date),
    drawNos: draws.map((d) => d.draw_no),
    letters: draws.map((d) => d.letter),
    intBonus,
    firstIntBonus: firstInt < 0 ? Infinity : firstInt,
    angles: draws.map((d) => calendarAngles(d.draw_date)),
    keys,
    items: ownItems(lottery.id, jackpots, dated),
    shapes: new ShapeCache(lo, k, history),
  };
}

// ---------------------------------------------------------------- channels

/** One channel of the posterior predictive (numbers, letters, bonus, odd class or spread tercile). */
export interface Channel {
  /** Fair-draw distribution over the categories (0 for dead balls). */
  p0: Float64Array;
  /** Posterior predictive theta = p0 + u / (A + m); 0 where p0 = 0. */
  theta: Float64Array;
  /** parts[s][x] = damped departure of source s / (p0 (A + m)); lean(x) - 1 = sum_s parts[s][x] exactly. */
  parts: Triple<Float64Array>;
  /** Pseudo-count mass per source before damping (0 = absent). */
  mass: Triple<number>;
  present: Triple<boolean>;
  /** Raw pull P_s = sum_x |e_s(x) - m_s p0(x)| (L1 departure from fair) before damping. */
  pull: Triple<number>;
  /** Order-cap damping c_s in [0, 1] (1 = not turned down; 1 for absent sources). */
  damping: Triple<number>;
  /** Realised influence c_s P_s / sum (0 for absent sources; all 0 when every source is silent). */
  share: Triple<number>;
  /** Prior mass A actually used (raised from A0 until every lean is within MAX_LIFT). */
  prior: number;
  /** A / A0 (1 = bound not active). */
  flatten: number;
  /** A + sum_s m_s. */
  total: number;
}

interface SourceCounts {
  e: Float64Array;
  m: number;
}

/** Order cap (2.9) and bounded posterior with exact parts (2.10), sources in the order J, T, D. */
export function assembleChannel(sources: Triple<SourceCounts>, p0: Float64Array, A0: number): Channel {
  const n = p0.length;
  const mass: Triple<number> = [0, 0, 0];
  const present: Triple<boolean> = [false, false, false];
  const pull: Triple<number> = [0, 0, 0];
  const damping: Triple<number> = [1, 1, 1];
  const effective: Triple<number> = [0, 0, 0];
  let ceiling = Infinity;
  for (let s = 0; s < 3; s++) {
    const { e, m } = sources[s];
    if (m <= 1e-12) continue; // absent: no mass, no pull, and the ceiling passes through unchanged
    let P = 0;
    for (let x = 0; x < n; x++) P += Math.abs(e[x] - m * p0[x]);
    const c = P > ceiling ? ceiling / P : 1;
    mass[s] = m;
    present[s] = true;
    pull[s] = P;
    damping[s] = c;
    effective[s] = P * c;
    // A silent source (P = 0) sets the ceiling to 0 for every source below it (strict chain, decision D5).
    ceiling = P * c * V2_CONSTANTS.ORDER;
  }
  let msum = 0;
  for (const m of mass) msum += m;
  let A = A0;
  const room = V2_CONSTANTS.MAX_LIFT - 1;
  for (let x = 0; x < n; x++) {
    if (p0[x] <= 0) continue;
    let u = 0;
    for (let s = 0; s < 3; s++) if (mass[s]) u += damping[s] * (sources[s].e[x] - mass[s] * p0[x]);
    A = Math.max(A, Math.abs(u) / (room * p0[x]) - msum);
  }
  const total = A + msum;
  const theta = new Float64Array(n);
  const parts: Triple<Float64Array> = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let x = 0; x < n; x++) {
    if (p0[x] <= 0) continue;
    let a = A * p0[x];
    for (let s = 0; s < 3; s++) {
      if (!mass[s]) continue;
      const dv = damping[s] * (sources[s].e[x] - mass[s] * p0[x]);
      a += mass[s] * p0[x] + dv;
      parts[s][x] = dv / (p0[x] * total);
    }
    theta[x] = a / total;
  }
  let effSum = 0;
  for (const v of effective) effSum += v;
  const share: Triple<number> = [0, 0, 0];
  if (effSum > 0) for (let s = 0; s < 3; s++) share[s] = effective[s] / effSum;
  return { p0, theta, parts, mass, present, pull, damping, share, prior: A, flatten: A / A0, total };
}

/** lean(x) = theta(x) / p0(x) (1 where p0 = 0). */
export function leanOf(ch: Channel, x: number): number {
  return ch.p0[x] > 0 ? ch.theta[x] / ch.p0[x] : 1;
}

/**
 * Source-only lean lambda_s(x) = 1 + part_s(x) (A + m) / (A + m_s): what source s alone (as damped) points to,
 * on its own prior-plus-source scale. 1 for an absent source.
 */
export function sourceLeanOf(ch: Channel, s: number, x: number): number {
  if (!ch.present[s] || ch.p0[x] <= 0) return 1;
  return 1 + (ch.parts[s][x] * ch.total) / (ch.prior + ch.mass[s]);
}

/** A source moves this channel only when it is present and its damped pull is positive. */
export function sourceActive(ch: Channel, s: number): boolean {
  return ch.present[s] && ch.pull[s] * ch.damping[s] > 0;
}

// ---------------------------------------------------------------- posterior

export interface Posterior {
  t: number;
  /** Target date: evidence is used only when known strictly before it. */
  tau: string;
  regime: Regime;
  shape: ShapeNull;
  /** Odd / spread bins of every archive draw under this support (2 per draw). */
  drawBins: Uint8Array;
  /** U_t: sorted distinct letters of the regime draws [r_t, t). */
  letters: string[];
  /** B: integer bonus categories (0 = no integer bonus channel). */
  bonusCount: number;
  bonusMin: number;
  evidence: EvidenceAt;
  /** 𝒫_t: archive indices of the daily pool. */
  pool: number[];
  /** Jackpot draws inside [r_t, t) that count as combinations instead of daily draws. */
  excludedAsJackpot: number;
  calendar: CalendarFit | null;
  /** ESS of the calendar weights over the pool (null when T is absent or the pool is empty). */
  calendarEss: number | null;
  num: Channel;
  letter: Channel | null;
  bonus: Channel | null;
  odd: Channel;
  spread: Channel;
  /** Live numbers of each usable own combination (canonical order) and their sorted union. */
  combos: number[][];
  union: number[];
  /** Copy-guard rung of the ladder (2.14). */
  guard: GuardRung;
}

interface Tally {
  num: Float64Array;
  letter: Float64Array;
  bonus: Float64Array;
  odd: Float64Array;
  spread: Float64Array;
  mNum: number;
  mLetter: number;
  mBonus: number;
  mShape: number;
}

function newTally(M: number, U: number, B: number): Tally {
  return {
    num: new Float64Array(M),
    letter: new Float64Array(U),
    bonus: new Float64Array(B),
    odd: new Float64Array(3),
    spread: new Float64Array(3),
    mNum: 0,
    mLetter: 0,
    mBonus: 0,
    mShape: 0,
  };
}

/** The decade of a ball: 1-10, 11-20, ..., 71-80 (which also holds 81-82). */
export function decadeOf(n: number): number {
  return Math.max(0, Math.min(7, Math.floor((n - 1) / 10)));
}

/** Fill a contrast channel: e = m (p0 + F_rho - F_u); 0 departure where the pool has no mass in the channel. */
function contrast(out: Float64Array, wr: Float64Array, wu: Float64Array, mr: number, mu: number, m: number, p0: Float64Array) {
  for (let x = 0; x < out.length; x++) out[x] = m * p0[x] + (mr > 0 && mu > 0 ? m * (wr[x] / mr - wu[x] / mu) : 0);
}

/** The posterior at step t (draws [0, t)) for a draw on date tau. */
export function posteriorAt(ctx: ModelContext, t: number, tau: string): Posterior {
  const { lo, hi, M, k } = ctx;
  const C = V2_CONSTANTS;
  const regime = regimeAt(ctx.history, lo, hi, k, t, ctx.R);
  const { live, count: L, start } = regime;
  const { st, drawBins } = ctx.shapes.get(live);

  // Evidence and the partition rule (2.4).
  const evidence = evidenceAt(ctx.items, t, tau);
  const pool = dailyPool(start, t, evidence.excluded);
  const excludedAsJackpot = evidence.excluded.filter((i) => i >= start).length;

  // Categories of the small channels.
  const letterList: string[] = [];
  if (ctx.hasLetters) for (let i = start; i < t; i++) if (ctx.letters[i]) letterList.push(ctx.letters[i] as string);
  letterList.sort(cmp);
  const letters = letterList.filter((l, q) => q === 0 || letterList[q - 1] !== l);
  const letterIndex = new Map(letters.map((l, i) => [l, i] as const));
  const U = letters.length;
  const bonusMin = ctx.bonusRange?.min ?? 0;
  const B = ctx.bonusRange && ctx.firstIntBonus < t ? ctx.bonusRange.max - ctx.bonusRange.min + 1 : 0;

  const p0num = new Float64Array(M);
  for (let j = 0; j < M; j++) if (live[j]) p0num[j] = 1 / L;
  const p0letter = new Float64Array(U).fill(1 / U);
  const p0bonus = new Float64Array(B).fill(1 / B);

  const add = (acc: Tally, i: number, w: number) => {
    for (const n of ctx.history[i]) {
      const j = n - lo;
      if (j >= 0 && j < M && live[j]) {
        acc.num[j] += w;
        acc.mNum += w;
      }
    }
    const l = ctx.letters[i];
    if (l) {
      const li = letterIndex.get(l);
      if (li !== undefined) {
        acc.letter[li] += w;
        acc.mLetter += w;
      }
    }
    const b = ctx.intBonus[i];
    if (B && b !== null) {
      const bi = b - bonusMin;
      if (bi >= 0 && bi < B) {
        acc.bonus[bi] += w;
        acc.mBonus += w;
      }
    }
    acc.odd[drawBins[2 * i]] += w;
    acc.spread[drawBins[2 * i + 1]] += w;
    acc.mShape += w;
  };

  // D: daily draws (2.6).
  const Dt = newTally(M, U, B);
  for (const i of pool) add(Dt, i, C.W_D);

  // T: jackpot dates, as a contrast of calendar-similar days with ordinary days (2.7).
  const Tt = newTally(M, U, B);
  const V = evidence.dates.length;
  let calendar: CalendarFit | null = null;
  let calendarEss: number | null = null;
  if (V > 0) {
    calendar = fitCalendar(evidence.dates.map((it) => it.date as string));
    const Wr = newTally(M, U, B);
    const Wu = newTally(M, U, B);
    if (pool.length) {
      const fit = calendar;
      const rho = pool.map((i) => calendarWeight(ctx.angles[i], fit));
      let rs = 0;
      for (const r of rho) rs += r;
      const omega = rho.map((r) => r / rs);
      let s2 = 0;
      for (const w of omega) s2 += w * w;
      calendarEss = 1 / s2;
      pool.forEach((i, q) => {
        add(Wr, i, omega[q]);
        add(Wu, i, 1 / pool.length);
      });
    }
    const mNum = C.W_T * V * k;
    const mOther = C.W_T * V;
    contrast(Tt.num, Wr.num, Wu.num, Wr.mNum, Wu.mNum, mNum, p0num);
    Tt.mNum = mNum;
    if (U) {
      contrast(Tt.letter, Wr.letter, Wu.letter, Wr.mLetter, Wu.mLetter, mOther, p0letter);
      Tt.mLetter = mOther;
    }
    if (B) {
      contrast(Tt.bonus, Wr.bonus, Wu.bonus, Wr.mBonus, Wu.mBonus, mOther, p0bonus);
      Tt.mBonus = mOther;
    }
    contrast(Tt.odd, Wr.odd, Wu.odd, Wr.mShape, Wu.mShape, mOther, st.p0.odd);
    contrast(Tt.spread, Wr.spread, Wu.spread, Wr.mShape, Wu.mShape, mOther, st.p0.spread);
    Tt.mShape = mOther;
  }

  // J: jackpot combinations, structure only, Dirichlet-shrunk toward the null (2.8).
  const Jt = newTally(M, U, B);
  const combosIt = evidence.combinations;
  const nJ = combosIt.length;
  if (nJ) {
    const groupSize = new Array<number>(8).fill(0);
    for (let j = 0; j < M; j++) if (live[j]) groupSize[decadeOf(lo + j)]++;
    const groupCount = new Array<number>(8).fill(0);
    let Cn = 0;
    for (const c of combosIt) {
      for (const n of c.numbers as number[]) {
        if (n >= lo && n <= hi && live[n - lo]) {
          groupCount[decadeOf(n)]++;
          Cn++;
        }
      }
    }
    const a = C.J_PRIOR * k;
    const mNum = C.W_J * nJ * k;
    for (let j = 0; j < M; j++) {
      if (!live[j]) continue;
      const g = decadeOf(lo + j);
      Jt.num[j] = (mNum * ((groupCount[g] + (a * groupSize[g]) / L) / (Cn + a))) / groupSize[g];
    }
    Jt.mNum = mNum;
    if (U) {
      const cl = new Array<number>(U).fill(0);
      let nl = 0;
      for (const c of combosIt) {
        const li = c.letter ? letterIndex.get(c.letter) : undefined;
        if (li !== undefined) {
          cl[li]++;
          nl++;
        }
      }
      if (nl) {
        const m = C.W_J * nl;
        for (let i = 0; i < U; i++) Jt.letter[i] = (m * (cl[i] + C.J_PRIOR / U)) / (nl + C.J_PRIOR);
        Jt.mLetter = m;
      }
    }
    if (B) {
      const cb = new Array<number>(B).fill(0);
      let nb = 0;
      for (const c of combosIt) {
        if (c.bonus === null) continue;
        const bi = c.bonus - bonusMin;
        if (bi >= 0 && bi < B) {
          cb[bi]++;
          nb++;
        }
      }
      if (nb) {
        const m = C.W_J * nb;
        for (let i = 0; i < B; i++) Jt.bonus[i] = (m * (cb[i] + C.J_PRIOR / B)) / (nb + C.J_PRIOR);
        Jt.mBonus = m;
      }
    }
    const m = C.W_J * nJ;
    const binCount: Record<ShapeFeature, number[]> = { odd: [0, 0, 0], spread: [0, 0, 0] };
    for (const c of combosIt) {
      const bins = binsOf((c.numbers as number[]).map((v) => Math.min(v, hi)), st);
      binCount.odd[bins.odd]++;
      binCount.spread[bins.spread]++;
    }
    for (const f of SHAPE_FEATURES) {
      for (let b = 0; b < 3; b++) Jt[f][b] = (m * (binCount[f][b] + C.J_PRIOR * st.p0[f][b])) / (nJ + C.J_PRIOR);
    }
    Jt.mShape = m;
  }

  // Order cap and posterior per channel (2.9, 2.10).
  const order = [Jt, Tt, Dt];
  const triple = (pick: (x: Tally) => SourceCounts): Triple<SourceCounts> => [pick(order[0]), pick(order[1]), pick(order[2])];
  const num = assembleChannel(triple((x) => ({ e: x.num, m: x.mNum })), p0num, C.PRIOR * k);
  const letter = U ? assembleChannel(triple((x) => ({ e: x.letter, m: x.mLetter })), p0letter, C.PRIOR) : null;
  const bonus = B ? assembleChannel(triple((x) => ({ e: x.bonus, m: x.mBonus })), p0bonus, C.PRIOR) : null;
  const odd = assembleChannel(triple((x) => ({ e: x.odd, m: x.mShape })), st.p0.odd, C.PRIOR);
  const spread = assembleChannel(triple((x) => ({ e: x.spread, m: x.mShape })), st.p0.spread, C.PRIOR);

  // Copy guard (2.14): live numbers of the usable combinations and their union.
  const combos = combosIt.map((c) => (c.numbers as number[]).filter((n) => n >= lo && n <= hi && live[n - lo] === 1));
  const flat = combos.flat().sort((a, b) => a - b);
  const union = flat.filter((n, q) => q === 0 || flat[q - 1] !== n);
  const guard = guardRung(L, combos.map((c) => c.length), union.length, k);

  return {
    t,
    tau,
    regime,
    shape: st,
    drawBins,
    letters,
    bonusCount: B,
    bonusMin,
    evidence,
    pool,
    excludedAsJackpot,
    calendar,
    calendarEss,
    num,
    letter,
    bonus,
    odd,
    spread,
    combos,
    union,
    guard,
  };
}

/** Pattern lean (2.10): 100 * total-variation distance of theta_num from all-numbers-equal (0..100; not an advantage). */
export function patternLean(post: Posterior): number {
  let s = 0;
  const ch = post.num;
  for (let x = 0; x < ch.p0.length; x++) s += Math.abs(ch.theta[x] - ch.p0[x]);
  return 50 * s;
}
