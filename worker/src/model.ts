// win-lot prediction model: 1:1 port of scraper/model.py (keep both in sync; see `npm run check:model`).
// Lottery draws are random; this is a transparent statistical heuristic, not a forecast.

import type { Lottery } from "./lotteries";
import type { Draw } from "./parsers";

export const MODEL_VERSION = "win-lot-heuristic-v1";
const DECAY = 0.9771599684342459; // 0.5 ** (1 / 30): half-life of 30 draws
const RECENT_WINDOW = 100;
const BACKTEST_DRAWS = 200;
const BACKTEST_MIN_TRAIN = 30;
const W_LONG = 0.35;
const W_RECENT = 0.4;
const W_OVERDUE = 0.25;
const OVERDUE_CAP = 3.0;
const SAMPLE_ATTEMPTS = 200;

export const METHOD =
  "Blended score per number: 35% long-run frequency, 40% recent frequency (last 100 draws, " +
  "exponentially decayed, half-life 30 draws) and 25% overdue-ness (draws since last seen vs. the " +
  "expected gap, capped at 3x), each min-max normalised. 'Top scores' takes the highest-scoring " +
  "numbers; the other sets are sampled from the hot, overdue and blended distributions and kept only " +
  "if their odd count and sum fall inside the historic interquartile range. The letter is chosen by " +
  "decayed letter frequency. Walk-forward backtest over the last 200 draws compares the average number " +
  "of main-number hits of 'Top scores' with the random expectation.";
export const DISCLAIMER =
  "Lottery draws are random and every combination is equally likely. These picks are a statistical " +
  "curiosity for entertainment only; they do not improve your odds. Please play responsibly.";

export interface PredictionSet {
  label: string;
  letter: string | null;
  numbers: number[];
  bonus: number | null;
  score: number;
}

export interface Prediction {
  lotteryId: string;
  generatedAt: string;
  basedOnDraws: number;
  nextDrawDate: string;
  nextDrawNo: number;
  sets: PredictionSet[];
  numberScores: { n: number; score: number }[];
  method: string;
  disclaimer: string;
  backtest: { draws: number; avgHits: number; randomBaseline: number };
  modelVersion: string;
}

// ---------------------------------------------------------------- helpers

export function r4(x: number): number {
  return Math.floor(x * 10000 + 0.5) / 10000;
}

export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalise(values: number[]): number[] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo === 0) return values.map(() => 0.5);
  return values.map((v) => (v - lo) / (hi - lo));
}

export function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const frac = pos - base;
  if (base + 1 < sorted.length) return sorted[base] + (sorted[base + 1] - sorted[base]) * frac;
  return sorted[base];
}

// ---------------------------------------------------------------- scoring

type Components = [number[], number[], number[]];

function components(
  history: number[][],
  lo: number,
  hi: number,
  k: number,
  total: number = history.length,
  pre?: { counts: number[]; lastSeen: number[] },
): Components {
  const size = hi - lo + 1;
  let counts: number[];
  let lastSeen: number[];
  if (pre) {
    counts = pre.counts;
    lastSeen = pre.lastSeen;
  } else {
    counts = new Array(size).fill(0);
    lastSeen = new Array(size).fill(-1);
    for (let idx = 0; idx < total; idx++) {
      for (const n of history[idx]) {
        if (n >= lo && n <= hi) {
          counts[n - lo] += 1;
          lastSeen[n - lo] = idx;
        }
      }
    }
  }
  const longRaw = counts.map((c) => (total ? c / total : 0));
  const recentRaw = new Array(size).fill(0);
  let weight = 1.0;
  const window = Math.min(RECENT_WINDOW, total);
  for (let age = 0; age < window; age++) {
    for (const n of history[total - 1 - age]) {
      if (n >= lo && n <= hi) recentRaw[n - lo] += weight;
    }
    weight = weight * DECAY;
  }
  const expectedGap = size / k;
  const overdueRaw: number[] = [];
  for (let i = 0; i < size; i++) {
    const gap = lastSeen[i] >= 0 ? total - 1 - lastSeen[i] : total;
    const ratio = gap / expectedGap;
    overdueRaw.push((ratio < OVERDUE_CAP ? ratio : OVERDUE_CAP) / OVERDUE_CAP);
  }
  return [normalise(longRaw), normalise(recentRaw), normalise(overdueRaw)];
}

