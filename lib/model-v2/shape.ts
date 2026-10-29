// SPDX-License-Identifier: Apache-2.0
// Exact null distributions of ticket shape on the live balls (docs/MODEL-V2.md section 2.5): sum (for the typicality
// band only; it is not a channel), spread = max - min (tercile channel) and odd count (class channel). All counts are
// exact integers over the C(L, k) tickets, so bins and bands do not depend on float accumulation. Cached per
// live-ball signature: they change only at regime changes.

import { V2_CONSTANTS } from "./constants";

/** Binomial coefficient (exact for the sizes used here: every intermediate value is an integer below 2^53). */
export function choose(n: number, r: number): number {
  if (r < 0 || r > n) return 0;
  let x = 1;
  for (let i = 0; i < r; i++) x = (x * (n - i)) / (i + 1);
  return x;
}

export type ShapeFeature = "odd" | "spread";
export const SHAPE_FEATURES: readonly ShapeFeature[] = ["odd", "spread"];

export interface ShapeBins {
  odd: number;
  spread: number;
}

export interface ShapeNull {
  /** Live balls, ascending. */
  support: readonly number[];
  k: number;
  /** C(L, k): the number of tickets on the support. */
  total: number;
  /** Ticket counts by sum, spread and odd count (index = value). Exact integers. */
  sumCounts: Float64Array;
  spreadCounts: Float64Array;
  oddCounts: Float64Array;
  /** Spread terciles: bin 0 = spread <= edges[0], bin 1 = spread <= edges[1], bin 2 above. */
  spreadEdges: [number, number];
  /** Typicality band [s10, s90]: first sums where the null CDF reaches TYPICAL.sumLowQ and sumHighQ. */
  sumBand: [number, number];
  /** Null probability of each of the 3 bins per shape channel. */
  p0: Record<ShapeFeature, Float64Array>;
  /** Plain bin labels per shape channel, e.g. "0-1 odd", "spread 3-46". */
  labels: Record<ShapeFeature, string[]>;
}

/** Odd-count class: below k/2, exactly k/2, above k/2 ({0-1}, {2}, {3-4} for k = 4). */
export function oddBin(odd: number, k: number): number {
  return odd < k / 2 ? 0 : odd === k / 2 ? 1 : 2;
}

export function spreadBin(spread: number, edges: readonly [number, number]): number {
  return spread <= edges[0] ? 0 : spread <= edges[1] ? 1 : 2;
}

/** Odd and spread bins of a ticket (any order). */
export function binsOf(set: readonly number[], st: ShapeNull): ShapeBins {
  let odd = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const n of set) {
    if (n % 2 !== 0) odd++;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return { odd: oddBin(odd, st.k), spread: spreadBin(max - min, st.spreadEdges) };
}

/** First value whose cumulative count reaches q * total (exact: cum / total >= num / den). */
function firstReaching(counts: Float64Array, total: number, num: number, den: number): number {
  let cum = 0;
  for (let x = 0; x < counts.length; x++) {
    cum += counts[x];
    if (cum * den >= num * total) return x;
  }
  return counts.length - 1;
}

function rangeLabel(a: number, b: number): string {
  return a === b ? `${a}` : `${a}-${b}`;
}

