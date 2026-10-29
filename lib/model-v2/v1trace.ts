// SPDX-License-Identifier: Apache-2.0
// Per-draw hits of the v1 "Top scores" set on v1's own backtest window (docs/MODEL-V2.md section 2.18 item 8).
// lib/model.ts stays untouched and only reports the average, so this is a faithful port of its backtest loop
// (components, blend and topK with the same float operations in the same order). predictAllV2 asserts that the
// mean of these hits equals backtest().avgHits for every lottery, which makes the v1/v2 comparison paired.

import { V2_CONSTANTS } from "./constants";

// v1 model constants (lib/model.ts). They must stay equal to v1's; the build assertion catches any drift.
const DECAY = 0.9771599684342459; // 0.5 ** (1 / 30): half-life of 30 draws
const RECENT_WINDOW = 100;
const W_LONG = 0.35;
const W_RECENT = 0.4;
const W_OVERDUE = 0.25;
const OVERDUE_CAP = 3.0;

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

/**
 * Hits of v1's "Top scores" (the k highest blended scores) on every test draw t of the window
 * [max(30, N - 200), N), using draws [0, t) only, exactly as backtest() in lib/model.ts.
 */
export function v1TopPickHits(history: readonly (readonly number[])[], lo: number, hi: number, k: number): number[] {
  const total = history.length;
  const size = hi - lo + 1;
  const start = Math.max(V2_CONSTANTS.BT_MIN, total - V2_CONSTANTS.BT_DRAWS);
  const hits: number[] = [];
  if (start >= total) return hits;
  const counts = new Array<number>(size).fill(0);
  const lastSeen = new Array<number>(size).fill(-1);
  const see = (idx: number) => {
    for (const n of history[idx]) {
      if (n >= lo && n <= hi) {
        counts[n - lo] += 1;
        lastSeen[n - lo] = idx;
      }
    }
  };
  for (let idx = 0; idx < start; idx++) see(idx);
  for (let t = start; t < total; t++) {
    const longRaw = counts.map((c) => (t ? c / t : 0));
    const recentRaw = new Array<number>(size).fill(0);
    let weight = 1.0;
    const window = Math.min(RECENT_WINDOW, t);
    for (let age = 0; age < window; age++) {
      for (const n of history[t - 1 - age]) if (n >= lo && n <= hi) recentRaw[n - lo] += weight;
      weight = weight * DECAY;
    }
    const expectedGap = size / k;
    const overdueRaw: number[] = [];
    for (let i = 0; i < size; i++) {
      const gap = lastSeen[i] >= 0 ? t - 1 - lastSeen[i] : t;
      const ratio = gap / expectedGap;
      overdueRaw.push((ratio < OVERDUE_CAP ? ratio : OVERDUE_CAP) / OVERDUE_CAP);
    }
    const longN = normalise(longRaw);
    const recentN = normalise(recentRaw);
    const overdueN = normalise(overdueRaw);
    const raw: number[] = [];
    for (let i = 0; i < size; i++) raw.push(W_LONG * longN[i] + W_RECENT * recentN[i] + W_OVERDUE * overdueN[i]);
    const scores = normalise(raw);
    const order = scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
    const pick = new Uint8Array(size);
    for (const i of order.slice(0, k)) pick[i] = 1;
    let h = 0;
    for (const n of history[t]) if (n >= lo && n <= hi && pick[n - lo]) h++;
    hits.push(h);
    see(t);
  }
  return hits;
}
