// SPDX-License-Identifier: Apache-2.0
// win-lot-jackpot-v2: jackpot-weighted picks (docs/MODEL-V2.md). Public API used by lib/data.ts at build time.
//
//   predictV2(input)        one lottery (backtestDetail.pooled / holmAll are null)
//   predictAllV2(inputs)    all lotteries; attaches the pooled backtest, the Holm correction over the headline hit
//                           z's and the pooled verdict sentence to each prediction
//
// Both throw if the per-draw v1 trace does not reproduce v1's own backtest average (the paired comparison would be
// wrong). Lottery draws are random; every ticket has the same chance. This is a transparent pattern summary of the
// owner's evidence, not a forecast.

import type { Jackpot } from "../jackpots";
import type { Lottery } from "../lotteries";
import { DISCLAIMER, nextDrawDate, r4 } from "../model";
import type { Draw } from "../parsers";
import type { Prediction, PredictionEvidence, PredictionSet, SourceLean, SourceSplit } from "../types";
import { peakLabel } from "./calendar";
import { MODEL_VERSION_V2, V2_CONSTANTS, methodText } from "./constants";
import { evidenceCounts, pendingItems, usedItems } from "./evidence";
import {
  backtestSummary,
  cardNote,
  explanationTexts,
  pooledSentence,
  predictionNotes,
  sourceState,
  type CardNoteInput,
  type KnownItems,
} from "./explain";
import {
  backtestDetail,
  hitZ,
  holmNote,
  holmSummary,
  holmView,
  poolRuns,
  pooledDetail,
  walkForward,
  type BacktestRun,
  type HolmView,
} from "./backtest";
import {
  buildContext,
  leanOf,
  patternLean,
  posteriorAt,
  type Channel,
  type ModelContext,
  type Posterior,
  type Triple,
} from "./posterior";
import {
  cardsAt,
  maxSharedWithOne,
  partsOrdered,
  pastJackpotNumbers,
  setParts,
  setScore,
  streamAt,
  topPickAt,
  type Card,
  type TopPick,
} from "./sets";
import { choose } from "./shape";
import { v1TopPickHits } from "./v1trace";

export { MODEL_VERSION_V2, V2_CONSTANTS, methodText } from "./constants";
export { knownFrom, usableAt, addDays, ownItems, evidenceAt, dailyPool, pendingItems, usedItems } from "./evidence";
export type { OwnItem, EvidenceAt, DatedDraw } from "./evidence";
export { deadRun, regimeAt } from "./regime";
export { fitCalendar, calendarAngles, calendarWeight, moonPhase, a1inv, rayleighP, holmAdjust, declusterWeights, peakLabel } from "./calendar";
export { shapeNull, isTypical, binsOf, choose } from "./shape";
export {
  buildContext,
  posteriorAt,
  assembleChannel,
  leanOf,
  sourceLeanOf,
  sourceActive,
  patternLean,
  decadeOf,
  ticketKey,
  SOURCE_NAMES,
} from "./posterior";
export {
  hyperTail,
  guardExcluded,
  guardRung,
  streamAt,
  topPickAt,
  cardsAt,
  setParts,
  partsOrdered,
  setScore,
  pastJackpotNumbers,
  maxSharedWithOne,
} from "./sets";
export {
  walkForward,
  backtestDetail,
  backtestStart,
  normalP,
  holmSummary,
  holmView,
  holmNote,
  hitZ,
  jackpotNumbersCheckZ,
  sourceCheckZ,
  lotteryChecks,
  pairedStats,
  poolRuns,
  pooledDetail,
  zForP,
  holmFirstCut,
  mdeSE,
  Z_POWER,
  CHECK_MIN_STEPS,
  LIFT_MIN_EXPECTED,
} from "./backtest";
export { v1TopPickHits } from "./v1trace";
export {
  cardLabel,
  cardNote,
  sourceState,
  wholePercents,
  splitText,
  oddsText,
  verdictText,
  holmText,
  backtestSummary,
  CARD_LABELS,
  CHECK_TEXT,
  LUCKY_DIP_NOTE,
  Z95,
} from "./explain";
export type { CardNoteInput, CardSource, CheckName, HitJudgement, KnownItems, SourceStateName } from "./explain";
export type { Regime } from "./regime";
export type { ShapeNull } from "./shape";
export type { CalendarFit, FeatureFit } from "./calendar";
export type { ModelContext, Posterior, Channel, Triple } from "./posterior";
export type { TopPick, Card, Stream, GuardRung } from "./sets";
export type { BacktestRun, HolmView, StepRecord } from "./backtest";

