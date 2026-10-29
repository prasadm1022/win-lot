// SPDX-License-Identifier: Apache-2.0
// Copy rules of win-lot-jackpot-v2 (docs/MODEL-V2.md sections 5.4, 6 and 7.5): no odds language in any payload
// string, the v1 disclaimer verbatim, and one odds statement that is identical for every set. Payloads: the live data/
// (rule-based checks only), the frozen snapshot of 2026-10-27 of the golden fixture (the states and texts of that day:
// DLB without a jackpot, Mega Power dates only) and synthetic payloads that reach the other text templates (silent
// dates, a clear calendar pattern, pending jackpots, a DLB reset waiting for draw K + 2, too few draws for a backtest,
// a first jackpot with too few draws to judge its checks, 100 combinations). Every verdict, Holm note, power sentence
// and dates text agrees with the numbers next to it, and the README and the built pages use none of the forbidden
// words either (out/ is skipped while it is missing; REQUIRE_BUILT_PAGES=1, as in CI after `npm run build`, requires it).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERY_BY_ID, type Lottery } from "../lib/lotteries";
import { DISCLAIMER, mulberry32, predict } from "../lib/model";
import {
  CHECK_MIN_STEPS,
  CHECK_TEXT,
  LUCKY_DIP_NOTE,
  Z95,
  addDays,
  backtestSummary,
  holmText,
  mdeSE,
  predictAllV2,
  predictV2,
  verdictText,
  type CheckName,
} from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import type { Prediction } from "../lib/types";
import { loadDraws, loadJackpots, loadV2Inputs, syntheticCombinations, v2Input, withOwnItems } from "../scripts/model-v2-data";
import { binom, stringsIn } from "./helpers/v2-rules";

const TIMEOUT = 120_000;
const GENERATED_AT = "2026-10-28T00:00:00Z";
const ROOT = join(__dirname, "..");

/** The frozen data snapshot of the golden fixture (the data of 2026-10-27). */
const FROZEN = (
  JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "model-v2-golden.json"), "utf8")) as {
    snapshot: { lotteries: { lottery: Lottery; generatedAt: string; draws: Draw[] }[]; jackpots: Jackpot[] };
  }
).snapshot;

/** Spec section 6: forbidden in every payload string (v1's own strings included). */
const FORBIDDEN_EVERYWHERE: [string, RegExp][] = [
  ["more likely", /more likely/i],
  ["better odds", /better odds/i],
  ["better chance", /better chance/i],
  ["beats", /\bbeat(s|ing)?\b/i],
  ["lucky day", /lucky day/i],
  ["x times / N times / Nx", /\b(?:\d+(?:\.\d+)?|x|n)\s*(?:times\b|×)|\b\d+(?:\.\d+)?x(?![a-z0-9])/i],
  ["guarantee", /guarante/i],
];

/** Spec 7.5 "Never use", the words that apply to v2 copy only (v1's labels appear only under "Previous model (v1)"). */
const FORBIDDEN_IN_V2_COPY: [string, RegExp][] = [
  ["due", /\bdue\b/i],
  ["overdue", /overdue/i],
  ["N× more", /\d\s*[x×]\s*more/i],
  ["hot", /\bhot\b/i],
  ["accuracy", /accura/i],
  ["jackpot-likeness", /jackpot[- ]?like/i],
  ["affinity", /affinit/i],
];

/**
 * Spec 7.5 "Never use", for visitor-facing text outside the payload (README.md, the built pages). Plain counts such
 * as "won 3 times" or "drawn together 12 times" are facts the pages show on purpose, so only multiplying claims
 * ("3x more", "2 times as likely") are caught, not every "N times" (the payload check above is stricter).
 */
const NEVER_USE: [string, RegExp][] = [
  ...FORBIDDEN_EVERYWHERE.filter(([name]) => !name.startsWith("x times")),
  ...FORBIDDEN_IN_V2_COPY,
  ["N times more / as likely", /\b(?:\d+(?:\.\d+)?|n|x)\s*(?:[x×]|times)\s*(?:more|as likely|the chance|the odds)\b/i],
];

/** Spec 5.4: the verdict (and every backtest and explanation text) never contains "beats", "better", "edge" or "more likely". */
const FORBIDDEN_IN_VERDICTS: [string, RegExp][] = [
  ["better", /\bbetter\b/i],
  ["edge", /\bedge\b/i],
];

