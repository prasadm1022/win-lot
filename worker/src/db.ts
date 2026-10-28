// SPDX-License-Identifier: Apache-2.0
// D1 access helpers.

import type { Lottery } from "./lotteries";
import { predict, type Prediction } from "./model";
import type { Draw } from "./parsers";

interface DrawRow {
  draw_no: number;
  draw_date: string;
  letter: string | null;
  numbers: string;
  bonus: string | null;
}

export function rowToDraw(r: DrawRow): Draw {
  return {
    draw_no: r.draw_no,
    draw_date: r.draw_date,
    letter: r.letter,
    numbers: JSON.parse(r.numbers),
    bonus: r.bonus === null ? null : JSON.parse(r.bonus),
  };
}

export function drawToApi(d: Draw) {
  return { drawNo: d.draw_no, date: d.draw_date, letter: d.letter, numbers: d.numbers, bonus: d.bonus ?? null };
}

/** All draws oldest first, or only the newest `limit` (still returned oldest first). */
export async function loadDraws(db: D1Database, lotteryId: string, limit?: number): Promise<Draw[]> {
  const cols = "draw_no, draw_date, letter, numbers, bonus";
  const stmt = limit
    ? db
        .prepare(`SELECT * FROM (SELECT ${cols} FROM draws WHERE lottery_id = ? ORDER BY draw_no DESC LIMIT ?) ORDER BY draw_no`)
        .bind(lotteryId, limit)
    : db.prepare(`SELECT ${cols} FROM draws WHERE lottery_id = ? ORDER BY draw_no`).bind(lotteryId);
  const { results } = await stmt.all<DrawRow>();
  return results.map(rowToDraw);
}

/** INSERT OR IGNORE; returns the number of new rows. */
export async function upsertDraws(db: D1Database, lotteryId: string, draws: Draw[], fetchedAt: string): Promise<number> {
  if (!draws.length) return 0;
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO draws (lottery_id, draw_no, draw_date, letter, numbers, bonus, fetched_at) VALUES (?,?,?,?,?,?,?)",
  );
  const results = await db.batch(
    draws.map((d) =>
      stmt.bind(
        lotteryId,
        d.draw_no,
        d.draw_date,
        d.letter,
        JSON.stringify(d.numbers),
        d.bonus === null || d.bonus === undefined ? null : JSON.stringify(d.bonus),
        fetchedAt,
      ),
    ),
  );
  return results.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
}

export async function recomputePrediction(db: D1Database, lottery: Lottery, generatedAt: string): Promise<Prediction | null> {
  const draws = await loadDraws(db, lottery.id);
  if (!draws.length) return null;
  const payload = predict(lottery, draws, generatedAt);
  await db
    .prepare("INSERT OR REPLACE INTO predictions (lottery_id, generated_at, payload) VALUES (?,?,?)")
    .bind(lottery.id, generatedAt, JSON.stringify(payload))
    .run();
  return payload;
}

export async function logFetch(
  db: D1Database,
  runAt: string,
  lotteryId: string | null,
  inserted: number,
  status: "ok" | "error",
  message: string,
): Promise<void> {
  await db
    .prepare("INSERT INTO fetch_log (run_at, lottery_id, inserted, status, message) VALUES (?,?,?,?,?)")
    .bind(runAt, lotteryId, inserted, status, message.slice(0, 500))
    .run();
}
