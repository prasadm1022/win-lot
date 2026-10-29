// SPDX-License-Identifier: Apache-2.0
// The per-draw v1 trace (lib/model-v2/v1trace.ts) reproduces v1 backtest() exactly (docs/MODEL-V2.md section 6), so
// the v2/v1 comparison is paired on identical draws, while lib/model.ts itself stays untouched.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOTTERIES } from "../lib/lotteries";
import { backtest, mulberry32, r4 } from "../lib/model";
import { v1TopPickHits } from "../lib/model-v2";

const root = join(__dirname, "..");

/** Draw numbers of data/draws/<id>.json, oldest first (the model's order). */
function history(id: string): number[][] {
  const draws = JSON.parse(readFileSync(join(root, "data", "draws", `${id}.json`), "utf8")) as { numbers: number[] }[];
  return draws
    .slice()
    .reverse()
    .map((d) => d.numbers);
}

function expectSameAsV1(hist: number[][], lo: number, hi: number, k: number) {
  const hits = v1TopPickHits(hist, lo, hi, k);
  const v1 = backtest(hist, lo, hi, k);
  expect(hits).toHaveLength(v1.draws);
  const mean = hits.length ? r4(hits.reduce((s, h) => s + h, 0) / hits.length) : 0;
  expect(mean).toBe(v1.avgHits);
  for (const h of hits) expect(h >= 0 && h <= k).toBe(true);
}

describe("v1 trace equals v1 backtest()", () => {
  for (const l of LOTTERIES) {
    it(`${l.id}: real data`, () => expectSameAsV1(history(l.id), l.main_min, l.main_max, l.main_count));
  }

  for (const name of ["model-parity.json", "model-parity-full.json"]) {
    const file = join(__dirname, "fixtures", name);
    const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { cases: [] };
    describe.skipIf(!data.cases.length)(name, () => {
      for (const c of data.cases) {
        it(`${c.lottery.id} (${c.draws.length} draws)`, () => {
          const hist = (c.draws as { numbers: number[] }[]).map((d) => d.numbers);
          expectSameAsV1(hist, c.lottery.main_min, c.lottery.main_max, c.lottery.main_count);
          expect(r4(v1TopPickHits(hist, c.lottery.main_min, c.lottery.main_max, c.lottery.main_count).reduce((s, h) => s + h, 0) / c.expected.backtest.draws)).toBe(c.expected.backtest.avgHits);
        });
      }
    });
  }

  it("synthetic histories of several sizes (including too short for a backtest)", () => {
    const rng = mulberry32(7);
    for (const n of [5, 30, 31, 45, 230, 260]) {
      const hist = Array.from({ length: n }, () => {
        const s = new Set<number>();
        while (s.size < 4) s.add(1 + Math.floor(rng() * 36));
        return [...s];
      });
      expectSameAsV1(hist, 1, 36, 4);
    }
    expect(v1TopPickHits([[1, 2, 3, 4]], 1, 80, 4)).toEqual([]);
  });
});

describe("lib/model.ts stays byte-intact (docs/MODEL-V2.md 8.1 item 1)", () => {
  it("its text (line endings normalised) has the sha256 of the v1 release", () => {
    // The v1 parity tests catch any change to v1's output; this pin also catches an edit that keeps the output, so a
    // change to the previous model can only be deliberate (update this hash together with docs/MODEL-V2.md).
    const text = readFileSync(join(root, "lib", "model.ts"), "utf8").replace(/\r\n/g, "\n");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe("7977fa352a30357b6239bf67c4ef55e700a92b8591b1d42b8631e48f8a894a7e");
  });
});
