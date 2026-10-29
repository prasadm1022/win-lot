// SPDX-License-Identifier: Apache-2.0
// Plain-language strings of win-lot-jackpot-v2 (docs/MODEL-V2.md sections 1, 2.12, 2.13, 2.15, 5.4 and 7.5): card
// labels (always the five base labels) and one-line card notes (which say when and why a card is a balanced pick),
// degradation and disclosure notes, the `explanation` texts, the backtest verdicts and wholePercents (a split in
// whole percents that add up to 100). Every text is true for every evidence status and never contradicts the jackpot
// list shown next to it; texts outside the maths view use plain words.
// Copy rules: never "more likely", "better odds", "better chance", "beats", "lucky day", "due"/"overdue", "N times",
// "hot", "guarantee", "accuracy", "jackpot-likeness" or "affinity". Every ticket has the same chance; the strings
// say so and never suggest an edge. No number formatting depends on the locale.

import type { EvidenceSource, SourceSplit } from "../types";
import { CAL_FEATURE_TEXT, V2_CONSTANTS } from "./constants";
import type { Channel } from "./posterior";

export type CardMode = "top" | "source" | "balanced" | "uniform";

// ---------------------------------------------------------------- formatting (locale-free)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-28" -> "28 Oct 2026". */
export function formatDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

/** 1749060 -> "1,749,060". */
export function groupThousands(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const out: string[] = [];
  for (let i = s.length; i > 0; i -= 3) out.unshift(s.slice(Math.max(0, i - 3), i));
  return (n < 0 ? "-" : "") + out.join(",");
}

/** Fixed decimals without a "-0.00". */
export function fixed(x: number, dp: number): string {
  const s = x.toFixed(dp);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

/** Fixed decimals with an explicit sign ("+0.019", "-0.106", "0.000"). */
export function signed(x: number, dp: number): string {
  const s = fixed(x, dp);
  return s.startsWith("-") || Number(s) === 0 ? s : `+${s}`;
}

/** Share 0..1 -> whole percent (one value on its own, e.g. a damping factor; a split uses wholePercents). */
export function percent(share: number): number {
  return Math.round(share * 100);
}

const SPLIT_KEYS: readonly EvidenceSource[] = ["jackpotCombinations", "jackpotDates", "dailyDraws"];

/**
 * Whole percents of a source split that add up to exactly 100 whenever any share is above 0 (largest-remainder
 * method): every source first gets the whole part of its percent, then the points still missing go one each to the
 * largest remainders, ties in the owner's order J, T, D. A source with share 0 (absent, silent or held back) stays at
 * 0; all shares 0 give all 0. The shares are normalised by their sum, so rounded payload shares (r4) work as well.
 * Pure; used by every payload text that prints a split, and by the UI for the same numbers.
 */
export function wholePercents(split: SourceSplit): SourceSplit {
  const share = SPLIT_KEYS.map((key) => (Number.isFinite(split[key]) && split[key] > 0 ? split[key] : 0));
  const total = share[0] + share[1] + share[2];
  if (!(total > 0)) return { jackpotCombinations: 0, jackpotDates: 0, dailyDraws: 0 };
  const exact = share.map((v) => (100 * v) / total);
  // 1e-9 absorbs float noise (e.g. 100 * 0.29 = 28.999999999999996 is 29 whole points, not 28 plus a remainder).
  const whole = exact.map((v) => Math.floor(v + 1e-9));
  const rest = exact.map((v, i) => v - whole[i]);
  const raised = [false, false, false];
  // Each whole part is above its exact value minus 1, so fewer points are missing than sources are present.
  for (let missing = 100 - (whole[0] + whole[1] + whole[2]); missing > 0; missing--) {
    let best = -1;
    for (let i = 0; i < 3; i++) {
      if (share[i] <= 0 || raised[i]) continue;
      if (best < 0 || rest[i] > rest[best] + 1e-9) best = i; // a tie keeps the earlier source (J, T, D)
    }
    if (best < 0) break;
    raised[best] = true;
    whole[best]++;
  }
  return { jackpotCombinations: whole[0], jackpotDates: whole[1], dailyDraws: whole[2] };
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${groupThousands(n)} ${n === 1 ? one : many}`;
}

/** [77, 78, 79, 80, 5] -> "5, 77-80". */
export function numberRanges(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`);
    i = j + 1;
  }
  return out.join(", ");
}

