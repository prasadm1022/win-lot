// Python (scraper/model.py) vs TypeScript (worker/src/model.ts) parity on real data.
// Default: worker/test/fixtures/model-parity.json (last 260 draws per lottery).
// `npm run check:model` sets PARITY_FILE to a full-history export.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { predict } from "../src/model";

const file = process.env.PARITY_FILE ?? join(__dirname, "fixtures", "model-parity.json");
const data = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { cases: [] };

describe.skipIf(!data.cases.length)(`model parity (${file})`, () => {
  for (const c of data.cases) {
    it(`${c.lottery.id}: TS output equals Python output (${c.draws.length} draws)`, () => {
      expect(predict(c.lottery, c.draws, data.generatedAt)).toEqual(c.expected);
    });
  }
});