export interface V2Input {
  /** lib/lotteries.ts config, as passed to v1 predict(). */
  lottery: Lottery;
  /** Oldest first (lib/parsers.ts shape). */
  draws: Draw[];
  /** The whole data/jackpots.json; the lottery's own items are selected inside. */
  jackpots: Jackpot[];
  generatedAt: string;
  /** v1 predict() for the same draws. */
  v1: Prediction;
}

function split(values: Triple<number>): SourceSplit {
  return { jackpotCombinations: r4(values[0]), jackpotDates: r4(values[1]), dailyDraws: r4(values[2]) };
}

function leans<T>(ch: Channel, n: number, key: (x: number) => T): (T & SourceLean)[] {
  const out: (T & SourceLean)[] = [];
  for (let x = 0; x < n; x++) {
    if (ch.p0[x] <= 0) continue;
    out.push({
      ...key(x),
      lean: r4(leanOf(ch, x)),
      j: r4(ch.parts[0][x]),
      t: r4(ch.parts[1][x]),
      d: r4(ch.parts[2][x]),
    });
  }
  return out;
}

interface LotteryResult {
  prediction: Prediction;
  run: BacktestRun;
  v1Hits: number[];
  /** The backtest texts' view of the Holm family (null without a backtest). */
  view: HolmView | null;
}

/** The v1 trace must reproduce v1's own backtest average exactly (spec 2.18 item 8). */
function assertV1Trace(id: string, v1Hits: readonly number[], v1: Prediction): void {
  const n = v1Hits.length;
  const mean = n ? r4(v1Hits.reduce((s, h) => s + h, 0) / n) : 0;
  if (n !== v1.backtest.draws || mean !== v1.backtest.avgHits) {
    throw new Error(
      `model-v2: v1 trace for ${id} gives ${n} draws / ${mean} hits, but v1 backtest() reports ` +
        `${v1.backtest.draws} / ${v1.backtest.avgHits}; the paired comparison would be wrong`,
    );
  }
}

function buildSet(ctx: ModelContext, post: Posterior, card: Card, top: TopPick, noteInput: CardNoteInput): PredictionSet {
  const parts = setParts(post, card.numbers, ctx.lo);
  return {
    label: card.label,
    letter: card.letter,
    numbers: card.numbers,
    bonus: card.bonus,
    score: r4(setScore(post, card.numbers, ctx.lo)),
    source: card.source,
    parts: split(parts),
    orderHeld: card.mode === "top" ? top.orderHeld : partsOrdered(parts, post.num.present),
    pastJackpotNumbers: pastJackpotNumbers(card.numbers, post),
    maxSharedWithOneJackpot: maxSharedWithOne(card.numbers, post),
    note: cardNote(card.source, card.mode, noteInput),
  };
}

function numberScores(ctx: ModelContext, post: Posterior): { n: number; score: number }[] {
  const { theta } = post.num;
  const live = post.regime.live;
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < ctx.M; j++) {
    if (!live[j]) continue;
    if (theta[j] < min) min = theta[j];
    if (theta[j] > max) max = theta[j];
  }
  return Array.from({ length: ctx.M }, (_, j) => ({
    n: ctx.lo + j,
    score: live[j] ? r4(max > min ? (theta[j] - min) / (max - min) : 0.5) : 0,
  }));
}