function textViolations(path: string, value: string, v1: boolean): string[] {
  const out: string[] = [];
  for (const [name, re] of FORBIDDEN_EVERYWHERE) if (re.test(value)) out.push(`${path}: "${name}" in "${value}"`);
  if (v1) return out;
  for (const [name, re] of FORBIDDEN_IN_V2_COPY) if (re.test(value)) out.push(`${path}: "${name}" in "${value}"`);
  if (/^\$\.(backtestDetail\.text|explanation)\./.test(path)) {
    for (const [name, re] of FORBIDDEN_IN_VERDICTS) if (re.test(value)) out.push(`${path}: "${name}" in "${value}"`);
  }
  return out;
}

function violations(p: Prediction): string[] {
  return stringsIn(p).flatMap(({ path, value }) => textViolations(path, value, path.startsWith("$.previousModel")));
}

const SYNTH: Lottery = {
  id: "copy-synth",
  name: "Copy Synth",
  board: "NLB",
  source_url: "",
  source_key: "copy-synth",
  letter_kind: "letter",
  main_count: 4,
  main_min: 1,
  main_max: 80,
  has_bonus: 0,
  bonus_label: null,
  bonus_min: null,
  bonus_max: null,
};

function synthDraws(n: number, seed: number): Draw[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => {
    const s = new Set<number>();
    while (s.size < 4) s.add(1 + Math.floor(rng() * 80));
    return {
      draw_no: 700 + i,
      draw_date: addDays("2025-05-01", i),
      letter: String.fromCharCode(65 + Math.floor(rng() * 26)),
      numbers: [...s],
      bonus: null,
    };
  });
}

function jackpot(lottery: Lottery, d: Draw, source: Jackpot["source"], withNumbers: boolean): Jackpot {
  return {
    lotteryId: lottery.id,
    drawNo: d.draw_no,
    date: d.draw_date,
    letter: withNumbers ? d.letter : null,
    numbers: withNumbers ? [...d.numbers].sort((a, b) => a - b) : null,
    bonus: null,
    jackpotWinners: source === "dlb-jackpot-reset" ? null : 1,
    superPrizeAmount: null,
    source,
    inDrawHistory: true,
  };
}

const payloads: { name: string; p: Prediction; v1: Prediction }[] = [];

/** A payload by name ("frozen: mega-power", "synthetic: ..."); throws when missing. */
function payload(name: string): Prediction {
  const hit = payloads.find((x) => x.name === name);
  if (!hit) throw new Error(`no payload ${name}`);
  return hit.p;
}

