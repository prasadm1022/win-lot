// SPDX-License-Identifier: Apache-2.0
// Benchmark of the build's model work (docs/MODEL-V2.md sections 2.17, 4 and 8.1 item 11):
//   1. v1 predict() and v2 predictAllV2() for all lotteries on data/ (backtests and v1 traces included): <= 20 s;
//   2. a synthetic Dhana Nidhanaya with 100 own jackpot combinations (random earlier draws, plus their dates),
//      predictV2 including its walk-forward backtest: <= 10 s.
// Exits with code 1 when a budget is exceeded. Run: `npm run bench:model`.

import { performance } from "node:perf_hooks";
import { LOTTERY_BY_ID } from "../lib/lotteries";
import { buildContext, predictAllV2, predictV2, walkForward } from "../lib/model-v2";
import { loadDraws, loadJackpots, loadV2Inputs, syntheticCombinations, v2Input, withOwnItems } from "./model-v2-data";

const BUDGET_ALL_MS = 20_000;
const BUDGET_SYNTHETIC_MS = 10_000;
const SYNTHETIC_COMBINATIONS = 100;

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

function main(): void {
  const jackpots = loadJackpots();

  const t0 = performance.now();
  const inputs = loadV2Inputs(jackpots); // reads data/ and runs v1 predict() for every lottery
  const t1 = performance.now();
  const v2 = predictAllV2(inputs);
  const t2 = performance.now();
  const allMs = t2 - t0;

  const dhana = LOTTERY_BY_ID["dhana-nidhanaya"];
  const draws = loadDraws(dhana.id);
  const synthJackpots = withOwnItems(jackpots, dhana.id, syntheticCombinations(dhana, draws, SYNTHETIC_COMBINATIONS, 1));
  const input = v2Input(dhana, draws, synthJackpots, "2026-10-28T00:00:00Z");
  const t3 = performance.now();
  const synth = predictV2(input);
  const t4 = performance.now();
  const ctx = buildContext(dhana, draws, synthJackpots);
  const t5 = performance.now();
  const run = walkForward(ctx);
  const t6 = performance.now();
  const synthMs = t4 - t3;

  const rows: [string, string][] = [
    [`v1 predict(), ${inputs.length} lotteries (with data loading)`, seconds(t1 - t0)],
    [`v2 predictAllV2(), ${Object.keys(v2).length} lotteries (backtests and v1 traces)`, seconds(t2 - t1)],
    [`all ${inputs.length} plus v1 (budget ${seconds(BUDGET_ALL_MS)})`, seconds(allMs)],
    [`synthetic Dhana Nidhanaya, ${SYNTHETIC_COMBINATIONS} combinations, predictV2 (budget ${seconds(BUDGET_SYNTHETIC_MS)})`, seconds(synthMs)],
    [`  of which the walk-forward alone (${run.draws} steps)`, seconds(t6 - t5)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) console.log(`${label.padEnd(width)}  ${value.padStart(8)}`);
  const g = synth.evidence!.guard;
  console.log(`  synthetic guard rung (${g.perCombination}, ${g.union}), excluded share ${g.excludedShare}`);

  const failures: string[] = [];
  if (allMs > BUDGET_ALL_MS) failures.push(`all lotteries took ${seconds(allMs)} > ${seconds(BUDGET_ALL_MS)}`);
  if (synthMs > BUDGET_SYNTHETIC_MS) failures.push(`synthetic backtest took ${seconds(synthMs)} > ${seconds(BUDGET_SYNTHETIC_MS)}`);
  if (failures.length) {
    console.error(`bench-model: FAILED: ${failures.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("bench-model: OK");
  }
}

main();