function computeLottery(input: V2Input): LotteryResult {
  const { lottery, draws, jackpots, generatedAt, v1 } = input;
  if (!draws.length) throw new Error(`model-v2: no draws for lottery: ${lottery.id}`);
  const ctx = buildContext(lottery, draws, jackpots);
  const N = draws.length;
  const { k, lo } = ctx;
  const tau = nextDrawDate(ctx.dates);

  // Production: the same code path as every backtest step, at t = N.
  const post = posteriorAt(ctx, N, tau);
  const stream = streamAt(ctx, post);
  const past = new Set<number>();
  for (const key of ctx.keys) if (key >= 0) past.add(key);
  const top = topPickAt(ctx, post, stream, past);
  const cards = cardsAt(ctx, post, stream, past, top);

  // Walk-forward and the paired v1 trace.
  const run = walkForward(ctx);
  const v1Hits = v1TopPickHits(ctx.history, ctx.lo, ctx.hi, k);
  assertV1Trace(ctx.id, v1Hits, v1);

  const L = post.regime.count;
  const regimeStart = post.regime.start;
  const ev = post.evidence;
  const status: PredictionEvidence["status"] = ev.combinations.length ? "combinations" : ev.dates.length ? "dates-only" : "none";
  const archiveStart = ctx.dates[0] ?? null;
  const counts = evidenceCounts(
    ctx.items,
    ev,
    archiveStart,
    { clusters: post.calendar?.clusters ?? 0, effective: r4(post.calendar?.nEff ?? 0) },
    {
      used: post.pool.length,
      total: N - regimeStart,
      since: ctx.dates[regimeStart],
      excludedAsJackpot: post.excludedAsJackpot,
    },
  );
  const calendar = post.calendar
    ? post.calendar.features.map((f) => ({
        feature: f.feature,
        strength: r4(f.kappa),
        peak: peakLabel(f),
        rayleighP: r4(f.rayleighP),
        holmP: r4(f.holmP),
      }))
    : null;
  const num = post.num;
  const states = [0, 1, 2].map((s) => sourceState(num, s)) as Triple<ReturnType<typeof sourceState>>;
  // Own items in the data, usable yet or not: the texts never contradict the jackpot list shown next to them.
  const known: KnownItems = {
    wins: ctx.items.length,
    combinations: counts.jackpotCombinations.known,
    dates: counts.jackpotDates.known,
  };
  const winsOlderThanArchive = ctx.items.filter((it) => it.index < 0 && it.drawNo < ctx.drawNos[0]).length;
  const ticketCount = choose(L, k);
  const U = post.letters.length;
  const odds = {
    numbers: ticketCount,
    numbersAndLetter: U ? ticketCount * U : null,
    basis: `${L} numbers in use${U ? `, ${U} letters` : ""}`,
  };

  const detail = run.draws ? backtestDetail(run, v1Hits, ctx.name, post.guard) : undefined;
  const view = run.draws ? holmView(run, v1Hits) : null;
  const honestBaseline = run.draws ? r4(run.sumExpected / run.draws) : r4((k * k) / L);
  const backtestText = view
    ? backtestSummary(run.draws, run.sumHits / run.draws, run.sumExpected / run.draws, view.judgement)
    : "There are too few draws to replay the picks against past results yet.";

  const evidence: PredictionEvidence = {
    status,
    asOf: tau,
    counts,
    mass: split([num.mass[0] / k, num.mass[1] / k, num.mass[2] / k]),
    used: usedItems(ev),
    pending: pendingItems(ctx.items, tau),
    calendar,
    calendarEss: post.calendarEss === null ? null : r4(post.calendarEss),
    guard: {
      perCombination: post.guard.perCombination,
      union: post.guard.union,
      excludedShare: r4(post.guard.excludedShare),
    },
  };

  const unmodelledBonus = lottery.has_bonus && !post.bonus ? lottery.bonus_label ?? "Bonus" : null;
  const notes = predictionNotes({
    name: ctx.name,
    status,
    known,
    datesUsed: ev.dates.length,
    datesOlderThanArchive: counts.jackpotDates.olderThanArchive,
    datesSilent: states[1] === "silent",
    topLetter: top.letter,
    jackpotLetters: ev.combinations.map((c) => c.letter).filter((l): l is string => l !== null),
    unmodelledBonus,
    present: [...num.present],
    orderHeld: top.orderHeld,
    orderSearched: top.searched,
    pending: evidence.pending,
    excludedBalls: post.regime.excluded,
    deadRun: ctx.R,
    regimeSince: ctx.dates[regimeStart],
    backtestDraws: run.draws,
  });

  const explanation = explanationTexts({
    name: ctx.name,
    status,
    share: split(num.share), // = influence.numbers
    damping: num.damping,
    state: states,
    known,
    winsOlderThanArchive,
    combinationsUsed: ev.combinations.length,
    datesUsed: ev.dates.length,
    calendar,
    dailyUsed: post.pool.length,
    dailySince: ctx.dates[regimeStart],
    excludedAsJackpot: post.excludedAsJackpot,
    guard: post.guard,
    present: [...num.present],
    orderHeld: top.orderHeld,
    // The odds are counted on the balls in use: say so whenever that is not the configured range (header "1-80").
    odds: { ...odds, inUse: post.regime.excluded.length ? L : null },
    backtest: backtestText,
  });

  const C = V2_CONSTANTS;
  const prediction: Prediction = {
    lotteryId: ctx.id,
    generatedAt,
    basedOnDraws: N,
    nextDrawDate: tau,
    nextDrawNo: ctx.drawNos[N - 1] + 1,
    sets: cards.map((card) => buildSet(ctx, post, card, top, { status, states, known })),
    numberScores: numberScores(ctx, post),
    method: methodText(),
    disclaimer: DISCLAIMER,
    backtest: {
      draws: run.draws,
      avgHits: run.draws ? r4(run.sumHits / run.draws) : 0,
      randomBaseline: honestBaseline,
    },
    modelVersion: MODEL_VERSION_V2,
    evidence,
    weights: {
      jackpotCombination: C.W_J,
      jackpotDate: C.W_T,
      dailyDraw: C.W_D,
      orderRatio: C.ORDER,
      maxLean: C.MAX_LIFT,
      jackpotPrior: C.J_PRIOR,
    },
    influence: {
      numbers: split(num.share),
      letters: post.letter ? split(post.letter.share) : null,
      bonus: post.bonus ? split(post.bonus.share) : null,
      odd: split(post.odd.share),
      spread: split(post.spread.share),
    },
    damping: {
      numbers: split(num.damping),
      letters: post.letter ? split(post.letter.damping) : null,
      bonus: post.bonus ? split(post.bonus.damping) : null,
    },
    patternLean: r4(patternLean(post)),
    numberLean: leans(num, ctx.M, (j) => ({ n: lo + j })),
    letterLean: post.letter ? leans(post.letter, U, (i) => ({ letter: post.letters[i] })) : null,
    bonusLean: post.bonus ? leans(post.bonus, post.bonusCount, (i) => ({ n: post.bonusMin + i })) : null,
    shapeLean: (["odd", "spread"] as const).map((feature) => ({
      feature,
      bins: post.shape.labels[feature]
        .map((label, b) => ({ label, b }))
        .filter(({ b }) => post[feature].p0[b] > 0)
        .map(({ label, b }) => ({ label, lean: r4(leanOf(post[feature], b)) })),
    })),
    liveBalls: { count: L, excluded: [...post.regime.excluded], since: ctx.dates[regimeStart] },
    odds,
    ...(detail ? { backtestDetail: detail } : {}),
    previousModel: {
      modelVersion: v1.modelVersion,
      sets: v1.sets.map((s) => ({ ...s, numbers: [...s.numbers] })),
      backtest: { ...v1.backtest },
      honestRandomBaseline: honestBaseline,
    },
    explanation,
    notes,
  };
  return { prediction, run, v1Hits, view };
}

