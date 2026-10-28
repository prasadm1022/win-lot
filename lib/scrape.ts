// SPDX-License-Identifier: Apache-2.0
// Network scraping of NLB and DLB result pages (Node 22: global fetch). No storage here;
// scripts/update.ts merges the results into data/draws/<id>.json.

import type { Lottery } from "./lotteries";
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url: string, init: RequestInit = {}, cookie?: string): Promise<string> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", USER_AGENT);
  if (cookie) headers.set("Cookie", cookie);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** GET an NLB page, answering the `human` cookie challenge (it changes per request/URL). */
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

/** Memoized fetch of the DLB page listing the latest draw (and its resultID) of every DLB lottery. */
export function dlbLatestLoader(): () => Promise<Record<string, RawDraw>> {
  let cache: Promise<Record<string, RawDraw>> | null = null;
  return () => (cache ??= fetchText(DLB_LATEST).then(parseDlbLatest));
}

async function dlbPage(lottery: Lottery, resultId: string, pageId: number): Promise<RawDraw[]> {
  const body = new URLSearchParams({
    pageId: String(pageId),
    resultID: resultId,
    lotteryID: lottery.source_key,
    lastsegment: lottery.source_key,
  });
  return parseDlbPage(
    await fetchText(DLB_PAGINATION, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  );
}

export interface ScrapeOptions {
  /** DLB only: number of pagination pages to read (default 1 = latest ~12 draws). */
  dlbPages?: number;
  /** DLB only: stop paging once a page contains no draw_no in this set. */
  known?: Set<number>;
}

/** Scrape the latest page(s) of one lottery; returns normalized draws (any order). */
export async function scrapeLottery(
  lottery: Lottery,
  dlbLatest: () => Promise<Record<string, RawDraw>>,
  opts: ScrapeOptions = {},
): Promise<{ draws: Draw[]; raw: number }> {
  let raw: RawDraw[];
  if (lottery.board === "NLB") {
    raw = parseNlb(await fetchNlb(lottery.source_url));
  } else {
    const top = (await dlbLatest())[lottery.source_key];
    raw = top ? [top] : [];
    const seen = new Set(raw.map((r) => r.draw_no));
    const pages = Math.max(1, opts.dlbPages ?? 1);
    for (let p = 0; p < pages; p++) {
      await sleep(500);
      const rows = (await dlbPage(lottery, top?.result_id ?? "", p)).filter((r) => !seen.has(r.draw_no));
      if (!rows.length) break;
      rows.forEach((r) => seen.add(r.draw_no));
      raw.push(...rows);
      if (p > 0 && opts.known && rows.every((r) => opts.known!.has(r.draw_no))) break;
    }
  }
  const draws = raw.map((r) => normalize(lottery, r)).filter((d): d is Draw => d !== null);
  return { draws, raw: raw.length };
}