function blend([longN, recentN, overdueN]: Components): number[] {
  const raw: number[] = [];
  for (let i = 0; i < longN.length; i++) raw.push(W_LONG * longN[i] + W_RECENT * recentN[i] + W_OVERDUE * overdueN[i]);
  return normalise(raw);
}

function topK(scores: number[], lo: number, k: number): number[] {
  const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  return order
    .slice(0, k)
    .map((i) => lo + i)
    .sort((a, b) => a - b);
}

function weightedSample(rng: () => number, weights: number[], k: number): number[] {
  const remaining = weights.map((_, i) => i);
  const picked: number[] = [];
  const n = Math.min(k, remaining.length);
  for (let p = 0; p < n; p++) {
    let total = 0;
    for (const i of remaining) total += weights[i];
    const r = rng() * total;
    let cum = 0;
    let choice = remaining[remaining.length - 1];
    for (const i of remaining) {
      cum += weights[i];
      if (r < cum) {
        choice = i;
        break;
      }
    }
    picked.push(choice);
    remaining.splice(remaining.indexOf(choice), 1);
  }
  return picked;
}

// ---------------------------------------------------------------- backtest

export function backtest(history: number[][], lo: number, hi: number, k: number) {
  const total = history.length;
  const size = hi - lo + 1;
  const start = Math.max(BACKTEST_MIN_TRAIN, total - BACKTEST_DRAWS);
  const randomBaseline = r4((k * k) / size);
  if (start >= total) return { draws: 0, avgHits: 0, randomBaseline };
  const counts = new Array(size).fill(0);
  const lastSeen = new Array(size).fill(-1);
  for (let idx = 0; idx < start; idx++) {
    for (const n of history[idx]) {
      if (n >= lo && n <= hi) {
        counts[n - lo] += 1;
        lastSeen[n - lo] = idx;
      }
    }
  }
  let hits = 0;
  for (let t = start; t < total; t++) {
    const scores = blend(components(history, lo, hi, k, t, { counts, lastSeen }));
    const pick = new Set(topK(scores, lo, k));
    for (const n of history[t]) if (pick.has(n)) hits++;
    for (const n of history[t]) {
      if (n >= lo && n <= hi) {
        counts[n - lo] += 1;
        lastSeen[n - lo] = t;
      }
    }
  }
  return { draws: total - start, avgHits: r4(hits / (total - start)), randomBaseline };
}

// ---------------------------------------------------------------- prediction

