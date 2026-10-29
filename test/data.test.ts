// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getDraws,
  getJackpots,
  getJackpotStatus,
  getLotteries,
  getLottery,
  getPrediction,
  getPredictions,
  getPredictionV1,
  getStats,
  getStatus,
  jackpotStatusOf,
  LOTTERY_IDS,
  markJackpotDraws,
  predictionsKey,
  predictionsKeyInputs,
  readPredictionsCache,
  writePredictionsCache,
  type KeyInput,
  type PredictionsCache,
} from "../lib/data";
import type { Jackpot, PrizeRow } from "../lib/jackpots";
import { LOTTERY_BY_ID } from "../lib/lotteries";
import { DISCLAIMER, predict } from "../lib/model";
import { V2_CONSTANTS } from "../lib/model-v2/constants";
import { knownFrom, usableAt } from "../lib/model-v2/evidence";
import { predictAllV2, type V2Input } from "../lib/model-v2/index";
import type { Draw } from "../lib/parsers";
import type { DrawSummary, JackpotStatus } from "../lib/types";

const ROOT = process.cwd();
const stored = <T>(file: string): T => JSON.parse(readFileSync(join(ROOT, "data", file), "utf8")) as T;
const JACKPOTS = stored<Jackpot[]>("jackpots.json");

/** One lottery's model input: its draws oldest first, in the lib/parsers.ts shape. */
const modelDrawsOf = (id: string): Draw[] =>
  getDraws(id)
    .slice()
    .reverse()
    .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus }));

// The first call computes v1 and v2 for all seven lotteries (a few seconds), unless .cache/predictions.json matches.
beforeAll(() => {
  getPredictions();
}, 120_000);

