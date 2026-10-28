// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildJackpots,
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
  type PrizeRow,
} from "../lib/jackpots";

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