// ---------------------------------------------------------------- cards

export type CardSource = "all" | EvidenceSource | "luckyDip";

/** How a source stands in the number channel: active (moves the picks), absent (nothing known), silent (no
 *  pattern: zero pull) or held (damped to 0 because the source above it shows no pattern). */
export type SourceStateName = "active" | "absent" | "silent" | "held";

const SOURCE_INDEX: Record<EvidenceSource, number> = { jackpotCombinations: 0, jackpotDates: 1, dailyDraws: 2 };
const SOURCE_TEXT = ["jackpot combinations", "jackpot dates", "daily draws"] as const;

/** The five card labels (2.15): always these short labels, unique per lottery. */
export const CARD_LABELS = Object.freeze({
  top: "Top pick",
  jackpotCombinations: "Jackpot pattern",
  jackpotDates: "Jackpot days",
  dailyDraws: "Daily draws",
  luckyDip: "Lucky dip",
});

/** Why a source cannot steer its own card: absent (nothing known), silent (no pattern) or held back (damped to 0). */
export function sourceState(num: Channel, s: number): SourceStateName {
  if (!num.present[s]) return "absent";
  if (!(num.pull[s] > 0)) return "silent";
  return num.damping[s] > 0 ? "active" : "held";
}

/**
 * Card label (2.15): always the short base label, whatever the evidence. Why a card is a balanced pick is said in
 * its note, never in the label (the UI shows the label as the card title and never parses it).
 */
export function cardLabel(source: CardSource): string {
  return source === "all" ? CARD_LABELS.top : CARD_LABELS[source];
}

/**
 * Own jackpot items in the data, usable at this step or not. An absent source with items known but not usable yet
 * (not public long enough before the draw, or undated) says "can be used yet" instead of "known yet", so a note
 * never contradicts the jackpot list shown next to it.
 */
export interface KnownItems {
  /** All own jackpot items, dated or not. */
  wins: number;
  /** Own items with winning numbers. */
  combinations: number;
  /** Own items with a date. */
  dates: number;
}

const NOTHING_KNOWN: KnownItems = Object.freeze({ wins: 0, combinations: 0, dates: 0 });