/** v2 prediction for one lottery. `backtestDetail.pooled` and `holmAll` are null (see predictAllV2). */
export function predictV2(input: V2Input): Prediction {
  return computeLottery(input).prediction;
}

/**
 * v2 predictions for all lotteries, keyed by lottery id in input order. Each backtestDetail gets the pooled result
 * over all lotteries (the headline), the Holm correction over the headline hit z's, the pooled verdict sentence and,
 * in its Holm note, the number of checks made over the whole site.
 */
export function predictAllV2(inputs: V2Input[]): Record<string, Prediction> {
  const ids = inputs.map((i) => i.lottery.id);
  if (new Set(ids).size !== ids.length) throw new Error("model-v2: duplicate lottery ids in predictAllV2 input");
  const results = inputs.map(computeLottery);
  const tested = results.filter((r) => r.run.draws > 0);
  const pooledSums = poolRuns(tested);
  const holmAll = holmSummary(tested.map((r) => hitZ(r.run)));
  // The pooled result is judged in the family of the headline hit checks (holmAll), so its power is taken there too.
  const pooled = pooledSums.draws ? pooledDetail(pooledSums, holmAll.tests) : null;
  const siteChecks = tested.reduce((n, r) => n + (r.view?.tests ?? 0), 0);
  const out: Record<string, Prediction> = {};
  for (const r of results) {
    const p = r.prediction;
    const detail = p.backtestDetail;
    if (detail && pooled) {
      detail.pooled = pooledDetail(pooledSums, holmAll.tests).pooled; // a fresh object per lottery (no shared references)
      detail.holmAll = { tests: holmAll.tests, minP: r4(holmAll.minP), anySignificant: holmAll.anySignificant };
      detail.power.pooledMdeShare = r4(pooled.mdeShare);
      if (r.view) detail.text.holm = holmNote(r.view, siteChecks);
      detail.text.verdict = `${detail.text.verdict} ${pooledSentence(pooledSums.lotteries, pooledSums.draws, pooled.avg, pooled.base)}`;
      if (p.explanation) {
        p.explanation.backtest = `${p.explanation.backtest} ${pooledSentence(pooledSums.lotteries, pooledSums.draws, pooled.avg, pooled.base)}`;
      }
    }
    out[p.lotteryId] = p;
  }
  return out;
}
