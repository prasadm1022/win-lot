// SPDX-License-Identifier: Apache-2.0
// Step 0 of win-lot-jackpot-v2 (docs/MODEL-V2.md section 2.3): which balls are still in the machine at step t, and
// where the current regime starts. Uses draws [0, t) only, so it is identical in production (t = N) and in the
// walk-forward backtest.

import { V2_CONSTANTS } from "./constants";

/**
 * R: a live ball goes R draws unseen with probability at most DEAD_P, R = ceil(ln DEAD_P / ln(1 - k/M)).
 * 270 for 1..80 and 277 for 1..82.
 */
export function deadRun(M: number, k: number): number {
  return Math.ceil(Math.log(V2_CONSTANTS.DEAD_P) / Math.log(1 - k / M));
}

export interface Regime {
  /** live[j] = 1 when ball lo + j is in use (Λ_t). */
  live: Uint8Array;
  /** L = |Λ_t|. */
  count: number;
  /** r_t: first archive index of the current regime. */
  start: number;
  /** Balls treated as no longer in use, ascending. */
  excluded: number[];
}

/**
 * Live balls and regime start from `history[0..t)` (numbers of each draw, oldest first).
 *
 *   dead_t(n)  <=>  t >= R and (n never drawn, or drawn last more than R draws ago)
 *   activation of n at i: first appearance with i >= R, or a reappearance after a gap of more than R draws
 *   r_t = max(latest activation < t, max{ last_t(n) + 1 : n dead and drawn before }, 0)
 */
export function regimeAt(
  history: readonly (readonly number[])[],
  lo: number,
  hi: number,
  k: number,
  t: number,
  R: number = deadRun(hi - lo + 1, k),
): Regime {
  const M = hi - lo + 1;
  const last = new Int32Array(M).fill(-1);
  let start = 0;
  for (let i = 0; i < t; i++) {
    for (const n of history[i]) {
      const j = n - lo;
      if (j < 0 || j >= M) continue;
      const prev = last[j];
      if ((prev < 0 && i >= R) || (prev >= 0 && i - prev > R)) start = Math.max(start, i);
      last[j] = i;
    }
  }
  const live = new Uint8Array(M);
  const excluded: number[] = [];
  let count = 0;
  for (let j = 0; j < M; j++) {
    const dead = t >= R && (last[j] < 0 || t - last[j] > R);
    if (dead) {
      excluded.push(lo + j);
      if (last[j] >= 0) start = Math.max(start, last[j] + 1);
    } else {
      live[j] = 1;
      count++;
    }
  }
  return { live, count, start, excluded };
}