export interface CardNoteInput {
  status: "combinations" | "dates-only" | "none";
  /** Number-channel state of J, T and D (sourceState). */
  states: readonly [SourceStateName, SourceStateName, SourceStateName];
  /** Own items known in the data (default: none beyond the usable ones). */
  known?: KnownItems;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The order the Top pick keeps (2.11 c), naming only the sources present in the number channel, strongest first
 * ("jackpot dates, then daily draws" without jackpot combinations), like partsOrdered checks it.
 */
function orderText(present: readonly boolean[]): string {
  return [0, 1, 2]
    .filter((s) => present[s])
    .map((s) => SOURCE_TEXT[s])
    .join(", then ");
}

/** Why source s does not move the picks, as a clause ("no jackpot numbers are known yet"). */
function whyNot(s: number, states: CardNoteInput["states"], known: KnownItems = NOTHING_KNOWN): string {
  const state = states[s];
  if (s === 0) {
    if (state === "absent") return known.combinations > 0 ? "no jackpot numbers can be used yet" : "no jackpot numbers are known yet";
    return state === "silent" ? "the jackpot numbers show no pattern yet" : "jackpot combinations are held back";
  }
  if (s === 1) {
    if (state === "absent") return known.dates > 0 ? "no jackpot dates can be used yet" : "no jackpot dates are known yet";
    if (state === "silent") return "the jackpot dates show no calendar pattern yet";
    return "jackpot dates are held back while the jackpot numbers show no pattern";
  }
  if (state === "absent") return "there are no daily draws yet";
  if (state === "silent") return "the daily draws show no pattern yet";
  return states[1] === "silent"
    ? "daily draws are held back while the dates show no pattern"
    : "daily draws are held back while the sources above them show no pattern";
}

/** The Top pick's note: which sources move it, and why any other one does not (true for every evidence status). */
function topNote(x: CardNoteInput): string {
  const known = x.known ?? NOTHING_KNOWN;
  const active = [0, 1, 2].filter((s) => x.states[s] === "active");
  if (active.length === 3) return "All three sources together, jackpot combinations first.";
  if (!active.length) return "No source moves the picks yet, so every ball counts the same.";
  const head =
    active.length === 1 ? `${SOURCE_TEXT[active[0]]} only` : `${SOURCE_TEXT[active[0]]} and ${SOURCE_TEXT[active[1]]} together`;
  const missing = [0, 1, 2].find((s) => x.states[s] !== "active") as number;
  const noWin = known.wins > 0 ? "no jackpot win can be used yet" : "no jackpot win is known yet";
  const why = missing === 0 && x.states[0] === "absent" && x.states[1] === "absent" ? noWin : whyNot(missing, x.states, known);
  return `${capitalise(head)}; ${why}.`;
}

/** The Lucky dip's note: it is uniform over the tickets that pass the pick rules (2.15), not over every ticket. */
export const LUCKY_DIP_NOTE = "A random ticket that follows the same pick rules. It has exactly the same chance as every other card.";

/**
 * The one-line "why" of a card (2.15; kept short for the payload size budget, spec 3.4). A source card whose source
 * cannot move the picks (absent, silent or held back) is a balanced pick, and its note says why in one sentence.
 */
export function cardNote(source: CardSource, mode: CardMode, x: CardNoteInput): string {
  if (source === "luckyDip") return LUCKY_DIP_NOTE;
  if (source === "all") return topNote(x);
  const s = SOURCE_INDEX[source];
  if (mode === "balanced" && x.states[s] !== "active") {
    const why = capitalise(whyNot(s, x.states, x.known));
    return `${why}, so this card is a balanced pick${x.states[s] === "held" ? "" : " from all the evidence"}.`;
  }
  if (mode === "balanced") return "A balanced pick from all the evidence.";
  switch (source) {
    case "jackpotCombinations":
      return "Follows the tens, odd/even mix, spread and letter of past jackpots.";
    case "jackpotDates":
      return "Follows the draws held on calendar days similar to past jackpot dates.";
    case "dailyDraws":
      return "What the daily draws alone point to.";
  }
}

// ---------------------------------------------------------------- notes

export interface NotesInput {
  name: string;
  status: "combinations" | "dates-only" | "none";
  /** Own items in the data, usable yet or not. */
  known: KnownItems;
  /** Usable dates, and how many of them are older than the draw archive. */
  datesUsed: number;
  datesOlderThanArchive: number;
  /** T present but silent in the number channel (no calendar pattern), so daily draws are held at 0 too. */
  datesSilent: boolean;
  /** The Top pick's letter, and the letters of the usable own combinations. */
  topLetter: string | null;
  jackpotLetters: string[];
  /** The lottery has a bonus that is not modelled (Dhana Nidhanaya Sunday Bonus digits). */
  unmodelledBonus: string | null;
  /** Sources present in the number channel (J, T, D): the order note names only these. */
  present: readonly [boolean, boolean, boolean];
  orderHeld: boolean;
  /** How many of the highest-lean numbers the Top pick was chosen among (CAND, unless the fallback was needed). */
  orderSearched: number;
  pending: { drawNo: number; date: string | null; knownFrom: string | null }[];
  excludedBalls: number[];
  deadRun: number;
  regimeSince: string;
  backtestDraws: number;
}

/** Plain-language degradation and disclosure notes (2.12, 2.13). */
export function predictionNotes(x: NotesInput): string[] {
  const notes: string[] = [];
  if (x.status === "none") {
    notes.push(
      x.known.wins > 0
        ? `${x.name} has no jackpot win the picks can use yet, so the jackpot weights cannot apply. Picks use daily draws only.`
        : `No jackpot win is known for ${x.name} yet, so the jackpot weights cannot apply. Picks use daily draws only.`,
    );
  } else if (x.status === "dates-only") {
    // Counted like the jackpot list next to it: dated wins only (an undated win is listed there on its own).
    const n = x.datesUsed;
    const one = n === 1;
    notes.push(
      x.datesOlderThanArchive === n && x.known.dates === n
        ? `${x.name}'s ${plural(n, "dated jackpot win")} ${one ? "is" : "are"} older than our draw archive, so ${one ? "its" : "their"} numbers are unknown. Only ${one ? "its date is" : "their dates are"} used.`
        : `${x.name}'s ${plural(n, "usable jackpot win")} ${one ? "has" : "have"} no known winning numbers. Only ${one ? "its date is" : "their dates are"} used.`,
    );
  }
  if (x.datesSilent) {
    notes.push(
      "The jackpot dates show no calendar pattern yet, so they add nothing. Daily draws may never outweigh the dates, so they are held back too.",
    );
  }
  if (x.status === "combinations" && x.topLetter !== null && x.jackpotLetters.includes(x.topLetter)) {
    notes.push(
      "While jackpot combinations are known, the Top pick's letter is always the letter of a past jackpot. Letters are drawn separately from the numbers, so this repeats no combination.",
    );
  }
  if (x.unmodelledBonus) notes.push(`${x.unmodelledBonus} digits are not predicted.`);
  if (!x.orderHeld) {
    // The Top pick is defined over the highest-lean numbers only (2.15), so the claim is about them, not every ticket.
    // The order is over the sources present (orderHeld is always true with fewer than two), as explanation.sets says.
    notes.push(
      `Among the ${x.orderSearched} highest-lean numbers, no ticket that follows the pick rules keeps the order ${orderText(x.present)}, so the Top pick is the best of them without that order.`,
    );
  }
  for (const p of x.pending) {
    const when = p.date ? ` (${formatDate(p.date)})` : "";
    notes.push(
      p.knownFrom
        ? `The jackpot won at draw #${p.drawNo}${when} counts from ${formatDate(p.knownFrom)}.`
        : `The jackpot inferred at draw #${p.drawNo}${when} counts once draw #${p.drawNo + 2} is published.`,
    );
  }
  if (x.excludedBalls.length) {
    notes.push(
      `${x.excludedBalls.length === 1 ? "Ball" : "Balls"} ${numberRanges(x.excludedBalls)} ${x.excludedBalls.length === 1 ? "has" : "have"} not come out for over ${x.deadRun} draws and ${x.excludedBalls.length === 1 ? "is" : "are"} treated as no longer in use; the picks use the draws since ${formatDate(x.regimeSince)}.`,
    );
  }
  if (x.backtestDraws === 0) notes.push("There are too few draws to replay the picks against past results yet.");
  return notes;
}

// ---------------------------------------------------------------- explanation

export interface ExplanationInput {
  name: string;
  status: "combinations" | "dates-only" | "none";
  /** Number-channel influence as in the payload (influence.numbers, r4), so the printed split equals the UI's. */
  share: SourceSplit;
  /** Number-channel damping and state per source (J, T, D). */
  damping: [number, number, number];
  state: [SourceStateName, SourceStateName, SourceStateName];
  /** Own items in the data, usable yet or not, and how many of them are older than the draw archive. */
  known: KnownItems;
  winsOlderThanArchive: number;
  combinationsUsed: number;
  datesUsed: number;
  /** The calendar fit as in the payload (evidence.calendar): strength (kappa), peak label and Holm-adjusted p. */
  calendar: { feature: string; strength: number; peak: string; holmP: number }[] | null;
  dailyUsed: number;
  dailySince: string;
  excludedAsJackpot: number;
  guard: { perCombination: number; union: number };
  /** Sources present in the number channel (J, T, D) and whether the Top pick's parts keep their order. */
  present: [boolean, boolean, boolean];
  orderHeld: boolean;
  odds: OddsInput;
  backtest: string;
}

/** The headline split in whole percents that add up to 100, e.g. "Jackpot combinations 54% · Jackpot dates 26% · Daily draws 20%". */
export function splitText(split: SourceSplit): string {
  const p = wholePercents(split);
  return `Jackpot combinations ${p.jackpotCombinations}% · Jackpot dates ${p.jackpotDates}% · Daily draws ${p.dailyDraws}%`;
}

export interface OddsInput {
  numbers: number;
  numbersAndLetter: number | null;
  /** Balls in use when some configured balls are out of use (the odds are counted on them), else null. */
  inUse: number | null;
}

/** Odds line (7.3): identical for every card. It names the balls in use when the odds are not counted on the full range. */
export function oddsText(odds: OddsInput): string {
  const extra = [
    ...(odds.inUse !== null ? [`${odds.inUse} balls in use`] : []),
    ...(odds.numbersAndLetter !== null ? [`1 in ${groupThousands(odds.numbersAndLetter)} with the letter`] : []),
  ];
  return `Every ticket has the same chance: 1 in ${groupThousands(odds.numbers)} for the four numbers${extra.length ? ` (${extra.join("; ")})` : ""}.`;
}

// ---------------------------------------------------------------- backtest judgement (5.4)

/** Two-sided 5% cut of a z-score: the same cut as the 95% range, so the texts and the range always agree. */
export const Z95 = 1.96;

/** How a lottery's hit result stands: inside the 95% range of luck, or outside it, and then whether it stays outside
 *  after allowing for the checks made for this lottery (Holm at 5%). */
export interface HitJudgement {
  /** The payload's backtestDetail.ci95 (r4): avg - random +/- 1.96 SE. */
  ci95: [number, number];
  /** Number of checks made for this lottery (its Holm family) and whether the hit check survives Holm in it. */
  tests: number;
  survives: boolean;
}

function outsideRange(ci95: readonly [number, number]): boolean {
  return ci95[0] > 0 || ci95[1] < 0;
}

/** One sentence on the hit result: "the same as random" exactly when the 95% range contains 0. */
function judgementText(j: HitJudgement, range: string): string {
  if (!outsideRange(j.ci95)) return `That is the same as random; the difference is luck${range}.`;
  if (j.survives) {
    return (
      `That stays outside the usual range of luck even after allowing for the ${plural(j.tests, "check")} made for this lottery${range}. ` +
      "Lottery draws are random, so it is most likely a rare fluke or a fault in the data or the method, not a way to win."
    );
  }
  if (j.tests > 1) {
    return (
      `That is outside the usual range of luck for one check${range}, but ${j.tests} checks are made for this lottery, and a ` +
      "result like this turns up by luck now and then; allowing for that, it is within luck."
    );
  }
  return `That is outside the usual range of luck${range}, but lottery draws are random, so it is still most likely luck.`;
}

/** Short backtest line for `explanation.backtest` (the full verdict is in backtestDetail.text). */
export function backtestSummary(draws: number, avg: number, base: number, judgement: HitJudgement): string {
  return (
    `Replayed over the last ${draws} draws, using only what was known before each draw: ${fixed(avg, 3)} numbers per draw; ` +
    `a random ticket matches ${fixed(base, 3)}. ${judgementText(judgement, "")}`
  );
}

/**
 * The `explanation` texts (plain language, kept compact for the payload size budget). Every text is true for every
 * evidence status and source state: it names only the sources that move the picks, and an absent source's text never
 * repeats the "0%" the page already shows next to it.
 */
export function explanationTexts(x: ExplanationInput): {
  summary: string;
  weights: string;
  combinations: string;
  dates: string;
  daily: string;
  sets: string;
  backtest: string;
  odds: string;
  limits: string;
} {
  const C = V2_CONSTANTS;
  const [sJ, sT, sD] = x.state;
  const active = [0, 1, 2].filter((s) => x.state[s] === "active");
  const today = `Share of the pull on the numbers today: ${splitText(x.share)}.`;
  let summary: string;
  if (x.status === "none") {
    const lead = x.known.wins > 0 ? `${x.name} has no jackpot win the picks can use yet` : `No jackpot win is known for ${x.name} yet`;
    summary =
      sD === "active"
        ? `${lead}, so all balls start equal and only the daily draws move the picks.`
        : `${lead}, and the daily draws show no pattern yet, so every ball counts the same.`;
  } else if (!active.length) {
    summary = "All balls start equal, and no source moves the picks yet, so every ball counts the same.";
  } else if (active.length === 3) {
    summary = `All balls start equal; three kinds of evidence then move the picks, strongest first. ${today}`;
  } else if (active.length === 2) {
    summary = `All balls start equal; ${SOURCE_TEXT[active[0]]} and ${SOURCE_TEXT[active[1]]} then move the picks, strongest first. ${today}`;
  } else {
    summary = `All balls start equal; only the ${SOURCE_TEXT[active[0]]} move the picks. ${today}`;
  }

  const extra: string[] = [];
  if (sT === "active" && x.damping[1] < 1) extra.push("Jackpot dates are turned down so they never outweigh the combinations.");
  if (sT === "held") extra.push(`${capitalise(whyNot(1, x.state, x.known))}.`);
  if (sD === "active" && x.damping[2] < 1) {
    extra.push(`Daily draws are turned down so they never outweigh the ${sT === "absent" ? "combinations" : "dates"}.`);
  }
  if (sD === "held") extra.push(`${capitalise(whyNot(2, x.state, x.known))}.`);
  if (x.status !== "none" && sJ === "absent") {
    extra.push(`Jackpot combinations: 0% - ${x.known.combinations > 0 ? "none can be used yet" : "none known yet"}.`);
  }
  const weights =
    `A jackpot combination counts like ${C.W_J} draws, a jackpot date like ${C.W_T}, a daily draw like ${C.W_D}.` +
    (extra.length ? ` ${extra.join(" ")}` : "");

  let combinations: string;
  if (x.combinationsUsed > 0) {
    const its = x.combinationsUsed === 1 ? "its" : "their";
    combinations =
      `${plural(x.combinationsUsed, "jackpot combination")}, used only through ${its} tens, odd/even mix, spread and letter, ` +
      `never ${its} exact numbers. The pattern also counts ${C.J_PRIOR} imaginary average jackpots, so one jackpot cannot ` +
      "swing it on its own." +
      (sJ === "silent" ? " No pattern yet, so they add nothing." : "");
  } else if (x.known.combinations > 0) {
    combinations = "No jackpot-winning numbers can be used yet.";
  } else if (x.known.wins > 0 && x.winsOlderThanArchive === x.known.wins) {
    combinations = "The known jackpot wins are older than our draw archive, so their numbers are unknown.";
  } else {
    combinations = "No jackpot-winning numbers are known yet.";
  }

  let dates = x.known.dates > 0 ? "No jackpot dates can be used yet." : "No jackpot dates are known yet.";
  if (x.datesUsed > 0) {
    const fit = x.calendar ?? [];
    const features = fit.map((f) => `${(CAL_FEATURE_TEXT as Record<string, string>)[f.feature] ?? f.feature}: ${f.peak}`).join("; ");
    // A peak is presented as an effect only when some feature stays clear after Holm over the features (2.7 a).
    const clear = fit.some((f) => f.holmP < 0.05);
    const tail =
      sT === "active"
        ? clear
          ? "Most likely a ticket-sales effect; the balls do not know the date."
          : `None of these is clear after allowing for the ${fit.length} checks, so they may well be chance; if real, ` +
            "it would most likely be a ticket-sales effect. The balls do not know the date."
        : sT === "held"
          ? "They are held back while the jackpot numbers show no pattern, so they add nothing yet."
          : "No calendar pattern yet, so they add nothing.";
    dates = `${plural(x.datesUsed, "jackpot date")}. Calendar peaks - ${features}. ${tail}`;
  }

  const without = x.excludedAsJackpot ? `, without the ${plural(x.excludedAsJackpot, "jackpot draw")}` : "";
  const tail =
    sD === "held"
      ? ", held back for now"
      : sD === "active" && x.damping[2] < 1
        ? `, turned down to ${percent(x.damping[2])}% of their pull`
        : "";
  const daily = `${plural(x.dailyUsed, "daily draw")} since ${formatDate(x.dailySince)}${without}${tail}.`;

  const balanced = x.state.some((s) => s !== "active");
  const rules =
    x.combinationsUsed > 0
      ? `No two cards share more than ${C.SET_OVERLAP} numbers. Each card shares at most ${plural(x.guard.perCombination, "number")} ` +
        `with any one past jackpot and at most ${x.guard.union} with all of them, and no card repeats a past result.`
      : `No two cards share more than ${C.SET_OVERLAP} numbers, and no card repeats a past result.`;
  // The Top pick keeps the order of the sources present in the number channel (2.11 c) whenever orderHeld is true.
  const keeping = x.orderHeld && x.present.filter(Boolean).length > 1 ? `, keeping the order ${orderText(x.present)}` : "";
  const sets =
    `Top pick: the ticket that follows all the evidence most closely${keeping}. Jackpot pattern, Jackpot days and Daily draws: ` +
    "each the ticket that follows its own source most closely" +
    (balanced
      ? " (while that source cannot move the picks, a balanced pick from all the evidence that differs clearly from the cards before it)"
      : "") +
    `. Lucky dip: a random ticket that follows the same pick rules. ${rules}`;

  const limits = "No method can foresee a random draw. Jackpot data describes the players, not the machine. For fun only.";

  return { summary, weights, combinations, dates, daily, sets, backtest: x.backtest, odds: oddsText(x.odds), limits };
}

// ---------------------------------------------------------------- backtest texts (5.4)

export interface VerdictInput {
  name: string;
  draws: number;
  avg: number;
  base: number;
  v1: number;
  judgement: HitJudgement;
}

/**
 * Per-lottery verdict (5.4); the pooled sentence is appended by pooledSentence() once all lotteries are known. It says
 * "the same as random" exactly when the 95% range of the difference contains 0; otherwise it says how the result
 * stands after allowing for the checks made for this lottery.
 */
export function verdictText(x: VerdictInput): string {
  const [lo, hi] = x.judgement.ci95;
  return (
    `Over the last ${x.draws} ${x.name} draws, using only what was known before each draw, the Top pick matched ${fixed(x.avg, 3)} numbers per draw. ` +
    `A random ticket matches ${fixed(x.base, 3)}, and the previous model matched ${fixed(x.v1, 3)}. ` +
    judgementText(x.judgement, ` (95% range ${signed(lo, 3)} to ${signed(hi, 3)})`)
  );
}

export function pooledSentence(lotteries: number, draws: number, avg: number, base: number): string {
  return `Across all ${lotteries} lotteries (${groupThousands(draws)} draws): ${fixed(avg, 4)} vs ${fixed(base, 4)}.`;
}

/**
 * Power sentence (5.4): mdeShare is the effect that survives Holm over the lottery's `checks` 4 times in 5 (80% power
 * at the first Holm cut, backtest.ts mdeSE), so the verdict then says it stays outside the usual range of luck.
 */
export function powerText(draws: number, mdeShare: number, checks: number): string {
  return (
    `With ${draws} draws, only an effect of about +${percent(mdeShare)}% or more would show up reliably in this test ` +
    `(in 4 cases out of 5), after allowing for the ${plural(checks, "check")} made for this lottery.`
  );
}

/** The checks of one lottery's Holm family (backtest.ts lotteryZs), in plain words for the Holm note. */
export const CHECK_TEXT = Object.freeze({
  hits: "The check of the Top pick's hits",
  previousModel: "The check against the previous model",
  rank: "The check of how the drawn numbers rank",
  jackpotNumbers: "The check of how often past jackpot numbers come up",
  jackpotCombinations: "The check of the jackpot-combinations lean",
  jackpotDates: "The check of the jackpot-dates lean",
  dailyDraws: "The check of the daily-draws lean",
});

export type CheckName = keyof typeof CHECK_TEXT;

export interface HolmNoteInput {
  /** The check with the largest |z| of this lottery (shown when |z| > Z95, the cut of the 95% range). */
  check: CheckName;
  /** Checks made for this lottery, and whether that check stays unusual after Holm over them. */
  tests: number;
  survives: boolean;
  /** Checks made over all lotteries of the site (known once all are computed), else null. */
  siteChecks: number | null;
}

/**
 * Holm note (5.4): names the most unusual check of this lottery and says how it stands after allowing for the checks
 * made for this lottery. When it stays unusual it says so plainly, without any claim beyond the numbers.
 */
export function holmText(x: HolmNoteInput): string {
  const check = CHECK_TEXT[x.check];
  if (x.survives) {
    return (
      `${check} stays unusual even after allowing for the ${plural(x.tests, "check")} made for this lottery. ` +
      "Lottery draws are random, so it is most likely a rare fluke or a fault in the data or the method, not a way to win."
    );
  }
  // Under fair draws each check lands outside its 95% range 1 time in 20, so the expected count is checks / 20.
  const expected = x.siteChecks === null ? 0 : Math.round(x.siteChecks / 20);
  return (
    `${check} looks unusual on its own, but after allowing for the ${plural(x.tests, "check")} made for this lottery it is within luck.` +
    (x.siteChecks !== null && expected >= 1
      ? ` Across all ${x.siteChecks} checks on this site, about ${plural(expected, "result")} like this ${expected === 1 ? "is" : "are"} expected by luck alone.`
      : "")
  );
}

export function copyTiltText(avg: number, random: number, perCombination: number): string {
  return (
    `The Top pick held on average ${fixed(avg, 2)} numbers from past jackpots; a random ticket holds ${fixed(random, 2)}. ` +
    "The model leans toward the tens where jackpot numbers fell" +
    (perCombination === 1 ? ", and never repeats two numbers of the same jackpot." : ".")
  );
}
