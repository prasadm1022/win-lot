// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { getDraws, getLotteries, getLottery, getPrediction, getStats, getStatus, LOTTERY_IDS } from "../lib/data";
import { LOTTERY_BY_ID } from "../lib/lotteries";
import { predict } from "../lib/model";

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

  it("prediction is the deterministic model output over the full history", () => {
    for (const id of LOTTERY_IDS) {
      const p = getPrediction(id);
      const draws = getDraws(id)
        .slice()
        .reverse()
        .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus }));
      expect(p).toEqual(predict(LOTTERY_BY_ID[id], draws, p.generatedAt));
      expect(p.nextDrawNo).toBe(getDraws(id)[0].drawNo + 1);
      expect(p.sets).toHaveLength(5);
    }
  });

  it("status reads the fetch log", () => {
    const s = getStatus();
    expect(Array.isArray(s.runs)).toBe(true);
    expect(s.lastRun).toBe(s.runs[0]?.run_at ?? null);
  });
});
