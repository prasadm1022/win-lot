// SPDX-License-Identifier: Apache-2.0
// Frozen parity with the original Python model (scraper/model.py, removed in v2).
// Both fixtures hold Python's output: model-parity.json (last 260 draws per lottery) and
// model-parity-full.json (full history as of 2026-10-28). Any change to lib/model.ts that alters
// picks for the same data fails here. PARITY_FILE adds an extra file to check.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { predict } from "../lib/model";

const files = [
  join(__dirname, "fixtures", "model-parity.json"),
  join(__dirname, "fixtures", "model-parity-full.json"),
  ...(process.env.PARITY_FILE ? [process.env.PARITY_FILE] : []),
];

for (const file of files) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { cases: [] };
  describe.skipIf(!data.cases.length)(`model parity (${file.split(/[\/]/).pop()})`, () => {
    for (const c of data.cases) {
      it(`${c.lottery.id}: output equals frozen Python output (${c.draws.length} draws)`, () => {
        expect(predict(c.lottery, c.draws, data.generatedAt)).toEqual(c.expected);
      });
    }
  });
}
