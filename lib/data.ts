// SPDX-License-Identifier: Apache-2.0
// Build-time data access for the static Next.js site. Reads data/*.json with fs (server only)
// and computes stats/predictions deterministically from the committed draw history.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOTTERIES, LOTTERY_BY_ID, LOTTERY_META, type Lottery as LotteryConfig } from "./lotteries";
import { predict } from "./model";
import type { Draw } from "./parsers";
import { computeStats } from "./stats";
import type { DrawSummary, FetchRun, Lottery, Prediction, Stats, StatsWindow, Status } from "./types";

export type StatusInfo = Status;

const DATA_DIR = join(process.cwd(), "data");
const WINDOWS: StatsWindow[] = ["all", "500", "100"];

export const LOTTERY_IDS: string[] = LOTTERIES.map((l) => l.id);

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(DATA_DIR, file), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

function memo<T>(fn: (id: string) => T): (id: string) => T {
  const cache = new Map<string, T>();
  return (id) => {
    if (!cache.has(id)) cache.set(id, fn(id));
    return cache.get(id)!;
  };
}

function config(id: string): LotteryConfig {
  const l = LOTTERY_BY_ID[id];
  if (!l) throw new Error(`unknown lottery: ${id}`);
  return l;
}

/** Newest first, full history. */
export const getDraws = memo((id: string): DrawSummary[] => {
  config(id);
  return readJson<DrawSummary[]>(`draws/${id}.json`, []);
});

/** Oldest first, internal (model/stats) shape. */
const modelDraws = memo((id: string): Draw[] =>
  getDraws(id)
    .slice()
    .reverse()
    .map((d) => ({ draw_no: d.drawNo, draw_date: d.date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null })),
);

let fetchLog: FetchRun[] | null = null;
function getFetchLog(): FetchRun[] {
  return (fetchLog ??= readJson<FetchRun[]>("fetch-log.json", []));
}

export function getLotteries(): Lottery[] {
  return LOTTERY_META.map((m) => {
    const draws = getDraws(m.id);
    return {
      id: m.id,
      name: m.name,
      board: m.board,
      letterKind: m.letterKind,
      mainCount: m.mainCount,
      mainMin: m.mainMin,
      mainMax: m.mainMax,
      hasBonus: m.hasBonus,
      bonusLabel: m.bonusLabel,
      drawCount: draws.length,
      firstDate: draws.length ? draws[draws.length - 1].date : "",
      lastDraw: draws[0] ?? null,
    };
  });
}

export function getLottery(id: string): Lottery | null {
  return getLotteries().find((l) => l.id === id) ?? null;
}

const statsCache = new Map<string, Stats>();
export function getStats(id: string, window: StatsWindow): Stats {
  const key = `${id}:${window}`;
  if (!statsCache.has(key)) {
    const w: StatsWindow = WINDOWS.includes(window) ? window : "all";
    const all = modelDraws(id);
    const draws = w === "all" ? all : all.slice(-Number(w));
    // Same payload as the former /api/.../stats (lastSeenDrawsAgo is null for never-drawn numbers).
    statsCache.set(key, computeStats(config(id), draws, w) as unknown as Stats);
  }
  return statsCache.get(key)!;
}

/**
 * generatedAt: run_at of the newest successful fetch that inserted draws for this lottery,
 * else the newest draw date at 00:00Z. The picks themselves depend only on the draw history.
 */
function generatedAt(id: string, newest: DrawSummary): string {
  const run = getFetchLog().find((r) => r.lottery_id === id && r.status === "ok" && r.inserted > 0);
  return run?.run_at ?? `${newest.date}T00:00:00Z`;
}

export const getPrediction = memo((id: string): Prediction => {
  const draws = modelDraws(id);
  if (!draws.length) throw new Error(`no draws for lottery: ${id}`);
  return predict(config(id), draws, generatedAt(id, getDraws(id)[0])) as Prediction;
});

export function getStatus(): StatusInfo {
  const runs = getFetchLog();
  return { lastRun: runs[0]?.run_at ?? null, runs };
}
