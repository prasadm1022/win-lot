// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageCacheFile, readWinnersDirectory, updateDirectory } from "../lib/jackpot-sources";
import {
  buildJackpots,
  directoryMonth,
  inferJackpotResets,
  isSuperPrizeListing,
  jackpotTier,
  parseDlbNextJackpots,
  parseNlbDrawPageDate,
  parseNlbPrizeTable,
  parseNlbWinnersDirectory,
  parseNlbWinnersMonths,
  parseRupees,
  renderJackpotDoc,
  type Directory,
  type Jackpot,
  type PrizeRow,
} from "../lib/jackpots";
import { knownFrom } from "../lib/model-v2";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("parseRupees", () => {
  it("handles NLB and DLB formats", () => {
    expect(parseRupees("Rs. 81,540,974.00")).toBe(81540974);
    expect(parseRupees(" Rs.58,522,340/- ")).toBe(58522340);
    expect(parseRupees("Rs.56,553,566.40")).toBe(56553566.4);
    expect(parseRupees("Grand Super Prize (Motor Car)")).toBeNull();
  });
});

describe("NLB prize table", () => {
  it("reads a won Super Prize (Dhana Nidhanaya 2319)", () => {
    const t = parseNlbPrizeTable(fixture("nlb-prize-dhana-nidhanaya-2319.html"))!;
    expect(t.date).toBe("2026-08-24");
    expect(jackpotTier(t)).toEqual({
      name: "Super Prize",
      pattern: "Letter and 4 Numbers Correct",
      prize: 87804496,
      winners: 1,
    });
    expect(t.tiers[1]).toMatchObject({ name: "1 st", prize: 2000000, winners: 0 });
  });
  it("uses Mega Super Prize as the Mega Power jackpot tier", () => {
    const t = parseNlbPrizeTable(fixture("nlb-prize-mega-power-2701.html"))!;
    expect(t.date).toBe("2026-10-27");
    expect(jackpotTier(t)).toMatchObject({ name: "Mega Super Prize", prize: 311209478, winners: 0 });
    expect(t.tiers.find((x) => x.name.startsWith("Grand"))).toMatchObject({ prize: null, winners: 0 });
  });
  it("returns null for old draw pages without a table, which still carry the draw date", () => {
    const html = fixture("nlb-prize-empty.html");
    expect(parseNlbPrizeTable(html)).toBeNull();
    expect(parseNlbDrawPageDate(html)).toEqual({ drawNo: 2300, date: "2025-09-14" });
  });
});

