// SPDX-License-Identifier: Apache-2.0
// prebuild: emit open-data JSON to public/data/ (copied into out/ by `next build`).
//   public/data/<id>.json        { lottery, draws, prediction }
//   public/data/<id>/draws.json  DrawSummary[] newest first
//   public/data/lotteries.json   Lottery[]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDraws, getLotteries, getPrediction } from "../lib/data";

const dir = join(process.cwd(), "public", "data");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const lotteries = getLotteries();
writeFileSync(join(dir, "lotteries.json"), JSON.stringify(lotteries));
for (const lottery of lotteries) {
  const draws = getDraws(lottery.id);
  const prediction = draws.length ? getPrediction(lottery.id) : null;
  writeFileSync(join(dir, `${lottery.id}.json`), JSON.stringify({ lottery, draws, prediction }));
  mkdirSync(join(dir, lottery.id), { recursive: true });
  writeFileSync(join(dir, lottery.id, "draws.json"), JSON.stringify(draws));
}
console.log(`export-public: wrote ${lotteries.length} lotteries to public/data/`);
