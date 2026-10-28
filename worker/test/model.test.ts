import { describe, expect, it } from "vitest";
import type { Lottery } from "../src/lotteries";
import { backtest, fnv1a, mulberry32, nextDrawDate, predict, quantile, r4 } from "../src/model";
import type { Draw } from "../src/parsers";

const lottery: Lottery = {
  id: "test", name: "Test", board: "DLB", source_url: "", source_key: "0", letter_kind: "letter",
  main_count: 4, main_min: 1, main_max: 20, has_bonus: 1, bonus_label: "Bonus", bonus_min: 1, bonus_max: 5,
};

function synthDraws(n: number): Draw[] {
  const rng = mulberry32(42);
  const out: Draw[] = [];
  for (let i = 0; i < n; i++) {
    const nums = new Set<number>();
    while (nums.size < 4) nums.add(1 + Math.floor(rng() * 20));
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    out.push({ draw_no: 100 + i, draw_date: day, letter: "ABC"[i % 3], numbers: [...nums].sort((a, b) => a - b), bonus: 1 + (i % 5) });
  }
  return out;
}

describe("helpers", () => {
  it("mulberry32 / fnv1a are deterministic 32-bit", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
    expect(fnv1a("a")).toBe(0xe40c292c);
    const a = mulberry32(1);
    const b = mulberry32(1);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
  it("quantile interpolates linearly", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantile([5], 0.75)).toBe(5);
  });
  it("r4 rounds half up", () => {
    expect(r4(0.12345)).toBe(0.1235);
  });
  it("nextDrawDate follows the observed weekdays", () => {
    expect(nextDrawDate(["2026-10-12", "2026-10-19", "2026-10-26"])).toBe("2026-11-02"); // Mondays only
    expect(nextDrawDate(["2026-10-26", "2026-10-27"])).toBe("2026-11-02"); // Mon + Tue, last Tue
  });
});

describe("predict", () => {
  const draws = synthDraws(300);
  const p = predict(lottery, draws, "2026-10-28T00:00:00Z");

  it("produces 5 valid sets", () => {
    expect(p.sets).toHaveLength(5);
    for (const s of p.sets) {
      expect(s.numbers).toHaveLength(4);
      expect(new Set(s.numbers).size).toBe(4);
      expect(s.numbers.every((n) => n >= 1 && n <= 20)).toBe(true);
      expect([...s.numbers].sort((a, b) => a - b)).toEqual(s.numbers);
      expect(["A", "B", "C"]).toContain(s.letter);
      expect(s.bonus).toBeGreaterThanOrEqual(1);
      expect(s.bonus).toBeLessThanOrEqual(5);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
  });
  it("scores every number in 0..1 with a full range", () => {
    expect(p.numberScores).toHaveLength(20);
    expect(Math.max(...p.numberScores.map((s) => s.score))).toBe(1);
    expect(Math.min(...p.numberScores.map((s) => s.score))).toBe(0);
  });
  it("reports metadata and a backtest", () => {
    expect(p.basedOnDraws).toBe(300);
    expect(p.nextDrawNo).toBe(400);
    expect(p.backtest.draws).toBe(200);
    expect(p.backtest.randomBaseline).toBe(0.8);
    expect(p.disclaimer).toMatch(/random/);
  });
  it("is deterministic", () => {
    expect(predict(lottery, draws, "2026-10-28T00:00:00Z")).toEqual(p);
  });
  it("handles a short history (no backtest)", () => {
    const short = predict(lottery, draws.slice(0, 10), "x");
    expect(short.backtest.draws).toBe(0);
    expect(short.sets).toHaveLength(5);
  });
  it("backtest random baseline equals k^2/range", () => {
    expect(backtest([[1, 2, 3, 4]], 1, 80, 4).randomBaseline).toBe(0.2);
  });
});
