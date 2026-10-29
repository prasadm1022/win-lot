// SPDX-License-Identifier: Apache-2.0
// win-lot-jackpot-v2 constants (docs/MODEL-V2.md section 2.2): frozen owner policy, fixed before any evaluation.
// Never tune them on backtest results. Changing a value is a deliberate model change: bump MODEL_VERSION_V2 or record
// it in docs/MODEL-V2.md Appendix B, then regenerate test/fixtures/model-v2-golden.json. MODEL_VERSION_V2 is part of
// the stream seed (spec 2.16), so bumping it also changes every tie key, the Top picks and the backtests.

export const MODEL_VERSION_V2 = "win-lot-jackpot-v2";

export const V2_CONSTANTS = Object.freeze({
  /** Pseudo-draw weight per item: jackpot-winning combination, jackpot-winning date, daily draw (owner order J > T > D). */
  W_J: 12,
  W_T: 4,
  W_D: 1,
  /** A lower source may pull at most ORDER times as hard as the source above it (per channel). */
  ORDER: 0.75,
  /** Fair-balls prior, in draws, per channel (raised automatically by MAX_LIFT). */
  PRIOR: 50,
  /** No category's lean leaves [2 - MAX_LIFT, MAX_LIFT]. A modesty bound, not an odds statement. */
  MAX_LIFT: 1.25,
  /** "Perfectly average" pseudo-jackpots added to every jackpot-pattern estimate (Dirichlet prior). */
  J_PRIOR: 2,
  /** Calendar features for jackpot dates, chosen a priori (Poya, paydays, weekly cycle). */
  CAL_FEATURES: Object.freeze(["moonPhase", "dayOfMonth", "weekday"] as const),
  KAPPA_MAX: 2,
  /** Jackpot dates within this many days share one calendar position in the calendar fit. */
  DECLUSTER_DAYS: 7,
  /** Mean synodic month (days) and a new-moon epoch; moon phase is evaluated at 12:00 UTC of the draw date. */
  SYNODIC: 29.530588853,
  MOON_EPOCH: "2000-01-06T18:14:00Z",
  /** An NLB prize-table jackpot is treated as known from the day after its draw (PM decision D1). */
  PRIZE_TABLE_LAG_DAYS: 1,
  /** The copy guards may never exclude more than this share of all tickets. */
  GUARD_ALPHA: 0.05,
  /** (max shared with any one own jackpot combination, max from their union), strictest first. */
  GUARD_LADDER: Object.freeze([
    Object.freeze([1, 2] as const),
    Object.freeze([1, 3] as const),
    Object.freeze([2, 3] as const),
    Object.freeze([2, 4] as const),
    Object.freeze([3, 4] as const),
  ]),
  /** The Top pick is chosen among the 4-subsets of the CAND highest-lean live numbers. */
  CAND: 24,
  /** Lucky dip sampling: SIR uniform candidates per round, at most SIR_ROUNDS rounds (the other cards are deterministic). */
  SIR: 64,
  SIR_ROUNDS: 4,
  /** Any two cards share at most SET_OVERLAP numbers. */
  SET_OVERLAP: 2,
  /** A balanced card (its source does not move the picks) shares at most this many numbers with every card selected
   *  before it, so it is a clearly different alternative (falls back to SET_OVERLAP if no ticket passes). */
  BALANCED_OVERLAP: 1,
  /** Typicality (presentation only): odd count range, sum band quantiles of the exact null, max consecutive pairs. */
  TYPICAL: Object.freeze({ oddMin: 1, oddMax: 3, sumLowQ: 0.1, sumHighQ: 0.9, maxConsecutivePairs: 1 }),
  /** A live ball goes R draws unseen with probability at most DEAD_P (R = 270 for 1..80, 277 for 1..82). */
  DEAD_P: 1e-6,
  /** Backtest window, same as v1: start = max(BT_MIN, N - BT_DRAWS), stride 1. */
  BT_DRAWS: 200,
  BT_MIN: 30,
});

export type V2Constants = typeof V2_CONSTANTS;

/** Plain-language names of the calendar features, in V2_CONSTANTS.CAL_FEATURES order. */
export const CAL_FEATURE_TEXT: Readonly<Record<V2Constants["CAL_FEATURES"][number], string>> = Object.freeze({
  moonPhase: "moon phase",
  dayOfMonth: "day of month",
  weekday: "weekday",
});

/**
 * The `method` text of every v2 prediction (docs/MODEL-V2.md section 3.3). Generated from V2_CONSTANTS, so the text
 * can never drift from the constants actually used.
 */
export function methodText(): string {
  const c = V2_CONSTANTS;
  const features = c.CAL_FEATURES.map((f) => CAL_FEATURE_TEXT[f]).join(", ");
  return (
    "Fair-balls prior over the balls in use, plus three evidence sources in the owner's order. " +
    `A jackpot-winning combination counts as ${c.W_J} draws, acting only through its decades, odd/even mix, spread ` +
    `and letter, with ${c.J_PRIOR} average pseudo-jackpots added. ` +
    `A jackpot-winning date counts as ${c.W_T} draws, through draws held on calendar-similar days (${features}; ` +
    "fitted on this lottery's own dates; contrast with ordinary days). " +
    `A daily draw counts as ${c.W_D}. ` +
    `Each lower source is damped to at most ${Math.round(c.ORDER * 100)}% of the pull of the source above it, ` +
    `and no number's lean leaves ${2 - c.MAX_LIFT}-${c.MAX_LIFT}. ` +
    "Cards follow copy, typicality and diversity rules. " +
    `Walk-forward backtest over the last ${c.BT_DRAWS} draws, or fewer so that each replayed draw has at least ` +
    `${c.BT_MIN} earlier draws, using only evidence known before each draw.`
  );
}