/** Exact shape nulls for k-subsets of the live support (ascending, at least k balls). */
export function shapeNull(support: readonly number[], k: number): ShapeNull {
  const L = support.length;
  const total = choose(L, k);
  const maxSum = support[L - 1] * k;
  // Subset-sum dynamic programme: dp[j][s] = number of j-subsets (of the balls seen so far) with sum s.
  const dp = Array.from({ length: k + 1 }, () => new Float64Array(maxSum + 1));
  dp[0][0] = 1;
  for (const n of support) {
    for (let j = k; j >= 1; j--) {
      const row = dp[j];
      const prev = dp[j - 1];
      for (let s = maxSum; s >= n; s--) row[s] += prev[s - n];
    }
  }
  const sumCounts = dp[k];
  // Spread: k-subsets with min support[a] and max support[b] = C(#balls strictly between, k - 2).
  const spreadCounts = new Float64Array(support[L - 1] - support[0] + 1);
  for (let a = 0; a < L; a++) {
    for (let b = a + k - 1; b < L; b++) spreadCounts[support[b] - support[a]] += choose(b - a - 1, k - 2);
  }
  // Odd count: hypergeometric.
  const nOdd = support.filter((n) => n % 2 !== 0).length;
  const oddCounts = new Float64Array(k + 1);
  for (let j = 0; j <= k; j++) oddCounts[j] = choose(nOdd, j) * choose(L - nOdd, k - j);

  const spreadEdges: [number, number] = [firstReaching(spreadCounts, total, 1, 3), firstReaching(spreadCounts, total, 2, 3)];
  const q = V2_CONSTANTS.TYPICAL;
  const sumBand: [number, number] = [
    firstReaching(sumCounts, total, Math.round(q.sumLowQ * 100), 100),
    firstReaching(sumCounts, total, Math.round(q.sumHighQ * 100), 100),
  ];

  const oddBinCounts = [0, 0, 0];
  for (let j = 0; j <= k; j++) oddBinCounts[oddBin(j, k)] += oddCounts[j];
  const spreadBinCounts = [0, 0, 0];
  for (let x = 0; x < spreadCounts.length; x++) {
    if (spreadCounts[x]) spreadBinCounts[spreadBin(x, spreadEdges)] += spreadCounts[x];
  }
  const p0: Record<ShapeFeature, Float64Array> = {
    odd: Float64Array.from(oddBinCounts, (c) => c / total),
    spread: Float64Array.from(spreadBinCounts, (c) => c / total),
  };

  const half = k / 2;
  const lowOdd = Math.ceil(half) - 1;
  const minSpread = k - 1;
  const maxSpread = support[L - 1] - support[0];
  const labels: Record<ShapeFeature, string[]> = {
    odd: [
      `${rangeLabel(0, lowOdd)} odd`,
      Number.isInteger(half) ? `${half} odd` : "none",
      `${rangeLabel(Math.floor(half) + 1, k)} odd`,
    ],
    spread: [
      `spread ${rangeLabel(minSpread, spreadEdges[0])}`,
      `spread ${rangeLabel(spreadEdges[0] + 1, spreadEdges[1])}`,
      `spread ${rangeLabel(spreadEdges[1] + 1, maxSpread)}`,
    ],
  };
  return { support, k, total, sumCounts, spreadCounts, oddCounts, spreadEdges, sumBand, p0, labels };
}

/** Typicality rule R2: odd count in TYPICAL range, sum inside the null band, at most N consecutive pairs. */
export function isTypical(sortedSet: readonly number[], st: ShapeNull): boolean {
  const q = V2_CONSTANTS.TYPICAL;
  let odd = 0;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sortedSet.length; i++) {
    const n = sortedSet[i];
    if (n % 2 !== 0) odd++;
    sum += n;
    if (i > 0 && n - sortedSet[i - 1] === 1) pairs++;
  }
  return (
    odd >= q.oddMin &&
    odd <= q.oddMax &&
    sum >= st.sumBand[0] &&
    sum <= st.sumBand[1] &&
    pairs <= q.maxConsecutivePairs
  );
}

/** Shape nulls (and every archive draw's bins under them) per live-ball signature. */
export class ShapeCache {
  private readonly entries = new Map<string, { st: ShapeNull; drawBins: Uint8Array }>();

  constructor(
    private readonly lo: number,
    private readonly k: number,
    private readonly history: readonly (readonly number[])[],
  ) {}

  /** `live[j] = 1` for live ball lo + j. drawBins[2i] / [2i + 1] = odd / spread bin of archive draw i. */
  get(live: Uint8Array): { st: ShapeNull; drawBins: Uint8Array } {
    const signature = live.join("");
    let entry = this.entries.get(signature);
    if (!entry) {
      const support: number[] = [];
      live.forEach((b, j) => {
        if (b) support.push(this.lo + j);
      });
      const st = shapeNull(support, this.k);
      const drawBins = new Uint8Array(this.history.length * 2);
      this.history.forEach((nums, i) => {
        const b = binsOf(nums, st);
        drawBins[2 * i] = b.odd;
        drawBins[2 * i + 1] = b.spread;
      });
      entry = { st, drawBins };
      this.entries.set(signature, entry);
    }
    return entry;
  }
}