beforeAll(() => {
  const inputs = loadV2Inputs();
  const all = predictAllV2(inputs);
  for (const input of inputs) payloads.push({ name: input.lottery.id, p: all[input.lottery.id], v1: input.v1 });
  // The frozen snapshot of 2026-10-27: the states (and texts) of that day, whatever data/ holds now.
  const frozenInputs = FROZEN.lotteries.map((l) => v2Input(l.lottery, l.draws, FROZEN.jackpots, l.generatedAt));
  const frozen = predictAllV2(frozenInputs);
  for (const input of frozenInputs) payloads.push({ name: `frozen: ${input.lottery.id}`, p: frozen[input.lottery.id], v1: input.v1 });

  const add = (name: string, lottery: Lottery, draws: Draw[], jackpots: Jackpot[]) => {
    const input = v2Input(lottery, draws, jackpots, GENERATED_AT);
    payloads.push({ name, p: predictV2(input), v1: input.v1 });
  };
  const draws = synthDraws(160, 3);
  const N = draws.length;
  // Silent dates (strict chain), a prize-table jackpot on the last draw (pending, known from tomorrow) and a DLB
  // reset on the draw before it (pending until draw K + 2 is published).
  const spread = Array.from({ length: 10 }, (_, q) => ({
    ...jackpot(SYNTH, draws[0], "nlb-winners-directory", false),
    drawNo: 100 + q,
    date: addDays("2024-01-01", 9 * q),
    inDrawHistory: false,
    listedIn: [addDays("2024-01-01", 9 * q).slice(0, 7)],
  }));
  add("synthetic: silent dates and pending jackpots", SYNTH, draws, [
    ...spread,
    jackpot(SYNTH, draws[N - 1], "nlb-prize-table", true),
    jackpot(SYNTH, draws[N - 2], "dlb-jackpot-reset", true),
  ]);
  add("synthetic: one combination", SYNTH, draws, [jackpot(SYNTH, draws[50], "nlb-prize-table", true)]);
  // A first jackpot usable on the last 2 draws only, each sharing one of its numbers: too few test draws to judge its
  // checks (5.2), so none of them is formed, counted or named (the normal p of 2 shared numbers would be 0.008).
  const first = draws.slice();
  const won = first[N - 4];
  for (const [t, n] of [
    [N - 2, won.numbers[0]],
    [N - 1, won.numbers[1]],
  ]) {
    first[t] = { ...first[t], numbers: [n, ...first[t].numbers.filter((x) => !won.numbers.includes(x)).slice(0, 3)] };
  }
  add("synthetic: a first jackpot on the last draws (too few to judge its checks)", SYNTH, first, [jackpot(SYNTH, won, "nlb-prize-table", true)]);
  add("synthetic: too few draws", SYNTH, draws.slice(0, 20), []);
  // The only jackpot was won on the last draw: known, but not usable before tomorrow (status none, "can be used yet").
  add("synthetic: a pending jackpot only", SYNTH, draws, [jackpot(SYNTH, draws[N - 1], "nlb-prize-table", true)]);
  // Nine wins on consecutive Fridays (2024-03-01 is a Friday): a weekday pattern that stays clear after Holm.
  const fridays = Array.from({ length: 9 }, (_, q) => ({
    ...jackpot(SYNTH, draws[0], "nlb-winners-directory", false),
    drawNo: 300 + q,
    date: addDays("2024-03-01", 7 * q),
    inDrawHistory: false,
    listedIn: [addDays("2024-03-01", 7 * q).slice(0, 7)],
  }));
  add("synthetic: weekly jackpot dates (a clear calendar pattern)", SYNTH, draws, fridays);
  // A biased machine: 20 balls of mixed parity come out 7 times in 10. The daily draws find them, so the Top pick hits far
  // above chance and its checks survive Holm: the texts must say so plainly (a fault in the data), never celebrate.
  const favoured = [3, 7, 10, 14, 18, 22, 25, 29, 33, 37, 41, 45, 50, 54, 58, 62, 66, 70, 74, 78];
  const brng = mulberry32(77);
  const biased: Draw[] = Array.from({ length: 260 }, (_, i) => {
    const s = new Set<number>();
    while (s.size < 4) s.add(brng() < 0.7 ? favoured[Math.floor(brng() * favoured.length)] : 1 + Math.floor(brng() * 80));
    return { draw_no: 900 + i, draw_date: addDays("2025-02-01", i), letter: String.fromCharCode(65 + Math.floor(brng() * 26)), numbers: [...s], bonus: null };
  });
  add("synthetic: a biased machine (checks that survive Holm)", { ...SYNTH, id: "biased-synth", name: "Biased Synth", source_key: "biased-synth" }, biased, []);
  const dhana = LOTTERY_BY_ID["dhana-nidhanaya"];
  const dDraws = loadDraws(dhana.id);
  add("synthetic: Dhana Nidhanaya with 100 combinations", dhana, dDraws, withOwnItems(loadJackpots(), dhana.id, syntheticCombinations(dhana, dDraws, 100, 1)));
}, TIMEOUT);

