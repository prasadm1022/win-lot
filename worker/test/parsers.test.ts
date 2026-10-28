// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOTTERY_BY_ID } from "../src/lotteries";
import {
  normalize,
  parseDlbDate,
  parseDlbLatest,
  parseDlbPage,
  parseNlb,
  parseNlbDate,
  solveCookieChallenge,
} from "../src/parsers";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

describe("dates", () => {
  it("parses NLB and DLB date formats", () => {
    expect(parseNlbDate("Tuesday October 27, 2026")).toBe("2026-10-27");
    expect(parseDlbDate("2026-Oct-05 Monday")).toBe("2026-10-05");
  });
  it("rejects garbage", () => {
    expect(() => parseNlbDate("yesterday")).toThrow();
    expect(() => parseDlbDate("2026/10/05")).toThrow();
  });
});

describe("NLB cookie challenge", () => {
  it("extracts the human cookie from the challenge page", () => {
    expect(solveCookieChallenge(fixture("nlb-challenge.html"))).toMatch(/^[0-9a-f]{40}$/);
  });
  it("returns null for a real results page", () => {
    expect(solveCookieChallenge(fixture("nlb-govisetha.html"))).toBeNull();
  });
});

describe("parseNlb", () => {
  it("parses Govisetha rows (letter + 4 numbers)", () => {
    const rows = parseNlb(fixture("nlb-govisetha.html"));
    expect(rows).toHaveLength(208);
    expect(rows[0]).toMatchObject({ draw_no: 4595, draw_date: "2026-10-27", letter: "A", numbers: [32, 62, 74, 80] });
    const d = normalize(LOTTERY_BY_ID["govisetha"], rows[0]);
    expect(d).toEqual({ draw_no: 4595, draw_date: "2026-10-27", letter: "A", numbers: [32, 62, 74, 80], bonus: null });
  });
  it("parses the Mega Power super number as bonus", () => {
    const rows = parseNlb(fixture("nlb-mega-power.html"));
    const d = normalize(LOTTERY_BY_ID["mega-power"], rows[0]);
    expect(d).toEqual({ draw_no: 2701, draw_date: "2026-10-27", letter: "M", numbers: [39, 47, 48, 50], bonus: 15 });
  });
  it("parses the Dhana Nidhanaya Sunday Bonus digits", () => {
    const lottery = LOTTERY_BY_ID["dhana-nidhanaya"];
    const draws = parseNlb(fixture("nlb-dhana-nidhanaya.html")).map((r) => normalize(lottery, r));
    expect(draws.every((d) => d !== null)).toBe(true);
    const withBonus = draws.filter((d) => d!.bonus !== null);
    expect(withBonus.length).toBeGreaterThan(10);
    const bonus = withBonus[0]!.bonus as { label: string; digits: number[] };
    expect(bonus.label).toBe("Sunday Bonus");
    expect(bonus.digits).toHaveLength(4);
  });
  it("returns [] for a page without the results table", () => {
    expect(parseNlb("<html><body>maintenance</body></html>")).toEqual([]);
  });
});

describe("parseDlbPage", () => {
  it("parses Super Ball pagination rows", () => {
    const rows = parseDlbPage(fixture("dlb-super-ball-page.html"));
    expect(rows.length).toBe(12);
    expect(rows[0]).toMatchObject({ draw_no: 3315, draw_date: "2026-10-15", letter: "Z", numbers: [18, 20, 54, 65] });
  });
  it("splits the Kapruka fifth number into the bonus", () => {
    const rows = parseDlbPage(fixture("dlb-kapruka-page.html"));
    const d = normalize(LOTTERY_BY_ID["kapruka"], rows[0]);
    expect(d).toEqual({ draw_no: 2491, draw_date: "2026-10-15", letter: "J", numbers: [16, 25, 27, 56], bonus: 14 });
  });
  it("parses Ada Kotipathi and Shanida", () => {
    expect(parseDlbPage(fixture("dlb-ada-kotipathi-page.html"))[0]).toMatchObject({ draw_no: 3141, letter: "E", numbers: [15, 21, 43, 64] });
    expect(parseDlbPage(fixture("dlb-shanida-page.html"))[0]).toMatchObject({ draw_no: 5476, letter: "F", numbers: [6, 12, 46, 80] });
  });
  it("returns [] for an empty fragment", () => {
    expect(parseDlbPage("")).toEqual([]);
  });
});

describe("parseDlbLatest", () => {
  it("returns the latest draw of every DLB lottery with its resultID", () => {
    const latest = parseDlbLatest(fixture("dlb-latest.html"));
    expect(latest["3"]).toMatchObject({ draw_no: 3327, draw_date: "2026-10-27", letter: "O", numbers: [21, 46, 59, 66], result_id: "19056" });
    expect(latest["11"]).toMatchObject({ draw_no: 3153, letter: "S", numbers: [1, 4, 21, 22] });
    expect(latest["1"]).toMatchObject({ draw_no: 5488, letter: "Y", numbers: [15, 55, 67, 73] });
    expect(normalize(LOTTERY_BY_ID["kapruka"], latest["12"])).toMatchObject({ draw_no: 2503, letter: "N", numbers: [27, 39, 49, 72], bonus: 12 });
  });
});

describe("normalize", () => {
  it("rejects rows with the wrong number count or a missing letter", () => {
    const lottery = LOTTERY_BY_ID["govisetha"];
    const base = { draw_no: 1, draw_date: "2026-01-01", letter: "A", numbers: [1, 2, 3, 4], extra: {} };
    expect(normalize(lottery, { ...base, numbers: [1, 2, 3] })).toBeNull();
    expect(normalize(lottery, { ...base, letter: null })).toBeNull();
    expect(normalize(lottery, base)).not.toBeNull();
  });
});
