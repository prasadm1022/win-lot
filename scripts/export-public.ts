// SPDX-License-Identifier: Apache-2.0
// prebuild: compute the predictions once, then emit open-data JSON to public/data/ (copied into out/ by `next build`).
//   .cache/predictions.json      { key, v1, v2 }  read by the `next build` workers (lib/data.ts getPredictions)
//   public/data/<id>.json        { lottery, draws, prediction, jackpots }  (prediction: v2, jackpots: JackpotStatus)
//   public/data/<id>/draws.json  DrawSummary[] newest first (jackpot-won draws carry `jackpot`)
//   public/data/lotteries.json   Lottery[]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  getDraws,
  getJackpotStatus,
  getLotteries,
  getPrediction,
  getPredictions,
  writePredictionsCache,
} from "../lib/data";

// v1 and v2 for all lotteries: computed here (or reused when the cache key still matches), once per build.
const predictions = getPredictions();
writePredictionsCache(predictions);

// docs/MODEL-V2.md 8.1 item 8: a backtest check that stays unusual after Holm is escalated, never celebrated. Lottery
// draws are random, so it most likely means a fault in the data or the model (or a rare fluke): say so loudly in the
// build log, and as a warning annotation when running in GitHub Actions. The pages say it plainly too.
const survivors = Object.values(predictions.v2).flatMap((p) => {
  const d = p.backtestDetail;
  if (!d) return [];
  return [
    ...(d.holm.anySignificant ? [`${p.lotteryId}: a check of this lottery (${d.holm.tests} checks, smallest p ${d.holm.minP})`] : []),
    ...(d.holmAll?.anySignificant ? [`${p.lotteryId}: the headline hits over all lotteries (smallest p ${d.holmAll.minP})`] : []),
  ];
});
for (const line of survivors) {
  const message = `model-v2 backtest: ${line} stays unusual after Holm; check the data and the model before publishing`;
  console.warn(`WARNING ${message}`);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=model-v2 backtest::${message}`);
}

const dir = join(process.cwd(), "public", "data");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const lotteries = getLotteries();
writeFileSync(join(dir, "lotteries.json"), JSON.stringify(lotteries));
for (const lottery of lotteries) {
  const draws = getDraws(lottery.id);
  const prediction = draws.length ? getPrediction(lottery.id) : null;
  const jackpots = getJackpotStatus(lottery.id);
  writeFileSync(join(dir, `${lottery.id}.json`), JSON.stringify({ lottery, draws, prediction, jackpots }));
  mkdirSync(join(dir, lottery.id), { recursive: true });
  writeFileSync(join(dir, lottery.id, "draws.json"), JSON.stringify(draws));
}
console.log(`export-public: wrote ${lotteries.length} lotteries to public/data/ and the predictions to .cache/`);