describe("copy rules", () => {
  it("no forbidden phrase in any payload string (real data and synthetic templates)", () => {
    expect(payloads.length).toBe(20);
    const bad = payloads.flatMap(({ name, p }) => violations(p).map((v) => `${name} ${v}`));
    expect(bad).toEqual([]);
  });

  it("the synthetic payloads reach the degradation and pending templates", () => {
    const notes = payloads.flatMap(({ p }) => p.notes ?? []);
    expect(notes.some((n) => n.startsWith("The jackpot dates show no calendar pattern yet"))).toBe(true);
    expect(notes.some((n) => /counts from \d+ [A-Z][a-z]{2} \d{4}\.$/.test(n))).toBe(true); // pending, known from a date
    expect(notes.some((n) => /counts once draw #\d+ is published\.$/.test(n))).toBe(true); // DLB reset waiting for K + 2
    expect(notes.some((n) => n === "There are too few draws to replay the picks against past results yet.")).toBe(true);
    expect(notes.some((n) => n.startsWith("No jackpot win is known for"))).toBe(true);
    expect(notes.some((n) => n.includes("dated jackpot wins are older than our draw archive"))).toBe(true);
    expect(notes.some((n) => n.includes("has no jackpot win the picks can use yet"))).toBe(true);
    expect(notes.some((n) => n.includes("treated as no longer in use"))).toBe(true);
  });

  it("counts agree with the jackpot list: the dates-only note counts the dated wins (Mega Power 9 of its 11, 2 undated)", () => {
    const mega = payload("frozen: mega-power");
    const c = mega.evidence!.counts.jackpotDates;
    expect(c.used + c.undated).toBe(11);
    expect(mega.notes).toContain(
      `Mega Power's ${c.used} dated jackpot wins are older than our draw archive, so their numbers are unknown. Only their dates are used.`,
    );
    expect(mega.explanation!.combinations).toBe("The known jackpot wins are older than our draw archive, so their numbers are unknown.");
  });

  it("every explanation text holds for its evidence status; main-panel texts use plain words; splits add up to 100", () => {
    const moves = (p: Prediction) => {
      const n = p.influence!.numbers;
      return [n.jackpotCombinations, n.jackpotDates, n.dailyDraws].filter((v) => v > 0).length;
    };
    for (const { name, p } of payloads) {
      const x = p.explanation!;
      // An absent source never repeats the "0%" the page shows next to its text.
      for (const text of [x.combinations, x.dates, x.daily]) expect(text, name).not.toMatch(/: 0%\.?$/);
      // "Fair balls" is maths-view jargon (the method text keeps it); the main panel says "All balls start equal".
      const mainPanel = [x.summary, x.combinations, x.dates, x.daily, ...(p.notes ?? []), ...p.sets.map((s) => s.note ?? "")];
      for (const text of mainPanel) expect(text, name).not.toMatch(/fair[- ]balls|pseudo-jackpot/i);
      // "Three kinds of evidence" only when all three sources move the picks.
      expect(x.summary.includes("three kinds"), `${name}: ${x.summary}`).toBe(moves(p) === 3);
      // A printed split is in whole percents that add up to exactly 100.
      const split = /Jackpot combinations (\d+)% · Jackpot dates (\d+)% · Daily draws (\d+)%/.exec(x.summary);
      if (split) expect(Number(split[1]) + Number(split[2]) + Number(split[3]), name).toBe(100);
      else expect(moves(p) === 0 || p.evidence!.status === "none", `${name}: ${x.summary}`).toBe(true);
    }
    const texts = new Set(payloads.flatMap(({ p }) => [p.explanation!.summary.replace(/ Share of the pull on the numbers today: .*$/, ""), p.explanation!.combinations, p.explanation!.dates]));
    for (const text of [
      "All balls start equal; three kinds of evidence then move the picks, strongest first.",
      "All balls start equal; jackpot dates and daily draws then move the picks, strongest first.",
      "All balls start equal; only the jackpot combinations move the picks.",
      "All balls start equal, and no source moves the picks yet, so every ball counts the same.",
      "No jackpot win is known for Ada Kotipathi yet, so all balls start equal and only the daily draws move the picks.",
      "Copy Synth has no jackpot win the picks can use yet, so all balls start equal and only the daily draws move the picks.",
      "No jackpot-winning numbers are known yet.",
      "No jackpot-winning numbers can be used yet.",
      "The known jackpot wins are older than our draw archive, so their numbers are unknown.",
      "No jackpot dates are known yet.",
      "No jackpot dates can be used yet.",
    ]) {
      expect(texts.has(text), text).toBe(true);
    }
  });

  it("card labels never carry a reason; the card notes reach every evidence state in one plain sentence", () => {
    const labels = ["Top pick", "Jackpot pattern", "Jackpot days", "Daily draws", "Lucky dip"];
    for (const { name, p } of payloads) expect(p.sets.map((s) => s.label), name).toEqual(labels);
    const notes = new Set(payloads.flatMap(({ p }) => p.sets.map((s) => s.note ?? "")));
    for (const note of [
      "All three sources together, jackpot combinations first.",
      "Jackpot dates and daily draws together; no jackpot numbers are known yet.",
      "Daily draws only; no jackpot win is known yet.",
      "Jackpot combinations only; the jackpot dates show no calendar pattern yet.",
      "No source moves the picks yet, so every ball counts the same.",
      "No jackpot numbers are known yet, so this card is a balanced pick from all the evidence.",
      "No jackpot dates are known yet, so this card is a balanced pick from all the evidence.",
      "The jackpot dates show no calendar pattern yet, so this card is a balanced pick from all the evidence.",
      "Daily draws are held back while the dates show no pattern, so this card is a balanced pick.",
      // Known but not usable yet (a jackpot won on the last draw counts from the next day).
      "Daily draws only; no jackpot win can be used yet.",
      "No jackpot numbers can be used yet, so this card is a balanced pick from all the evidence.",
      "No jackpot dates can be used yet, so this card is a balanced pick from all the evidence.",
    ]) {
      expect(notes.has(note), note).toBe(true);
    }
    // The old "All three sources together." claim was false without jackpot numbers; it must not come back.
    expect(notes.has("All three sources together.")).toBe(false);
  });

  it("the forbidden-phrase scan is not vacuous", () => {
    const probe = { ...payloads[0].p, notes: ["This pick is more likely to win.", "3x the chance", "Hot numbers are due."] };
    expect(violations(probe).length).toBeGreaterThanOrEqual(4);
    // v1's own labels are only scanned for the words forbidden everywhere.
    expect(payloads[0].p.previousModel!.sets.map((s) => s.label)).toContain("Hot streak");
  });

  const AUDIT = join(__dirname, "..", "docs", "MODEL-V2-AUDIT.md");
  it.skipIf(!existsSync(AUDIT))("the generated audit (docs/MODEL-V2-AUDIT.md) uses no odds language either", () => {
    const bad: string[] = [];
    readFileSync(AUDIT, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const [name, re] of [...FORBIDDEN_EVERYWHERE, ...FORBIDDEN_IN_V2_COPY]) if (re.test(line)) bad.push(`line ${i + 1}: "${name}"`);
      });
    expect(bad).toEqual([]);
  });

  it("the method text is the spec's (section 3.3), verbatim", () => {
    const spec =
      "Fair-balls prior over the balls in use, plus three evidence sources in the owner's order. A jackpot-winning " +
      "combination counts as 12 draws, acting only through its decades, odd/even mix, spread and letter, with 2 average " +
      "pseudo-jackpots added. A jackpot-winning date counts as 4 draws, through draws held on calendar-similar days (moon " +
      "phase, day of month, weekday; fitted on this lottery's own dates; contrast with ordinary days). A daily draw counts " +
      "as 1. Each lower source is damped to at most 75% of the pull of the source above it, and no number's lean leaves " +
      "0.75-1.25. Cards follow copy, typicality and diversity rules. Walk-forward backtest over the last 200 draws, or " +
      "fewer so that each replayed draw has at least 30 earlier draws, using only evidence known before each draw.";
    for (const { p } of payloads) expect(p.method).toBe(spec);
  });

  it("the disclaimer is v1's, verbatim", () => {
    for (const { p, v1 } of payloads) {
      expect(p.disclaimer).toBe(DISCLAIMER);
      expect(p.disclaimer).toBe(v1.disclaimer);
    }
    expect(predict(LOTTERY_BY_ID["govisetha"], loadDraws("govisetha"), GENERATED_AT).disclaimer).toBe(DISCLAIMER);
  });

  it("the odds are one statement, identical for every set: C(L, 4) tickets (x |U| with the letter)", () => {
    const setKeys = ["label", "letter", "numbers", "bonus", "score", "source", "parts", "orderHeld", "pastJackpotNumbers", "maxSharedWithOneJackpot", "note"];
    for (const { name, p } of payloads) {
      const L = p.liveBalls!.count;
      const letters = new Set(p.letterLean?.map((x) => x.letter) ?? []).size;
      expect(p.odds!.numbers, name).toBe(binom(L, 4));
      expect(p.odds!.numbersAndLetter, name).toBe(letters ? binom(L, 4) * letters : null);
      const group = (n: number) => String(n).replace(/\B(?=(\d{3})+$)/g, ",");
      // Counted on the balls in use; the line says so whenever balls of the configured range are out of use (the page
      // header still shows the whole range, e.g. "1-80" for Ada Kotipathi, which uses 1-76).
      const extra = [
        ...(p.liveBalls!.excluded.length ? [`${L} balls in use`] : []),
        ...(p.odds!.numbersAndLetter ? [`1 in ${group(p.odds!.numbersAndLetter)} with the letter`] : []),
      ];
      expect(p.explanation!.odds, name).toBe(
        `Every ticket has the same chance: 1 in ${group(p.odds!.numbers)} for the four numbers` + (extra.length ? ` (${extra.join("; ")}).` : "."),
      );
      for (const s of p.sets) {
        // No per-set chance of any kind, and every set is a ticket on the same live balls.
        expect(Object.keys(s).every((k) => setKeys.includes(k)), `${name} ${s.label}`).toBe(true);
        expect(s.numbers.every((n) => !p.liveBalls!.excluded.includes(n))).toBe(true);
      }
    }
    const lucky = payloads[0].p.sets[4];
    expect(lucky.label).toBe("Lucky dip");
    expect(lucky.note).toBe("A random ticket that follows the same pick rules. It has exactly the same chance as every other card.");
    expect(LUCKY_DIP_NOTE).toBe(lucky.note);
  });

  it('every verdict says "the same as random" exactly when its 95% range contains 0, and explanation.backtest agrees', () => {
    let outside = 0;
    for (const { name, p } of payloads) {
      const d = p.backtestDetail;
      if (!d) continue;
      const inside = d.ci95[0] <= 0 && d.ci95[1] >= 0;
      if (!inside) outside++;
      const same = "That is the same as random; the difference is luck";
      expect(d.text.verdict.includes(same), `${name}: ${d.text.verdict}`).toBe(inside);
      expect(p.explanation!.backtest.includes(same), `${name}: ${p.explanation!.backtest}`).toBe(inside);
      // The range printed in the verdict is the payload's ci95, so the two can never disagree.
      const sign = (x: number) => (/^-?0\.000$/.test(x.toFixed(3)) ? "0.000" : (x > 0 ? "+" : "") + x.toFixed(3));
      expect(d.text.verdict, name).toContain(`(95% range ${sign(d.ci95[0])} to ${sign(d.ci95[1])})`);
      if (!inside) expect(d.text.verdict, name).toMatch(/outside the usual range of luck/);
    }
    expect(outside).toBeGreaterThan(0); // the biased machine (and on 2026-10-27 Super Ball: +0.001 to +0.119, z +1.98)
    const biased = payload("synthetic: a biased machine (checks that survive Holm)").backtestDetail!;
    expect(biased.ci95[0]).toBeGreaterThan(0);
    expect(biased.text.verdict).toMatch(/stays outside the usual range of luck even after allowing for the \d+ checks made for this lottery/);
  });

  it("a Holm note exists exactly when some reported check lands outside its 95% range (|z| > 1.96), and names the most unusual one", () => {
    let notes = 0;
    for (const { name, p } of payloads) {
      const d = p.backtestDetail;
      if (!d) continue;
      const checks: [CheckName, number][] = [
        ["hits", d.z],
        ["previousModel", d.v1.pairedZ],
        ...(d.draws > d.outOfDomain ? ([["rank", d.rank.z]] as [CheckName, number][]) : []),
        ...(d.lifts.jackpotNumbersZ !== null ? ([["jackpotNumbers", d.lifts.jackpotNumbersZ]] as [CheckName, number][]) : []),
        ...(Object.entries(d.lifts.sourceZ) as [CheckName, number][]),
      ];
      // The lottery's Holm family is exactly the reported checks, and a check with fewer than 30 test draws behind it is
      // neither reported nor counted (5.2): the jackpot-number check needs 30 draws with a usable combination.
      expect(d.holm.tests, name).toBe(checks.length);
      if (!d.copyTilt || d.copyTilt.steps < CHECK_MIN_STEPS) expect(d.lifts.jackpotNumbersZ, name).toBeNull();
      const top = checks.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
      if (Math.abs(Math.abs(top[1]) - Z95) < 1e-4) continue; // r4 payload values: too close to the cut to tell
      expect(d.text.holm !== null, `${name}: max |z| ${top[1]}`).toBe(Math.abs(top[1]) > Z95);
      if (d.text.holm === null) continue;
      notes++;
      expect(d.text.holm.startsWith(CHECK_TEXT[top[0]]), `${name}: ${d.text.holm}`).toBe(true);
      expect(d.text.holm, name).toContain(`after allowing for the ${d.holm.tests} checks made for this lottery`);
      expect(d.text.holm.includes("stays unusual"), name).toBe(d.holm.anySignificant);
      // The site-wide clause only where all lotteries are known (predictAllV2) and the check does not stay unusual: the
      // expected count is checks / 20.
      if (d.holmAll && !d.holm.anySignificant) {
        expect(d.text.holm, name).toMatch(/Across all \d+ checks on this site, about \d+ results? like this (is|are) expected by luck alone\.$/);
      }
    }
    expect(notes).toBeGreaterThan(0); // the biased machine (and on 2026-10-27 Ada Kotipathi, z +2.04, and Super Ball, z +1.98)
    const biased = payload("synthetic: a biased machine (checks that survive Holm)").backtestDetail!;
    expect(biased.holm.anySignificant).toBe(true);
    expect(biased.text.holm).toMatch(
      /stays unusual even after allowing for the \d+ checks made for this lottery\. Lottery draws are random, so it is most likely a rare fluke or a fault in the data or the method, not a way to win\.$/,
    );
    // The old note claimed that with 4 checks an unusual result "is expected", which is false (about 1 in 6 by luck).
    expect(payloads.some(({ p }) => /at least one unusual result is expected/.test(p.backtestDetail?.text.holm ?? ""))).toBe(false);
    // Not vacuous: a jackpot usable on 2 test draws, both sharing one of its numbers. Its checks are not formed yet, so
    // the payload never says that such a check "stays unusual" (formed, it would have: p 0.008 among 6 checks).
    const early = payload("synthetic: a first jackpot on the last draws (too few to judge its checks)").backtestDetail!;
    expect(early.copyTilt!.steps).toBe(2);
    expect([early.lifts.jackpotNumbersZ, early.lifts.sourceZ.jackpotCombinations, early.holm.anySignificant]).toEqual([null, undefined, false]);
  });

  it("the power sentence names this lottery's checks and the effect that survives Holm over them 4 times in 5 (5.4)", () => {
    let pooledSeen = 0;
    for (const { name, p } of payloads) {
      const d = p.backtestDetail;
      if (!d) continue;
      // The verdict says a hit result stays outside the usual range of luck only when it survives Holm over the lottery's
      // checks, so the promised effect is taken at the first Holm cut over them, not at the 95% range's 1.96.
      expect(d.text.power, name).toBe(
        `With ${d.draws} draws, only an effect of about +${Math.round(d.power.mdeShare * 100)}% or more would show up reliably ` +
          `in this test (in 4 cases out of 5), after allowing for the ${d.holm.tests} checks made for this lottery.`,
      );
      // mdeShare = mdeSE(m) SE / random, with SE read back from the printed 95% range (r4 values: 0.2% slack).
      const se = (d.ci95[1] - d.ci95[0]) / (2 * Z95);
      expect(Math.abs(d.power.mdeShare - (mdeSE(d.holm.tests) * se) / d.random.avgHits), name).toBeLessThan(0.002);
      if (d.pooled && d.holmAll) {
        pooledSeen++;
        // The pooled result is judged among the headline hit checks of all lotteries (holmAll), so its power too.
        const pse = (d.pooled.random.hi - d.pooled.random.lo) / (2 * Z95);
        expect(Math.abs(d.power.pooledMdeShare! - (mdeSE(d.holmAll.tests) * pse) / d.pooled.random.avgHits), name).toBeLessThan(0.002);
      } else {
        expect(d.power.pooledMdeShare, name).toBeNull();
      }
    }
    expect(pooledSeen).toBeGreaterThan(0);
  });

  it("the dates text calls the calendar peaks chance unless some feature stays clear after Holm; both cases are reached", () => {
    const seen = { clear: 0, chance: 0 };
    for (const { name, p } of payloads) {
      const cal = p.evidence!.calendar;
      if (!cal || !(p.influence!.numbers.jackpotDates > 0)) continue;
      const clear = cal.some((f) => f.holmP < 0.05);
      seen[clear ? "clear" : "chance"]++;
      const text = p.explanation!.dates;
      expect(text.includes("may well be chance"), `${name}: ${text}`).toBe(!clear);
      expect(text.includes("Most likely a ticket-sales effect"), `${name}: ${text}`).toBe(clear);
      expect(text, name).toMatch(/the balls do not know the date\.$/i);
    }
    expect(seen.clear).toBeGreaterThan(0); // the weekly synthetic dates
    expect(seen.chance).toBeGreaterThan(0); // Dhana Nidhanaya, Mega Power and Govisetha on 2026-10-27
  });

  it("every branch of the verdict and Holm templates follows the copy rules", () => {
    const texts: string[] = [];
    const ranges: [number, number][] = [
      [-0.02, 0.1],
      [0.001, 0.12],
      [-0.12, -0.001],
    ];
    const families: [number, boolean][] = [
      [1, false],
      [4, false],
      [4, true],
    ];
    for (const ci95 of ranges) {
      for (const [tests, survives] of families) {
        const judgement = { ci95, tests, survives };
        texts.push(verdictText({ name: "Test Lotto", draws: 200, avg: 0.25, base: 0.2, v1: 0.2, judgement }));
        texts.push(backtestSummary(200, 0.25, 0.2, judgement));
      }
    }
    for (const check of Object.keys(CHECK_TEXT) as CheckName[]) {
      for (const survives of [false, true]) for (const siteChecks of [null, 9, 35]) texts.push(holmText({ check, tests: 5, survives, siteChecks }));
    }
    const bad = texts.flatMap((t, i) => textViolations(`$.backtestDetail.text.template[${i}]`, t, false));
    expect(bad).toEqual([]);
    // Only a range that contains 0 is "the same as random".
    expect(texts.filter((t) => t.includes("the same as random")).length).toBe(2 * families.length);
    // A result that stays unusual is said plainly, without celebrating it and without promising a follow-up.
    expect(holmText({ check: "hits", tests: 4, survives: true, siteChecks: 35 })).toBe(
      "The check of the Top pick's hits stays unusual even after allowing for the 4 checks made for this lottery. Lottery " +
        "draws are random, so it is most likely a rare fluke or a fault in the data or the method, not a way to win.",
    );
    expect(texts.some((t) => /being looked at/.test(t))).toBe(false);
  });

  it("README.md (the visitors' overview) uses none of the forbidden words", () => {
    const bad: string[] = [];
    readFileSync(join(ROOT, "README.md"), "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const [name, re] of NEVER_USE) if (re.test(line)) bad.push(`README.md:${i + 1}: "${name}" in "${line}"`);
      });
    expect(bad).toEqual([]);
  });

  const OUT = join(ROOT, "out");
  // out/ exists only after `npm run build`, so a plain `npm test` skips this check when it is missing. CI runs this file
  // again after the build with REQUIRE_BUILT_PAGES=1 (.github/workflows/ci.yml), and then a missing out/ fails.
  const pagesRequired = process.env.REQUIRE_BUILT_PAGES === "1";
  it.skipIf(!pagesRequired && !existsSync(join(OUT, "index.html")))(
    "the built pages (out/*.html: visible text, aria-label and title) use none of the forbidden words",
    () => {
      expect(existsSync(join(OUT, "index.html")), "out/index.html is missing: run `npm run build` first").toBe(true);
      const pages: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const path = join(dir, entry);
          if (statSync(path).isDirectory()) {
            if (entry !== "_next" && entry !== "data") walk(path);
          } else if (entry.endsWith(".html")) pages.push(path);
        }
      };
      walk(OUT);
      expect(pages.length).toBeGreaterThan(0);
      const decode = (x: string) =>
        x
          .replace(/&#x27;|&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&");
      const bad: string[] = [];
      for (const page of pages) {
        // Visible text only: no head, scripts (the embedded payload, with v1's own labels) or styles.
        const html = readFileSync(page, "utf8")
          .replace(/<head>[\s\S]*?<\/head>/, "")
          .replace(/<script[\s\S]*?<\/script>/g, "")
          .replace(/<style[\s\S]*?<\/style>/g, "");
        const attrs = [...html.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map((m) => decode(m[1]));
        const lines = [...decode(html.replace(/<[^>]+>/g, "\n")).split("\n"), ...attrs];
        for (const line of lines) {
          for (const [name, re] of NEVER_USE) if (re.test(line)) bad.push(`${page.slice(OUT.length)}: "${name}" in "${line.trim()}"`);
        }
      }
      expect(bad).toEqual([]);
    },
  );
});