describe("NLB winners directory", () => {
  const html = fixture("nlb-winners.html");
  it("lists month pages", () => {
    const months = parseNlbWinnersMonths(html);
    expect(months[0]).toBe("2026/08");
    expect(months).toContain("2017/01");
  });
  it("reads cards by section without personal data", () => {
    const cards = parseNlbWinnersDirectory(html);
    expect(cards.length).toBe(36);
    const supers = cards.filter(isSuperPrizeListing);
    expect(supers).toContainEqual({ lotteryName: "Mega Power", drawNo: 2440, section: "Super Prize Winners", prize: "Super Prize" });
    expect(supers).toContainEqual({ lotteryName: "Dhana Nidhanaya", drawNo: 2319, section: "Super Prize Winners", prize: "Super Prize" });
    expect(cards.some((c) => c.prize === "Motor Car" && isSuperPrizeListing(c))).toBe(false);
    const card = (prize: string) => ({ lotteryName: "Mega Power", drawNo: 1939, section: "Super Prize Winners", prize });
    expect(isSuperPrizeListing(card("Power Super Prize"))).toBe(false); // fixed 10 M tier, not the jackpot
    expect(isSuperPrizeListing(card("Mega Super Prize"))).toBe(true);
    expect(JSON.stringify(cards)).not.toContain("REDACTED");
  });
  it("labels the cards of page 1 with the month of the run in Sri Lanka (UTC+05:30), never 'latest'", () => {
    expect(directoryMonth(new Date("2026-10-31T18:29:59Z"))).toBe("2026-10"); // 23:59:59 on 31 Oct in Colombo
    expect(directoryMonth(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11"); // midnight in Colombo
    expect(directoryMonth(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01");
    expect(directoryMonth(new Date("2026-03-01T00:00:00Z"))).toBe("2026-03");
  });
});

// lib/jackpot-sources.ts, the side that reads the pages and merges them into data/jackpots.json. A card's listing month
// decides when the model may use it (knownFrom), so these labels guard against leakage (docs/MODEL-V2.md 6, test 5).
describe("winners directory: page-1 labels and the daily merge (fixture pages in the page cache, never the network)", () => {
  const WINNERS = "https://www.nlb.lk/winners";
  /** Super Prize cards without names or towns, in the markup parseNlbWinnersDirectory reads. */
  const page = (cards: string[]) =>
    `<div class="winners"><h2>Super Prize Winners</h2>${cards.map((c) => `<div class="win"><s></s><div>${c}<br>Super Prize <br></div></div>`).join("")}</div>`;
  const cards = (d: Directory) => Object.entries(d).flatMap(([id, m]) => [...m].map(([drawNo, entry]) => ({ card: `${id} ${drawNo}`, ...entry })));
  let root: string;
  let dataDir: string;
  let cacheDir: string;
  let requested: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "win-lot-directory-"));
    dataDir = join(root, "data");
    cacheDir = join(root, "cache");
    mkdirSync(dataDir);
    mkdirSync(cacheDir);
    writeFileSync(pageCacheFile(cacheDir, WINNERS), fixture("nlb-winners.html"));
    // Every page is read from the cache; a page missing there would reach this stub and fail the test.
    requested = [];
    vi.stubGlobal("fetch", async (url: unknown) => {
      requested.push(String(url));
      throw new Error(`no network in tests: ${String(url)}`);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(root, { recursive: true, force: true });
  });

  it("labels every card of page 1 with the month of the run in Colombo (directoryMonth), never 'latest'", async () => {
    for (const [now, month] of [
      ["2026-10-31T18:29:59Z", "2026-10"], // 23:59:59 on 31 Oct in Colombo
      ["2026-10-31T18:30:00Z", "2026-11"], // midnight in Colombo
    ] as const) {
      const d = await readWinnersDirectory({ dataDir, cacheDir, now: new Date(now) });
      expect(cards(d).map((c) => c.card).sort()).toEqual([
        "dhana-nidhanaya 2045",
        "dhana-nidhanaya 2047",
        "dhana-nidhanaya 2319",
        "govisetha 4276",
        "mega-power 2434",
        "mega-power 2438",
        "mega-power 2440",
      ]);
      for (const c of cards(d)) expect(c, c.card).toMatchObject({ listedIn: [month], date: null });
    }
    expect(requested).toEqual([]);
  });

  it("in a full rebuild, a card also on a month page keeps only its month pages; a card on page 1 alone keeps the run month", async () => {
    const months = parseNlbWinnersMonths(fixture("nlb-winners.html"));
    expect(months).toContain("2026/08");
    for (const m of months) writeFileSync(pageCacheFile(cacheDir, `${WINNERS}/${m}`), page(m === "2026/08" ? ["Dhana Nidhanaya 2319"] : []));
    const d = await readWinnersDirectory({ dataDir, cacheDir, allMonths: true, now: new Date("2026-10-29T12:00:00Z") });
    expect(d["dhana-nidhanaya"].get(2319)).toEqual({ listedIn: ["2026-08"], date: null });
    expect(d["mega-power"].get(2440)).toEqual({ listedIn: ["2026-10"], date: null });
    expect(requested).toEqual([]);
  });

  it("a daily merge keeps the earliest month; a card stored as 'latest' by older runs takes the month of the run", async () => {
    const stored = (lotteryId: string, drawNo: number, date: string, listedIn: string[]): Jackpot => ({
      lotteryId,
      drawNo,
      date,
      letter: null,
      numbers: null,
      bonus: null,
      jackpotWinners: null,
      superPrizeAmount: null,
      source: "nlb-winners-directory",
      inDrawHistory: false,
      listedIn,
    });
    const before = [stored("dhana-nidhanaya", 2045, "2025-11-16", ["2025-11"]), stored("mega-power", 2440, "2026-02-01", ["latest"])];
    writeFileSync(join(dataDir, "jackpots.json"), JSON.stringify(before));
    // A new card older than the archive: its date is read from its emptied per-draw page (the fixture of draw 2300).
    writeFileSync(pageCacheFile(cacheDir, "https://www.nlb.lk/results/dhana-nidhanaya/2300"), fixture("nlb-prize-empty.html"));
    // What readWinnersDirectory gives the cards of page 1 on a run in late October: 2045 and 2440 again, 2300 for the first time.
    const run = directoryMonth(new Date("2026-10-29T12:00:00Z"));
    const fresh: Directory = {
      "dhana-nidhanaya": new Map([
        [2045, { listedIn: [run], date: null }],
        [2300, { listedIn: [run], date: null }],
      ]),
      "mega-power": new Map([[2440, { listedIn: [run], date: null }]]),
    };
    const d = await updateDirectory({ dataDir, cacheDir }, fresh);
    // Still on page 1 eleven months later: that says nothing new about when it was public, so the listing stays.
    expect(d["dhana-nidhanaya"].get(2045)).toEqual({ listedIn: ["2025-11"], date: "2025-11-16" });
    // "latest" (older data) only mattered until the card showed up with a month.
    expect(d["mega-power"].get(2440)).toEqual({ listedIn: ["2026-10"], date: "2026-02-01" });
    expect(d["dhana-nidhanaya"].get(2300)).toEqual({ listedIn: ["2026-10"], date: "2025-09-14" });
    // What the model then sees (knownFrom): the earliest listing month's end, never the day after the draw.
    const known = (id: string, drawNo: number) => {
      const e = d[id].get(drawNo)!;
      return knownFrom({ drawNo, date: e.date, source: "nlb-winners-directory", listedIn: e.listedIn }, []);
    };
    expect(known("dhana-nidhanaya", 2045)).toBe("2025-11-30");
    expect(knownFrom(before[1], [])).toBe("2026-02-02"); // as stored: "latest" counted from the day after the draw
    expect(known("mega-power", 2440)).toBe("2026-10-31");
    expect(known("dhana-nidhanaya", 2300)).toBe("2026-10-31");
    expect(requested).toEqual([]);
  });
});

describe("DLB", () => {
  it("parses the NEXT JACKPOT column with its draw number", () => {
    const t = parseDlbNextJackpots(fixture("dlb-home-next-jackpot.html"));
    expect(Object.keys(t)).toEqual(expect.arrayContaining(["Ada Kotipathi", "Super Ball", "Shanida", "Kapruka"]));
    expect(t["Kapruka"]).toEqual({ drawNo: 2504, date: "2026-10-28", nextJackpot: 397249249 });
    expect(t["Ada Kotipathi"]).toEqual({ drawNo: 3154, date: "2026-10-28", nextJackpot: 56553566.4 });
  });
  it("infers a win from a lasting drop over consecutive draws only", () => {
    const rows = (pairs: [number, number][]): PrizeRow[] =>
      pairs.map(([drawNo, amount]) => ({ drawNo, date: null, superPrizeAmount: amount, superPrizeWinners: null }));
    // real NLB Dhana Nidhanaya amounts: 2289 won (93.2M -> base 80M); 2362 is a typo on the NLB page
    const dn = rows([[2288, 92894241], [2289, 93163175], [2290, 80000000], [2291, 80233774],
      [2360, 88618385], [2361, 88618385], [2362, 8896221], [2363, 89214395]]);
    expect(inferJackpotResets(dn)).toEqual([{ drawNo: 2289, amount: 93163175 }]);
    // real NLB Govisetha: 4419 was won 4 draws after the previous reset, so the drop is small
    const gs = rows([[4418, 60336370], [4419, 60502138], [4420, 60000000], [4421, 60172930]]);
    expect(inferJackpotResets(gs)).toEqual([{ drawNo: 4419, amount: 60502138 }]);
    // gap in snapshots, or the newest draw (K+2 not known yet): undecided
    expect(inferJackpotResets(rows([[10, 60e6], [12, 20e6], [13, 20.3e6]]))).toEqual([]);
    expect(inferJackpotResets(rows([[12, 60e6], [13, 20e6]]))).toEqual([]);
  });
});

describe("buildJackpots", () => {
  const draws = {
    "dhana-nidhanaya": [{ drawNo: 2319, date: "2026-08-24", letter: "B", numbers: [1, 2, 3, 4], bonus: null }],
    "mega-power": [{ drawNo: 2600, date: "2026-07-20", letter: "C", numbers: [5, 6, 7, 8], bonus: 9 }],
  };
  it("merges, dedupes and prefers the prize table", () => {
    const j = buildJackpots({
      draws,
      prizes: {
        "dhana-nidhanaya": [{ drawNo: 2319, date: "2026-08-24", superPrizeAmount: 87804496, superPrizeWinners: 1 }],
        "mega-power": [{ drawNo: 2600, date: "2026-07-20", superPrizeAmount: 1e8, superPrizeWinners: 0 }],
      },
      directory: {
        "dhana-nidhanaya": new Map([
          [2319, { listedIn: ["2026-08"], date: null }],
          [2045, { listedIn: ["2025-11"], date: "2025-10-12" }],
        ]),
        "mega-power": new Map([[2600, { listedIn: ["latest"], date: null }]]), // prize table says 0 -> not a jackpot
      },
      dlbSnapshots: {},
    });
    expect(j).toEqual([
      {
        lotteryId: "dhana-nidhanaya", drawNo: 2319, date: "2026-08-24", letter: "B", numbers: [1, 2, 3, 4], bonus: null,
        inDrawHistory: true, jackpotWinners: 1, superPrizeAmount: 87804496, source: "nlb-prize-table", listedIn: ["2026-08"],
      },
      {
        lotteryId: "dhana-nidhanaya", drawNo: 2045, date: "2025-10-12", letter: null, numbers: null, bonus: null,
        inDrawHistory: false, jackpotWinners: null, superPrizeAmount: null, source: "nlb-winners-directory", listedIn: ["2025-11"],
      },
    ]);
  });

  it("renders the markdown report", () => {
    const md = renderJackpotDoc(
      [
        {
          lotteryId: "mega-power", drawNo: 2600, date: "2026-07-20", letter: "C", numbers: [5, 6, 7, 8], bonus: 9,
          inDrawHistory: true, jackpotWinners: 1, superPrizeAmount: 123456789, source: "nlb-prize-table",
        },
      ],
      [
        { id: "mega-power", name: "Mega Power", board: "NLB", firstDate: "2026-03-27", lastDate: "2026-10-27",
          prizes: [{ drawNo: 2600, date: "2026-07-20", superPrizeAmount: 123456789, superPrizeWinners: 1 }] },
        { id: "kapruka", name: "Kapruka", board: "DLB", firstDate: "2021-04-02", lastDate: "2026-10-27", prizes: [] },
      ],
    );
    expect(md).toContain("Snapshot as of 2026-10-27");
    expect(md).toContain("| 2026-07-20 | 2600 | C 05 06 07 08 + 9 | 1 | Rs. 123,456,789 | nlb-prize-table |");
    expect(md).toContain("| Kapruka | DLB | 0 |");
  });
});
