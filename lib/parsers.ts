// SPDX-License-Identifier: Apache-2.0
// HTML parsers for NLB and DLB result pages. Regex port of scraper/parsers.py (no DOM dependency).

import type { Lottery } from "./lotteries";

export interface RawDraw {
  draw_no: number;
  draw_date: string; // YYYY-MM-DD
  letter: string | null;
  numbers: number[];
  extra: Record<string, unknown>;
  result_id?: string;
}

export interface Draw {
  draw_no: number;
  draw_date: string;
  letter: string | null;
  numbers: number[];
  bonus: unknown | null;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function isoDate(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** 'Tuesday October 27, 2026' -> '2026-10-27' */
export function parseNlbDate(text: string): string {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(text);
  const month = m ? MONTHS[m[1].slice(0, 3).toLowerCase()] : undefined;
  if (!m || !month) throw new Error(`unparseable NLB date: ${text}`);
  return isoDate(Number(m[3]), month, Number(m[2]));
}

/** '2026-Oct-15 Thursday' -> '2026-10-15' */
export function parseDlbDate(text: string): string {
  const m = /(\d{4})-([A-Za-z]{3})-(\d{1,2})/.exec(text);
  const month = m ? MONTHS[m[2].toLowerCase()] : undefined;
  if (!m || !month) throw new Error(`unparseable DLB date: ${text}`);
  return isoDate(Number(m[1]), month, Number(m[3]));
}

/** NLB cookie challenge: returns the `human` cookie value if `html` is the challenge page. */
export function solveCookieChallenge(html: string): string | null {
  if (html.length > 5000) return null;
  const m = /setCookie\('human','([0-9a-f]+)'/.exec(html);
  return m ? m[1] : null;
}

/** Rows of the NLB results table (`table.tbl`). */
export function parseNlb(html: string): RawDraw[] {
  const start = html.indexOf('class="w0 tbl"');
  if (start < 0) return [];
  const end = html.indexOf("</table>", start);
  const table = html.slice(start, end < 0 ? undefined : end);
  const rows: RawDraw[] = [];
  for (const tr of table.split(/<tr[\s>]/).slice(1)) {
    const head = /<b>(\d+)<\/b>\s*<br\s*\/?>([^<]*)/.exec(tr);
    if (!head) continue;
    const draw: RawDraw = {
      draw_no: Number(head[1]),
      draw_date: parseNlbDate(head[2]),
      letter: null,
      numbers: [],
      extra: {},
    };
    const listRe = /(?:<span>([^<]*)<\/span>\s*)?<ol class="B">([\s\S]*?)<\/ol>/g;
    let list: RegExpExecArray | null;
    let index = 0;
    while ((list = listRe.exec(tr))) {
      const items = [...list[2].matchAll(/<li\b[^>]*?title="([^"]*)"[^>]*>([^<]*)<\/li>/g)].map((m) => ({
        title: m[1].trim(),
        value: m[2].trim(),
      }));
      if (index === 0) {
        for (const { title, value } of items) {
          if (title === "Letter") draw.letter = value;
          else if (title.startsWith("Number-")) draw.numbers.push(Number(value));
          else if (value) draw.extra[title] = /^\d+$/.test(value) ? Number(value) : value;
        }
      } else {
        const label = list[1]?.trim() || "Extra";
        draw.extra[label] = items.filter((i) => /^\d+$/.test(i.value)).map((i) => Number(i.value));
      }
      index++;
    }
    rows.push(draw);
  }
  return rows;
}

/** Rows of a DLB `result/pagination_re` fragment. */
export function parseDlbPage(html: string): RawDraw[] {
  const rows: RawDraw[] = [];
  for (const tr of html.split(/<tr[\s>]/).slice(1)) {
    const tds = tr.split(/<td[\s>]/).slice(1);
    if (tds.length < 3) continue;
    const head = /(\d+)\s*\|\s*(\d{4}-[A-Za-z]{3}-\d{1,2})/.exec(stripTags("<td " + tds[0]));
    if (!head) continue;
    const draw: RawDraw = {
      draw_no: Number(head[1]),
      draw_date: parseDlbDate(head[2]),
      letter: null,
      numbers: [],
      extra: {},
    };
    for (const m of tds[2].matchAll(/<li(?:\s+class="([^"]*)")?[^>]*>([\s\S]*?)<\/li>/g)) {
      const cls = m[1] ?? "";
      const value = stripTags(m[2]);
      if (!value) continue;
      if (cls.includes("letter")) draw.letter = value;
      else if (cls.includes("res_number")) draw.numbers.push(Number(value));
      else draw.extra[cls || "other"] = value;
    }
    rows.push(draw);
  }
  return rows;
}

/** Latest draw of every lottery on a DLB `/result/<id>/` page, keyed by DLB lottery id. */
export function parseDlbLatest(html: string): Record<string, RawDraw> {
  const out: Record<string, RawDraw> = {};
  for (const block of html.split("lot_main_result").slice(1)) {
    const rid = /id="resultID(\d+)"\s+value="(\d+)"/.exec(block);
    const head = /Draw Number - (\d+)\s*\|\s*([^<]+)/.exec(block);
    if (!rid || !head) continue;
    const draw: RawDraw = {
      draw_no: Number(head[1]),
      draw_date: parseDlbDate(head[2]),
      letter: null,
      numbers: [],
      extra: {},
      result_id: rid[2],
    };
    for (const m of block.matchAll(/<h6 class="([^"]*)"[^>]*>\s*([^<]*?)\s*<\/h6>/g)) {
      const [, cls, value] = m;
      if (!value) continue;
      if (cls.includes("letter")) draw.letter = value;
      else if (/^\d+$/.test(value)) draw.numbers.push(Number(value));
    }
    out[rid[1]] = draw;
  }
  return out;
}

/** Map a raw row onto the lottery's format; null if malformed. Same rules as scraper/parsers.py. */
export function normalize(lottery: Lottery, raw: RawDraw): Draw | null {
  const numbers = [...raw.numbers];
  let bonus: unknown = null;
  if (lottery.id === "mega-power") {
    bonus = raw.extra["Super Number"] ?? null;
  } else if (lottery.id === "kapruka") {
    if (numbers.length === lottery.main_count + 1) bonus = numbers.pop()!;
  } else if (lottery.id === "dhana-nidhanaya") {
    const digits = raw.extra["Sunday Bonus"];
    if (Array.isArray(digits) && digits.length) bonus = { label: "Sunday Bonus", digits };
  }
  if (numbers.length !== lottery.main_count) return null;
  if (numbers.some((n) => !Number.isInteger(n))) return null;
  if (lottery.letter_kind !== "none" && !raw.letter) return null;
  return { draw_no: raw.draw_no, draw_date: raw.draw_date, letter: raw.letter ? raw.letter.toUpperCase() : null, numbers, bonus };
}