function weekday(iso: string): number {
  // Monday = 0 ... Sunday = 6 (Python's date.weekday()).
  const d = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return (d + 6) % 7;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function nextDrawDate(dates: string[]): string {
  const weekdays = new Set(dates.slice(-28).map(weekday));
  const last = dates[dates.length - 1];
  for (let i = 1; i <= 14; i++) {
    const day = addDays(last, i);
    if (weekdays.has(weekday(day))) return day;
  }
  return addDays(last, 1);
}

function letterScores(letters: (string | null)[]): [string[], number[]] {
  const seq = letters.filter((l): l is string => !!l);
  const universe = [...new Set(seq)].sort();
  if (!universe.length) return [[], []];
  const raw = new Map<string, number>(universe.map((l) => [l, 1.0]));
  let weight = 1.0;
  const window = Math.min(RECENT_WINDOW, seq.length);
  for (let age = 0; age < window; age++) {
    const l = seq[seq.length - 1 - age];
    raw.set(l, raw.get(l)! + weight);
    weight = weight * DECAY;
  }
  return [universe, universe.map((l) => raw.get(l)!)];
}

function sameSet(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** `draws` oldest first. */
export function predict(lottery: Lottery, draws: Draw[], generatedAt: string): Prediction {
  const lo = lottery.main_min;
  const hi = lottery.main_max;
  const k = lottery.main_count;
  const history = draws.map((d) => d.numbers);
  const [longN, recentN, overdueN] = components(history, lo, hi, k);
  const scores = blend([longN, recentN, overdueN]);
  const last = draws[draws.length - 1];
  const rng = mulberry32(fnv1a(`${lottery.id}:${last.draw_no}`));

  const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const oddOf = (xs: number[]) => xs.filter((n) => n % 2 === 1).length;
  const oddCounts = history.map(oddOf).sort((a, b) => a - b);
  const sums = history.map(sumOf).sort((a, b) => a - b);
  const oddLo = quantile(oddCounts, 0.25);
  const oddHi = quantile(oddCounts, 0.75);
  const sumLo = quantile(sums, 0.25);
  const sumHi = quantile(sums, 0.75);
  const acceptable = (nums: number[]) => {
    const odd = oddOf(nums);
    const total = sumOf(nums);
    return oddLo <= odd && odd <= oddHi && sumLo <= total && total <= sumHi;
  };

  const strategies: [string, number[]][] = [
    ["Hot streak", recentN.map((x) => x * x + 0.0025)],
    ["Overdue hunter", overdueN.map((x) => x * x + 0.0025)],
    ["Balanced blend", scores.map((x) => (x + 0.05) * (x + 0.05))],
    ["Wildcard", scores.map((x) => x + 0.5)],
  ];
  const numberSets: [string, number[]][] = [["Top scores", topK(scores, lo, k)]];
  for (const [label, weights] of strategies) {
    let chosen: number[] = [];
    for (let attempt = 0; attempt < SAMPLE_ATTEMPTS; attempt++) {
      const candidate = weightedSample(rng, weights, k)
        .map((i) => lo + i)
        .sort((a, b) => a - b);
      chosen = candidate;
      if (acceptable(candidate) && numberSets.every(([, s]) => !sameSet(candidate, s))) break;
    }
    numberSets.push([label, chosen]);
  }

  const [universe, lScores] = letterScores(draws.map((d) => d.letter));
  let bonusScores: number[] | null = null;
  if (bonusType(lottery, draws) === "int") {
    const bHist = draws.filter((d) => Number.isInteger(d.bonus)).map((d) => [d.bonus as number]);
    bonusScores = blend(components(bHist, lottery.bonus_min!, lottery.bonus_max!, 1));
  }

  const sets: PredictionSet[] = numberSets.map(([label, nums], idx) => {
    let letter: string | null = null;
    if (universe.length && lottery.letter_kind !== "none") {
      if (idx === 0) {
        let best = 0;
        for (let i = 1; i < universe.length; i++) if (lScores[i] > lScores[best]) best = i;
        letter = universe[best];
      } else {
        letter = universe[weightedSample(rng, lScores, 1)[0]];
      }
    }
    let bonus: number | null = null;
    if (bonusScores) {
      if (idx === 0) bonus = topK(bonusScores, lottery.bonus_min!, 1)[0];
      else bonus = lottery.bonus_min! + weightedSample(rng, bonusScores.map((x) => (x + 0.05) * (x + 0.05)), 1)[0];
    }
    let setScore = 0;
    for (const n of nums) setScore += scores[n - lo];
    return { label, letter, numbers: nums, bonus, score: r4(setScore / nums.length) };
  });

  return {
    lotteryId: lottery.id,
    generatedAt,
    basedOnDraws: draws.length,
    nextDrawDate: nextDrawDate(draws.map((d) => d.draw_date)),
    nextDrawNo: last.draw_no + 1,
    sets,
    numberScores: scores.map((s, i) => ({ n: lo + i, score: r4(s) })),
    method: METHOD,
    disclaimer: DISCLAIMER,
    backtest: backtest(history, lo, hi, k),
    modelVersion: MODEL_VERSION,
  };
}

function bonusType(lottery: Lottery, draws: Draw[]): "int" | null {
  if (!lottery.has_bonus || lottery.bonus_min === null || lottery.bonus_max === null) return null;
  return draws.some((d) => Number.isInteger(d.bonus)) ? "int" : null;
}
