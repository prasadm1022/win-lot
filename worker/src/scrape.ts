// SPDX-License-Identifier: Apache-2.0
// Daily refresh: fetch the latest page of every lottery, upsert new draws, recompute predictions.

import { logFetch, recomputePrediction, upsertDraws } from "./db";
import { LOTTERIES, type Lottery } from "./lotteries";
import {
  normalize,
  parseDlbLatest,
  parseDlbPage,
  parseNlb,
  solveCookieChallenge,
  type Draw,
  type RawDraw,
} from "./parsers";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 win-lot";
const DLB_PAGINATION = "https://www.dlb.lk/result/pagination_re";
const DLB_LATEST = "https://www.dlb.lk/result/11/"; // any DLB result page lists the latest draw of every DLB lottery

export interface RefreshResult {
  lotteryId: string;
  inserted: number;
  status: "ok" | "error";
  message: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, init: RequestInit = {}, cookie?: string): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  if (cookie) headers.set("Cookie", cookie);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** GET an NLB page, answering the `human` cookie challenge when served. */
export async function fetchNlb(url: string): Promise<string> {
  let cookie: string | undefined;
  for (let round = 0; round < 3; round++) {
    const html = await fetchText(url, {}, cookie);
    const challenge = solveCookieChallenge(html);
    if (!challenge) return html;
    cookie = `human=${challenge}`;
  }
  throw new Error(`NLB cookie challenge not solved for ${url}`);
}

async function scrapeLottery(lottery: Lottery, dlbLatest: () => Promise<Record<string, RawDraw>>): Promise<RawDraw[]> {
  if (lottery.board === "NLB") return parseNlb(await fetchNlb(lottery.source_url));
  const latest = await dlbLatest();
  const top = latest[lottery.source_key];
  const body = new URLSearchParams({
    pageId: "0",
    resultID: top?.result_id ?? "",
    lotteryID: lottery.source_key,
    lastsegment: lottery.source_key,
  });
  await sleep(500);
  const page = parseDlbPage(
    await fetchText(DLB_PAGINATION, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
  return top ? [top, ...page] : page;
}

export async function refreshAll(db: D1Database, only?: string[]): Promise<RefreshResult[]> {
  const runAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let dlbCache: Promise<Record<string, RawDraw>> | null = null;
  const dlbLatest = () => (dlbCache ??= fetchText(DLB_LATEST).then(parseDlbLatest));
  const results: RefreshResult[] = [];

  for (const lottery of LOTTERIES.filter((l) => !only || only.includes(l.id))) {
    try {
      const raw = await scrapeLottery(lottery, dlbLatest);
      const draws = raw.map((r) => normalize(lottery, r)).filter((d): d is Draw => d !== null);
      if (!draws.length) throw new Error(`no draws parsed (raw rows: ${raw.length}) - markup may have changed`);
      const inserted = await upsertDraws(db, lottery.id, draws, runAt);
      const hasPrediction = await db.prepare("SELECT 1 FROM predictions WHERE lottery_id = ?").bind(lottery.id).first();
      if (inserted > 0 || !hasPrediction) await recomputePrediction(db, lottery, runAt);
      const newest = Math.max(...draws.map((d) => d.draw_no));
      const message = `parsed ${draws.length}, newest #${newest}${inserted ? ", prediction recomputed" : ""}`;
      await logFetch(db, runAt, lottery.id, inserted, "ok", message);
      results.push({ lotteryId: lottery.id, inserted, status: "ok", message });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logFetch(db, runAt, lottery.id, 0, "error", message);
      results.push({ lotteryId: lottery.id, inserted: 0, status: "error", message });
    }
    await sleep(500);
  }
  return results;
}
