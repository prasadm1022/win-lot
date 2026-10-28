// SPDX-License-Identifier: Apache-2.0
// Descriptive statistics for GET /api/lotteries/:id/stats (see docs/ARCHITECTURE.md).

import type { Lottery } from "./lotteries";
import type { Draw } from "./parsers";

export interface Stats {
  lotteryId: string;
  window: string;
  drawCount: number;
  frequency: { n: number; count: number; lastSeenDrawsAgo: number | null; expectedGap: number }[];
  hot: number[];
  cold: number[];
  overdue: number[];
  letterFrequency: { letter: string; count: number }[];
  sumSeries: { drawNo: number; date: string; sum: number }[];
  oddEven: { odd: number; even: number; count: number }[];
  highLow: { high: number; low: number; count: number }[];
  pairs: { a: number; b: number; count: number }[];
  positionHeat: number[][];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** `draws` oldest first, already limited to the requested window. */
export function computeStats(lottery: Lottery, draws: Draw[], window: string): Stats {
  const lo = lottery.main_min;
  const hi = lottery.main_max;
  const k = lottery.main_count;
  const size = hi - lo + 1;
  const total = draws.length;
  const expectedGap = round2(size / k);
  const mid = Math.floor((lo + hi) / 2);

  const counts = new Array(size).fill(0);
  const lastIdx = new Array(size).fill(-1);
  const letters = new Map<string, number>();
  const oddEven = new Map<number, number>();
  const highLow = new Map<number, number>();
  const pairs = new Map<number, number>();
  const positionHeat: number[][] = Array.from({ length: k }, () => new Array(size).fill(0));

  draws.forEach((d, idx) => {
    const nums = d.numbers;
    nums.forEach((n, pos) => {
      if (n < lo || n > hi) return;
      counts[n - lo]++;
      lastIdx[n - lo] = idx;
      if (pos < k) positionHeat[pos][n - lo]++;
    });
    if (d.letter) letters.set(d.letter, (letters.get(d.letter) ?? 0) + 1);
    const odd = nums.filter((n) => n % 2 === 1).length;
    oddEven.set(odd, (oddEven.get(odd) ?? 0) + 1);
    const high = nums.filter((n) => n > mid).length;
    highLow.set(high, (highLow.get(high) ?? 0) + 1);
    const sorted = [...nums].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = sorted[i] * 1000 + sorted[j];
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  });

  const frequency = counts.map((count, i) => ({
    n: lo + i,
    count,
    lastSeenDrawsAgo: lastIdx[i] >= 0 ? total - 1 - lastIdx[i] : null,
    expectedGap,
  }));
  const numbersBy = (cmp: (a: (typeof frequency)[0], b: (typeof frequency)[0]) => number) =>
    [...frequency].sort((a, b) => cmp(a, b) || a.n - b.n).slice(0, 10).map((f) => f.n);
  const gapOf = (f: (typeof frequency)[0]) => f.lastSeenDrawsAgo ?? total;

  return {
    lotteryId: lottery.id,
    window,
    drawCount: total,
    frequency,
    hot: numbersBy((a, b) => b.count - a.count),
    cold: numbersBy((a, b) => a.count - b.count),
    overdue: numbersBy((a, b) => gapOf(b) - gapOf(a)),
    letterFrequency: [...letters.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([letter, count]) => ({ letter, count })),
    sumSeries: draws.slice(-200).map((d) => ({
      drawNo: d.draw_no,
      date: d.draw_date,
      sum: d.numbers.reduce((s, n) => s + n, 0),
    })),
    oddEven: Array.from({ length: k + 1 }, (_, odd) => ({ odd, even: k - odd, count: oddEven.get(odd) ?? 0 })),
    highLow: Array.from({ length: k + 1 }, (_, high) => ({ high, low: k - high, count: highLow.get(high) ?? 0 })),
    pairs: [...pairs.entries()]
      .sort((a, b) => b[1] - a[1] || a[0] - b[0])
      .slice(0, 20)
      .map(([key, count]) => ({ a: Math.floor(key / 1000), b: key % 1000, count })),
    positionHeat,
  };
}
