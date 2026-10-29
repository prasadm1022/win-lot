// SPDX-License-Identifier: Apache-2.0
// Shared loaders of the model-v2 tooling (scripts/model-v2-golden.ts, scripts/bench-model.ts,
// scripts/model-v2-audit.ts) and of the v2 tests. Not a script itself.
//
// data/*.json -> predictAllV2 inputs, built the same way lib/data.ts builds them: draws oldest first in the
// lib/parsers.ts shape, generatedAt = run_at of the newest successful fetch that inserted draws (else the newest draw
// date at 00:00Z), v1 = predict() of lib/model.ts on the same draws. Deliberately independent of lib/data.ts and of
// its build cache (.cache/predictions.json), so a test or a benchmark always computes the model.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Jackpot } from "../lib/jackpots";
import { LOTTERIES, type Lottery } from "../lib/lotteries";
import { fnv1a, mulberry32, predict } from "../lib/model";
import type { V2Input } from "../lib/model-v2";
import type { Draw } from "../lib/parsers";
import type { FetchRun } from "../lib/types";

/** Project root (this file lives in scripts/). */
export const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as T;
}

/** One row of data/draws/<id>.json (newest first on disk). */
export interface DrawRow {
  drawNo: number;
  date: string;
  letter: string | null;
  numbers: number[];
  bonus: unknown;
}

/** data/draws/<id>.json rows -> model draws, oldest first (the mapping of lib/data.ts modelDraws). */
export function toModelDraws(rows: readonly DrawRow[]): Draw[] {
  return rows
    .slice()
    .reverse()
    .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null }));
}

/** Draws of one lottery, oldest first. */
export function loadDraws(id: string): Draw[] {
  return toModelDraws(readJson<DrawRow[]>(`data/draws/${id}.json`));
}

/** The whole data/jackpots.json (all lotteries). */
export function loadJackpots(): Jackpot[] {
  return readJson<Jackpot[]>("data/jackpots.json");
}

let fetchLog: FetchRun[] | null = null;

/** generatedAt rule of lib/data.ts: the newest successful fetch that inserted draws, else the newest draw at 00:00Z. */
export function generatedAtFor(id: string, draws: readonly Draw[]): string {
  fetchLog ??= readJson<FetchRun[]>("data/fetch-log.json");
  const run = fetchLog.find((r) => r.lottery_id === id && r.status === "ok" && r.inserted > 0);
  return run?.run_at ?? `${draws[draws.length - 1].draw_date}T00:00:00Z`;
}

/** One predictV2 / predictAllV2 input; v1 is computed here from the same draws. */
export function v2Input(lottery: Lottery, draws: Draw[], jackpots: Jackpot[], generatedAt: string): V2Input {
  return { lottery, draws, jackpots, generatedAt, v1: predict(lottery, draws, generatedAt) };
}

/** Inputs for all configured lotteries, in data/lotteries.json order (the order of lib/data.ts). */
export function loadV2Inputs(jackpots: Jackpot[] = loadJackpots()): V2Input[] {
  return LOTTERIES.map((lottery) => {
    const draws = loadDraws(lottery.id);
    return v2Input(lottery, draws, jackpots, generatedAtFor(lottery.id, draws));
  });
}

/** sha256 (hex) of the JSON text of a value. */
export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Synthetic own jackpot combinations (docs/MODEL-V2.md sections 5.3 item 4 and 6): n distinct archive draws chosen
 * with a seeded stream become jackpot wins of this lottery, each with its numbers, letter and date, published by an
 * NLB prize table (so each is known from the day after its draw). Nested: the first n of seed s are a prefix of the
 * first m > n of the same seed. Ascending by draw number.
 */
export function syntheticCombinations(lottery: Lottery, draws: readonly Draw[], n: number, seed = 1): Jackpot[] {
  const N = draws.length;
  if (n > N) throw new Error(`syntheticCombinations: ${n} combinations requested from ${N} draws`);
  const rng = mulberry32(fnv1a(`${lottery.id}:synthetic-combinations:${seed}`));
  const idx = Array.from({ length: N }, (_, i) => i);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng() * (N - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx
    .slice(0, n)
    .sort((a, b) => a - b)
    .map((i) => {
      const d = draws[i];
      return {
        lotteryId: lottery.id,
        drawNo: d.draw_no,
        date: d.draw_date,
        letter: d.letter,
        numbers: [...d.numbers].sort((a, b) => a - b),
        bonus: Number.isInteger(d.bonus) ? d.bonus : null,
        jackpotWinners: 1,
        superPrizeAmount: null,
        source: "nlb-prize-table" as const,
        inDrawHistory: true,
      };
    });
}

/** Replace this lottery's own items in a jackpots list (other lotteries' items are kept, in order). */
export function withOwnItems(jackpots: readonly Jackpot[], lotteryId: string, own: readonly Jackpot[]): Jackpot[] {
  return [...jackpots.filter((j) => j.lotteryId !== lotteryId), ...own];
}