describe("lib/data", () => {
  it("lists all seven lotteries with summary fields", () => {
    const ls = getLotteries();
    expect(ls.map((l) => l.id)).toEqual(LOTTERY_IDS);
    expect(LOTTERY_IDS).toHaveLength(7);
    for (const l of ls) {
      expect(l.drawCount).toBe(getDraws(l.id).length);
      expect(l.lastDraw).toEqual(getDraws(l.id)[0]);
      expect(l.firstDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(getLottery("nope")).toBeNull();
    expect(getLottery("govisetha")?.name).toBe("Govisetha");
  });

  it("draws are newest first with unique draw numbers", () => {
    for (const id of LOTTERY_IDS) {
      const d = getDraws(id);
      expect(d.length).toBeGreaterThanOrEqual(208);
      for (let i = 1; i < d.length; i++) expect(d[i - 1].drawNo).toBeGreaterThan(d[i].drawNo);
    }
  });

  it("stats windows limit the draw count", () => {
    const id = "ada-kotipathi";
    expect(getStats(id, "all").drawCount).toBe(getDraws(id).length);
    expect(getStats(id, "500").drawCount).toBe(500);
    expect(getStats(id, "100").drawCount).toBe(100);
    expect(getStats(id, "100").window).toBe("100");
  });

  it("the previous model (v1) is the deterministic lib/model.ts output over the full history", () => {
    for (const id of LOTTERY_IDS) {
      const p = getPredictionV1(id);
      expect(p).toEqual(predict(LOTTERY_BY_ID[id], modelDrawsOf(id), p.generatedAt));
      expect(p.modelVersion).toBe("win-lot-heuristic-v1");
      expect(p.nextDrawNo).toBe(getDraws(id)[0].drawNo + 1);
      expect(p.sets).toHaveLength(5);
    }
  });

  it("the published prediction is model v2 for the next draw, with v1 kept as previousModel", () => {
    for (const id of LOTTERY_IDS) {
      const p = getPrediction(id);
      const v1 = getPredictionV1(id);
      expect(p.modelVersion).toBe("win-lot-jackpot-v2");
      expect(p.lotteryId).toBe(id);
      expect(p.sets).toHaveLength(5);
      expect(p.nextDrawNo).toBe(getDraws(id)[0].drawNo + 1);
      expect([p.generatedAt, p.basedOnDraws, p.nextDrawDate]).toEqual([v1.generatedAt, v1.basedOnDraws, v1.nextDrawDate]);
      expect(p.disclaimer).toBe(DISCLAIMER);
      expect(p.previousModel).toMatchObject({ modelVersion: v1.modelVersion, sets: v1.sets, backtest: v1.backtest });
      expect(getPrediction(id)).toBe(p); // memoised: one object per process
    }
    expect(() => getPrediction("nope")).toThrow("unknown lottery: nope");
    expect(() => getPredictionV1("nope")).toThrow("unknown lottery: nope");
  });

  it("v2 is predictAllV2 over every lottery's draws, data/jackpots.json, generatedAt and v1 output", () => {
    const inputs: V2Input[] = LOTTERY_IDS.map((id) => ({
      lottery: LOTTERY_BY_ID[id],
      draws: modelDrawsOf(id),
      jackpots: JACKPOTS,
      generatedAt: getPredictionV1(id).generatedAt,
      v1: getPredictionV1(id),
    }));
    const fresh = predictAllV2(inputs);
    // byte-identical, whether this process computed the predictions or read them from .cache/predictions.json
    expect(getPredictions().v2).toStrictEqual(JSON.parse(JSON.stringify(fresh)));
    expect(JSON.stringify(getPredictions().v2)).toBe(JSON.stringify(fresh));
  }, 60_000);

  it("status reads the fetch log", () => {
    const s = getStatus();
    expect(Array.isArray(s.runs)).toBe(true);
    expect(s.lastRun).toBe(s.runs[0]?.run_at ?? null);
  });
});

// ---- The predictions cache (docs/MODEL-V2.md section 4, "Compute once per build") ----

describe("predictions cache", () => {
  it("is keyed on both model versions, V2_CONSTANTS, the data files and the model code, in a fixed order", () => {
    const inputs = predictionsKeyInputs();
    const modelV2 = readdirSync(join(ROOT, "lib", "model-v2"))
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(modelV2).toContain("index.ts");
    expect(inputs.map(([name]) => name)).toEqual([
      "MODEL_VERSION_V2",
      "V2_CONSTANTS",
      "MODEL_VERSION",
      "data/lotteries.json",
      "data/jackpots.json",
      "data/fetch-log.json",
      ...LOTTERY_IDS.map((id) => `data/draws/${id}.json`),
      "lib/data.ts",
      "lib/lotteries.ts",
      "lib/model.ts",
      ...modelV2.map((f) => `lib/model-v2/${f}`),
    ]);
    expect(inputs.slice(0, 3)).toEqual([
      ["MODEL_VERSION_V2", "win-lot-jackpot-v2"],
      ["V2_CONSTANTS", JSON.stringify(V2_CONSTANTS)],
      ["MODEL_VERSION", "win-lot-heuristic-v1"],
    ]);
    for (const [name, bytes] of inputs.slice(3)) {
      expect(Buffer.from(bytes).equals(readFileSync(join(ROOT, name))), name).toBe(true);
    }
    const key = predictionsKey(inputs);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(predictionsKey(predictionsKeyInputs())).toBe(key);
    expect(getPredictions().key).toBe(key);
  });

  it("changes when a data file, a constant, a model version or the model code changes", () => {
    // modified copies in memory: the real files are never touched
    const inputs = predictionsKeyInputs();
    const key = predictionsKey(inputs);
    const text = (name: string) => readFileSync(join(ROOT, name), "utf8");
    const replaced = (name: string, bytes: string): KeyInput[] => {
      const at = inputs.findIndex(([n]) => n === name);
      expect(at, name).toBeGreaterThanOrEqual(0);
      expect(Buffer.from(bytes).equals(Buffer.from(inputs[at][1])), `${name} is modified`).toBe(false);
      return inputs.map(([n, b], i): KeyInput => [n, i === at ? bytes : b]);
    };
    const draws = text("data/draws/govisetha.json");
    const variants: KeyInput[][] = [
      replaced("data/jackpots.json", JSON.stringify(JACKPOTS.slice(1))), // one jackpot win less
      replaced("data/draws/govisetha.json", draws.replace(/"numbers":\[(\d+)/, (_, n) => `"numbers":[${Number(n) + 1}`)),
      replaced("data/fetch-log.json", `${text("data/fetch-log.json")}\n`), // a single byte more
      replaced("data/lotteries.json", text("data/lotteries.json").replace('"mainMax": 82', '"mainMax": 83')),
      replaced("V2_CONSTANTS", JSON.stringify({ ...V2_CONSTANTS, W_J: 13 })),
      replaced("V2_CONSTANTS", JSON.stringify({ ...V2_CONSTANTS, GUARD_ALPHA: 0.06 })),
      replaced("MODEL_VERSION_V2", "win-lot-jackpot-v3"),
      replaced("MODEL_VERSION", "win-lot-heuristic-v2"),
      replaced("lib/model-v2/posterior.ts", `${text("lib/model-v2/posterior.ts")} `),
      replaced("lib/model.ts", text("lib/model.ts").replace("DECAY", "DECAY_")),
      inputs.slice(0, -1), // a model file removed
    ];
    expect(variants.map((v) => v.length)).toContain(inputs.length - 1);
    const keys = variants.map(predictionsKey);
    for (const k of keys) expect(k).not.toBe(key);
    expect(new Set(keys).size).toBe(keys.length);
    // inputs are framed by name and length: moving bytes from one input to the next changes the key
    expect(predictionsKey([["a", "xy"], ["b", "z"]])).not.toBe(predictionsKey([["a", "x"], ["b", "yz"]]));
  });

  it("reads back only a cache written for the same key; a missing, broken or incomplete file is a miss", () => {
    const dir = mkdtempSync(join(tmpdir(), "win-lot-cache-"));
    try {
      const file = join(dir, "nested", "predictions.json");
      const cache = getPredictions();
      expect(readPredictionsCache(cache.key, file)).toBeNull(); // no file yet
      writePredictionsCache(cache, file);
      expect(readPredictionsCache(cache.key, file)).toStrictEqual(cache);
      expect(readPredictionsCache("0".repeat(64), file)).toBeNull(); // computed from other inputs
      writeFileSync(file, JSON.stringify(cache).slice(0, 4096)); // partly written
      expect(readPredictionsCache(cache.key, file)).toBeNull();
      const v2: PredictionsCache["v2"] = { ...cache.v2 };
      delete v2.kapruka;
      writeFileSync(file, JSON.stringify({ ...cache, v2 })); // a lottery missing
      expect(readPredictionsCache(cache.key, file)).toBeNull();
      writeFileSync(file, JSON.stringify({ ...cache, v1: cache.v2 })); // wrong model in the v1 slot
      expect(readPredictionsCache(cache.key, file)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- Jackpot-won draws and the jackpot status (docs/MODEL-V2.md 3.1, 3.2 and 8.1 item 7) ----

/** data/jackpots.json items of one lottery, newest first. */
const ownItems = (id: string) => JACKPOTS.filter((j) => j.lotteryId === id).sort((a, b) => b.drawNo - a.drawNo);
const DLB_IDS = LOTTERY_IDS.filter((id) => LOTTERY_BY_ID[id].board === "DLB");
// The inference rule of lib/jackpots.ts inferJackpotResets: draw K is won when the advertised jackpots of K+1 and K+2
// are both below K's (a real reset falls once and then grows again, so "drops two draws in a row" would be wrong).
const DLB_NOTE =
  "DLB does not publish a winners list. We infer a win when the advertised jackpot falls and is still below its old " +
  "amount one draw later, so wins appear two draws late and without a winners count.";
/** docs/MODEL-V2.md 7.5 "Never use" (and the phrase list of section 6). */
const FORBIDDEN =
  /more likely|better odds|better chance|beats|lucky day|\bdue\b|overdue|\bhot\b|guarantee|accuracy|affinity|x times/i;

// The data docs/MODEL-V2.md was measured on ends with the draws of this date. Daily updates only add later draws
// and wins: the exact values of that day are pinned on the frozen snapshot of test/fixtures/model-v2-golden.json
// (draws, jackpots.json and prizes of 2026-10-27), and the rules are checked on the live data/ as it is.
const SNAPSHOT = "2026-10-27";

interface FrozenSnapshot {
  asOf: string;
  lotteries: { lottery: { id: string }; draws: Draw[] }[];
  jackpots: Jackpot[];
  prizes: Record<string, PrizeRow[]>;
}
const FROZEN: FrozenSnapshot = JSON.parse(readFileSync(join(ROOT, "test", "fixtures", "model-v2-golden.json"), "utf8")).snapshot;

/** The jackpot status of a lottery of the frozen snapshot, through the same pure functions as getJackpotStatus. */
function frozenStatus(id: string): JackpotStatus {
  const entry = FROZEN.lotteries.find((l) => l.lottery.id === id);
  if (!entry) throw new Error(`${id} is not in the frozen snapshot`);
  const ownItems = FROZEN.jackpots.filter((j) => j.lotteryId === id);
  const rows = entry.draws
    .slice()
    .reverse()
    .map((d): DrawSummary => ({ drawNo: d.draw_no, date: d.draw_date, letter: d.letter, numbers: d.numbers, bonus: d.bonus }));
  const draws = markJackpotDraws(rows, ownItems);
  return jackpotStatusOf({ lotteryId: id, board: LOTTERY_BY_ID[id].board, draws, rows: FROZEN.prizes[id] ?? [], ownItems });
}

describe("jackpot-won draws", () => {
  it("carry the jackpot of this lottery's in-archive items only; every other draw stays as stored", () => {
    for (const id of LOTTERY_IDS) {
      const won = new Map(ownItems(id).filter((j) => j.inDrawHistory).map((j): [number, Jackpot] => [j.drawNo, j]));
      const expected = stored<DrawSummary[]>(`draws/${id}.json`).map((d) => {
        const j = won.get(d.drawNo);
        return j ? { ...d, jackpot: { winners: j.jackpotWinners, amount: j.superPrizeAmount, source: j.source } } : d;
      });
      expect(getDraws(id)).toStrictEqual(expected); // strict: no `jackpot: undefined` keys on other draws
      expect(getDraws(id).filter((d) => d.jackpot)).toHaveLength(won.size);
    }
  });

  it("today: exactly the five in-archive own jackpot draws, and no other draw of any lottery", () => {
    const marked = LOTTERY_IDS.flatMap((id) =>
      getDraws(id)
        .filter((d) => d.jackpot && d.date <= SNAPSHOT)
        .map((d) => ({ id, drawNo: d.drawNo, date: d.date, ...d.jackpot })),
    );
    const prizeTable = { winners: 1, source: "nlb-prize-table" };
    expect(marked).toEqual([
      { id: "dhana-nidhanaya", drawNo: 2319, date: "2026-08-24", amount: 87804496, ...prizeTable },
      { id: "dhana-nidhanaya", drawNo: 2289, date: "2026-07-25", amount: 93163175, ...prizeTable },
      { id: "dhana-nidhanaya", drawNo: 2234, date: "2026-05-29", amount: 124605922, ...prizeTable },
      { id: "govisetha", drawNo: 4419, date: "2026-05-02", amount: 60502138, ...prizeTable },
      { id: "govisetha", drawNo: 4415, date: "2026-04-28", amount: 85669902, ...prizeTable },
    ]);
  });
});

describe("jackpot status", () => {
  it("lists every own item of data/jackpots.json, newest first, and nothing of another lottery", () => {
    let listed = 0;
    for (const id of LOTTERY_IDS) {
      const s = getJackpotStatus(id);
      const own = ownItems(id);
      expect(s.lotteryId).toBe(id);
      expect(s.wins).toBe(getJackpots(id));
      expect(s.wins.map((w) => w.drawNo)).toEqual(own.map((j) => j.drawNo));
      s.wins.forEach((w, i) => {
        const j = own[i];
        expect(w).toMatchObject({
          date: j.date,
          letter: j.letter,
          numbers: j.numbers,
          bonus: j.bonus,
          winners: j.jackpotWinners,
          amount: j.superPrizeAmount,
          source: j.source,
          inArchive: j.inDrawHistory,
        });
        expect(w.listedIn).toEqual(j.listedIn);
      });
      listed += s.wins.length;
    }
    expect(listed).toBe(JACKPOTS.length);
  });

  it("uses the shared knownFrom rule, and usedAs only what was known before the next draw", () => {
    for (const id of LOTTERY_IDS) {
      const next = getPrediction(id).nextDrawDate;
      const own = ownItems(id);
      getJackpots(id).forEach((w, i) => {
        expect(w.knownFrom).toBe(knownFrom(own[i], getDraws(id)));
        const usable = usableAt(w.knownFrom, next);
        expect(w.usedAs).toEqual(usable ? (w.numbers ? ["combination", "date"] : ["date"]) : []);
        if (w.date === null) expect(w.knownFrom).toBeNull();
      });
    }
    const win = (id: string, drawNo: number) => getJackpots(id).find((w) => w.drawNo === drawNo);
    // prize table: the day after the draw; winners page: the end of the month that lists it; undated: never used
    expect(win("dhana-nidhanaya", 2319)).toMatchObject({ knownFrom: "2026-08-25", usedAs: ["combination", "date"] });
    expect(win("dhana-nidhanaya", 1080)).toMatchObject({ numbers: null, knownFrom: "2023-03-31", usedAs: ["date"] });
    expect(win("mega-power", 456)).toMatchObject({ date: "2019-11-08", knownFrom: "2020-01-31", usedAs: ["date"] });
    expect(win("govisetha", 1428)).toMatchObject({ date: null, knownFrom: null, usedAs: [] });
  });

  it("usedAs tells the same story as the v2 prediction's evidence", () => {
    type Used = { drawNo: number; date: string | null; kind: string; source: string; knownFrom: string | null };
    const canonical = (xs: Used[]) =>
      [...xs].sort((a, b) => a.drawNo - b.drawNo || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
    for (const id of LOTTERY_IDS) {
      const p = getPrediction(id);
      const ev = p.evidence!;
      expect(ev, id).toBeDefined();
      const wins = getJackpotStatus(id).wins;
      const used = wins.filter((w) => w.usedAs.length);
      // evidence.used lists each usable win once: as a combination when its numbers are known, else as a date
      expect(canonical(ev.used), id).toEqual(
        canonical(
          used.map((w) => ({
            drawNo: w.drawNo,
            date: w.date,
            kind: w.usedAs.includes("combination") ? "combination" : "date",
            source: w.source,
            knownFrom: w.knownFrom,
          })),
        ),
      );
      const counts = ev.counts;
      expect(counts.jackpotCombinations).toEqual({
        used: wins.filter((w) => w.usedAs.includes("combination")).length,
        known: wins.filter((w) => w.numbers !== null).length,
      });
      expect(counts.jackpotDates).toMatchObject({
        used: wins.filter((w) => w.usedAs.includes("date")).length,
        known: wins.filter((w) => w.date !== null).length,
        undated: wins.filter((w) => w.date === null).length,
      });
      expect(ev.status).toBe(
        counts.jackpotCombinations.used ? "combinations" : counts.jackpotDates.used ? "dates-only" : "none",
      );
      expect(ev.asOf).toBe(p.nextDrawDate);
      // a win still waiting to become usable is listed as pending, never as used
      const unused = new Set(wins.filter((w) => !w.usedAs.length).map((w) => w.drawNo));
      for (const item of ev.pending) expect(unused.has(item.drawNo), `${id} ${item.drawNo}`).toBe(true);
    }
  });

  it("derives the last win, the current jackpot, the checked draws and the notes from the data", () => {
    for (const id of LOTTERY_IDS) {
      const s = getJackpotStatus(id);
      const latest = getDraws(id)[0];
      const last = s.wins.at(0);
      if (last) {
        expect(s.lastWin).toEqual({ drawNo: last.drawNo, date: last.date, inArchive: last.inArchive });
        expect(s.drawsSinceLastWin).toBe(latest.drawNo - last.drawNo);
        expect(s.daysSinceLastWin === null).toBe(last.date === null);
      } else {
        expect([s.lastWin, s.drawsSinceLastWin, s.daysSinceLastWin]).toEqual([null, null, null]);
      }
      if (LOTTERY_BY_ID[id].board === "NLB") {
        // the prize table's winners counts and the prize-table wins in the list tell the same story
        expect(s.checked?.wins).toBe(s.wins.filter((w) => w.source === "nlb-prize-table").length);
        expect(s.current?.kind).toBe("last-draw");
        expect(s.notes).not.toContain(DLB_NOTE);
      } else {
        expect(s.checked).toBeNull();
        expect(s.current?.kind ?? "advertised-next").toBe("advertised-next");
        expect(s.notes[0]).toBe(DLB_NOTE);
      }
      for (const note of s.notes) expect(note).not.toMatch(FORBIDDEN);
    }
  });

  it("latestDraw: the newest archived draw's jackpot outcome; never 'not-won' without an NLB prize row of 0 winners", () => {
    for (const id of LOTTERY_IDS) {
      const s = getJackpotStatus(id);
      const latest = getDraws(id)[0];
      const nlb = LOTTERY_BY_ID[id].board === "NLB";
      // the NLB prize row of the newest draw, when it shows a winners count (DLB publishes no winners)
      const row = nlb
        ? stored<PrizeRow[]>(`prizes/${id}.json`).find((r) => r.drawNo === latest.drawNo && r.superPrizeWinners !== null)
        : undefined;
      const won = latest.jackpot !== undefined || (row !== undefined && row.superPrizeWinners! > 0);
      expect(s.latestDraw, id).not.toBeNull();
      const { drawNo, date, outcome } = s.latestDraw!;
      expect({ drawNo, date }, id).toEqual({ drawNo: latest.drawNo, date: latest.date });
      expect(["won", "not-won", "unknown"]).toContain(outcome);
      // 'won' iff the newest draw is marked "Jackpot won" or its NLB prize row shows winners
      expect(outcome === "won", id).toBe(won);
      // 'not-won' (shown as "Jackpot not won - it rolls over") only from an NLB prize row of 0 winners
      expect(outcome === "not-won", id).toBe(!won && row !== undefined && row.superPrizeWinners === 0);
      if (!nlb) expect(outcome, id).not.toBe("not-won");
      // a marked newest draw and a "not-won" status can never meet
      if (latest.jackpot) expect(outcome).toBe("won");
    }
  });

  it("frozen snapshot of 2026-10-27: the newest draws rolled over at NLB; DLB outcomes are not known yet", () => {
    expect(FROZEN.asOf).toBe(SNAPSHOT);
    expect(Object.fromEntries(FROZEN.lotteries.map(({ lottery: { id } }) => [id, frozenStatus(id).latestDraw]))).toEqual({
      "dhana-nidhanaya": { drawNo: 2383, date: "2026-10-27", outcome: "not-won" },
      "mega-power": { drawNo: 2701, date: "2026-10-27", outcome: "not-won" },
      govisetha: { drawNo: 4595, date: "2026-10-27", outcome: "not-won" },
      "ada-kotipathi": { drawNo: 3153, date: "2026-10-27", outcome: "unknown" },
      kapruka: { drawNo: 2503, date: "2026-10-27", outcome: "unknown" },
    });
  });

  it("frozen snapshot of 2026-10-27: 29 wins (6 undated), Dhana Nidhanaya 3 in 207 checked draws, none for DLB", () => {
    // The snapshot freezes the whole jackpots.json; Super Ball and Shanida (no draws in it) have no item either.
    expect(FROZEN.jackpots).toHaveLength(29);
    expect(FROZEN.jackpots.filter((j) => j.date === null)).toHaveLength(6);
    const own = (id: string) => FROZEN.jackpots.filter((j) => j.lotteryId === id).length;
    for (const { lottery } of FROZEN.lotteries) expect(frozenStatus(lottery.id).wins).toHaveLength(own(lottery.id));
    expect(Object.fromEntries(LOTTERY_IDS.map((id) => [id, own(id)]))).toEqual({
      "dhana-nidhanaya": 7,
      "mega-power": 11,
      govisetha: 11,
      "ada-kotipathi": 0,
      "super-ball": 0,
      shanida: 0,
      kapruka: 0,
    });
    // what the v2 picks may use for the next draw (docs/MODEL-V2.md 2.4, "Measured today")
    const uses = (id: string) => {
      const ws = frozenStatus(id).wins;
      const count = (kind: string) => ws.filter((w) => (w.usedAs as string[]).includes(kind)).length;
      const unused = ws.filter((w) => !w.usedAs.length).length;
      return { combinations: count("combination"), dates: count("date"), unused };
    };
    expect(uses("dhana-nidhanaya")).toEqual({ combinations: 3, dates: 7, unused: 0 });
    expect(uses("govisetha")).toEqual({ combinations: 2, dates: 7, unused: 4 });
    expect(uses("mega-power")).toEqual({ combinations: 0, dates: 9, unused: 2 });

    const dhana = frozenStatus("dhana-nidhanaya");
    expect(dhana).toMatchObject({
      lastWin: { drawNo: 2319, date: "2026-08-24", inArchive: true },
      drawsSinceLastWin: 64,
      daysSinceLastWin: 64,
      current: { amount: 93874580, drawNo: 2383, date: "2026-10-27", kind: "last-draw" },
      checked: { draws: 207, wins: 3, from: "2026-03-28", to: "2026-10-27" },
    });
    expect(dhana.notes).toEqual([
      "4 of the 7 known jackpot wins are older than our draw archive (it starts on 27 Mar 2026), so their winning " +
        "numbers are not known.",
      "Draw 2362 (6 Oct 2026): NLB publishes a jackpot of Rs. 8,896,221, an obvious typo (Rs. 88.6 M the draw " +
        "before, Rs. 89.2 M the draw after). It is shown as published; the picks never use jackpot amounts.",
    ]);
    expect(frozenStatus("govisetha").notes).toEqual([
      "9 of the 11 known jackpot wins are older than our draw archive (it starts on 27 Mar 2026), so their winning " +
        "numbers are not known.",
      "4 wins have no known date, so the picks do not use them.",
      "Draw 4431 (14 May 2026): NLB publishes a jackpot of Rs. 6,206,124, an obvious typo (Rs. 61.8 M the draw " +
        "before, Rs. 62.2 M the draw after). It is shown as published; the picks never use jackpot amounts.",
    ]);
    expect(frozenStatus("mega-power")).toMatchObject({
      lastWin: { drawNo: 2440, date: "2026-02-01", inArchive: false },
      drawsSinceLastWin: 261,
      checked: { draws: 207, wins: 0 },
    });
    for (const id of ["ada-kotipathi", "kapruka"]) {
      expect(frozenStatus(id)).toMatchObject({
        wins: [],
        lastWin: null,
        drawsSinceLastWin: null,
        daysSinceLastWin: null,
        current: { kind: "advertised-next", date: null },
        checked: null,
        notes: [DLB_NOTE],
      });
    }
    const kapruka = frozenStatus("kapruka").current;
    expect(kapruka).toEqual({ amount: 397249249, drawNo: 2505, date: null, kind: "advertised-next" });
  });
});
