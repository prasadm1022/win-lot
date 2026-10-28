// SPDX-License-Identifier: Apache-2.0
// Jackpot (Super Prize) data: pure parsers for the NLB per-draw prize table, the NLB winners directory and
// the DLB home page NEXT JACKPOT column; the merge that builds data/jackpots.json; the docs/JACKPOT-WINS.md
// renderer. No network here (see lib/jackpot-sources.ts). Winner names/towns are never extracted (privacy).

import type { DrawSummary } from "./types";
import { parseDlbDate, parseNlbDate } from "./parsers";

export type JackpotSource = "nlb-prize-table" | "nlb-winners-directory" | "dlb-jackpot-reset";

export interface Jackpot {
  lotteryId: string;
  drawNo: number;
  date: string | null;
  letter: string | null;
  numbers: number[] | null;
  bonus: unknown | null;
  jackpotWinners: number | null;
  superPrizeAmount: number | null;
  source: JackpotSource;
  inDrawHistory: boolean;
  /** nlb-winners-directory only: the directory month page(s) listing it (YYYY-MM, or "latest"). */
  listedIn?: string[];
}

/** One row of data/prizes/<id>.json: the jackpot tier of one draw, won or not. */
export interface PrizeRow {
  drawNo: number;
  date: string | null;
  superPrizeAmount: number | null;
  superPrizeWinners: number | null;
  /** NLB: jackpot tier name ("Super Prize", "Mega Super Prize"), or "none" when NLB no longer serves the table;
   *  DLB: "advertised" = next-jackpot snapshot from the dlb.lk home page (winners unknown). */
  tier?: string;
}

export interface PrizeTier {
  name: string;
  pattern: string;
  prize: number | null; // LKR; null for non-cash prizes (e.g. motor car)
  winners: number | null;
}

export interface PrizeTable {
  date: string; // YYYY-MM-DD
  tiers: PrizeTier[];
}

const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** 'Rs. 81,540,974.00' -> 81540974, 'Rs.56,553,566.40' -> 56553566.4; no amount -> null. */
export function parseRupees(text: string): number | null {
  const m = /Rs\.?\s*(\d[\d,]*(?:\.\d+)?)/i.exec(text);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** "Prize Structure - <date>" table of an NLB per-draw page; null when the page has none (old draws). */
export function parseNlbPrizeTable(html: string): PrizeTable | null {
  const head = /Prize Structure\s*-\s*([^<]+)<\/h2>/.exec(html);
  if (!head) return null;
  const start = html.indexOf("tStruct", head.index);
  if (start < 0) return null;
  const endBox = html.indexOf('<div class="lbox"', start);
  const section = html.slice(start, endBox < 0 ? start + 20000 : endBox);
  const tiers: PrizeTier[] = [];
  const rowRe =
    /<div>\s*<div>([^<]*)<br\s*\/?>\s*<\/div>\s*<div><span>([\s\S]*?)<\/span><\/div>\s*<div class="r">([\s\S]*?)<\/div>\s*<div class="r">([\s\S]*?)<\/div>/g;
  for (const m of section.matchAll(rowRe)) {
    const winners = clean(m[4]).replace(/,/g, "");
    tiers.push({
      name: clean(m[1]),
      pattern: clean(m[2]),
      prize: parseRupees(m[3]),
      winners: /^\d+$/.test(winners) ? Number(winners) : null,
    });
  }
  return tiers.length ? { date: parseNlbDate(head[1]), tiers } : null;
}

/** The jackpot tier: the first row (Super Prize, or Mega Super Prize for Mega Power). */
export function jackpotTier(table: PrizeTable): PrizeTier | null {
  return table.tiers.find((t) => /super prize/i.test(t.name)) ?? table.tiers[0] ?? null;
}

export interface WinnerListing {
  lotteryName: string;
  drawNo: number;
  section: string; // "Super Prize Winners" | "Cash Prize Winners" | "Special Prize Winners"
  prize: string; // e.g. "Super Prize", "Rs.500,000", "Motor Car", ""
}

/** Cards of an NLB winners directory page (https://www.nlb.lk/winners[/YYYY/MM]); names/towns dropped. */
export function parseNlbWinnersDirectory(html: string): WinnerListing[] {
  const start = html.indexOf('class="winners"');
  if (start < 0) return [];
  const body = html.slice(start);
  const out: WinnerListing[] = [];
  const re = /<h2>([^<]*)<\/h2>|<\/s>\s*<div>\s*([^<]*?)\s+(\d+)\s*<br\s*\/?>\s*([^<]*?)\s*<br/g;
  let section = "";
  for (const m of body.matchAll(re)) {
    if (m[1] !== undefined) section = m[1].trim();
    else out.push({ lotteryName: m[2].trim(), drawNo: Number(m[3]), section, prize: m[4].trim() });
  }
  return out;
}

/** NLB winners directory, per lottery: drawNo -> where it is listed and the draw date when known. */
export interface DirectoryEntry {
  listedIn: string[]; // "YYYY-MM" month pages (or "latest")
  date: string | null; // from data/draws, or the "Draw No.: N Date: ..." line of the old per-draw page
}
export type Directory = Record<string, Map<number, DirectoryEntry>>;

/** "Draw No.: 2300 Date: Sunday September 14, 2025" on an NLB per-draw page (also on old, emptied pages). */
export function parseNlbDrawPageDate(html: string): { drawNo: number; date: string } | null {
  const m = /Draw No\.:\s*(\d+)\s*Date:\s*([A-Za-z]+\s+[A-Za-z]+\s+\d{1,2},\s*\d{4})/.exec(clean(html));
  return m ? { drawNo: Number(m[1]), date: parseNlbDate(m[2]) } : null;
}

/** Month links of the winners directory: ['2026/08', ..., '2014/05']. */
export function parseNlbWinnersMonths(html: string): string[] {
  return [...new Set([...html.matchAll(/href="winners\/(\d{4}\/\d{2})"/g)].map((m) => m[1]))];
}

/**
 * True for a card in the "Super Prize Winners" section that can be the jackpot: "Super Prize", "Mega Super Prize"
 * or no label. Mega Power's "Power Super Prize" (fixed Rs. 10 M) and "Grand Super Prize" (car) are not jackpots.
 */
export const isSuperPrizeListing = (w: WinnerListing) =>
  /super prize/i.test(w.section) && (w.prize === "" || /^(mega\s+)?super prize$/i.test(w.prize));

export interface DlbNextJackpot {
  drawNo: number; // latest drawn draw shown in the box
  date: string; // its date
  nextJackpot: number; // LKR at stake in draw drawNo + 1
}

/**
 * DLB home page (https://www.dlb.lk/home/en) "LATEST RESULT ... NEXT JACKPOT" box:
 * `<p class="lottery_n_d">Kapruka - 2504 | 2026-Oct-28 Wednesday</p> ... <p class="next_jkpt">Rs.397,249,249.00</p>`.
 * Keyed by lottery name. (The scrolling "today jackpot" ticker carries no draw number and is not used.)
 */
export function parseDlbNextJackpots(html: string): Record<string, DlbNextJackpot> {
  const out: Record<string, DlbNextJackpot> = {};
  for (const box of html.split('class="lottery_n_d">').slice(1)) {
    const head = /^\s*([^<]+?)\s+-\s+(\d+)\s*\|\s*([^<]+?)\s*<\/p>/.exec(box);
    const jackpot = /class="next_jkpt">([^<]*)/.exec(box);
    const amount = jackpot ? parseRupees(jackpot[1]) : null;
    if (!head || amount === null) continue;
    out[head[1].trim()] = { drawNo: Number(head[2]), date: parseDlbDate(head[3]), nextJackpot: amount };
  }
  return out;
}

/**
 * Jackpots roll over (grow or stay) until won, then restart from a base amount. Draw K's jackpot is inferred
 * as won when the amount at stake in K+1 is lower than in K AND K+2 is still below K (so a one-off typo on the
 * source page, e.g. NLB Dhana Nidhanaya 2362 "8,896,221", is not taken for a win). Any drop counts: a win soon
 * after a reset drops only slightly (Govisetha 4419: 60,502,138 -> 60,000,000). On the 621 NLB draws with a
 * prize table this finds exactly the 5 real wins and no false ones. Needs three consecutive draws, so the
 * newest draw is decided one draw later.
 */
export function inferJackpotResets(rows: PrizeRow[]): { drawNo: number; amount: number }[] {
  const amount = new Map(rows.filter((r) => r.superPrizeAmount !== null).map((r) => [r.drawNo, r.superPrizeAmount!]));
  const out: { drawNo: number; amount: number }[] = [];
  for (const [k, a] of [...amount].sort((x, y) => y[0] - x[0])) {
    const next = amount.get(k + 1);
    const after = amount.get(k + 2);
    if (next !== undefined && after !== undefined && next < a && after < a) out.push({ drawNo: k, amount: a });
  }
  return out;
}

export interface JackpotInputs {
  /** NLB: prize rows per lottery (from per-draw prize tables). */
  prizes: Record<string, PrizeRow[]>;
  /** NLB winners directory: lotteryId -> drawNo -> listing. */
  directory: Directory;
  /** DLB: advertised jackpot snapshots per lottery. */
  dlbSnapshots: Record<string, PrizeRow[]>;
  draws: Record<string, DrawSummary[]>;
}

/** Merge all sources into the jackpot list, newest first (date desc, then drawNo desc), deduped. */
export function buildJackpots(input: JackpotInputs): Jackpot[] {
  const byKey = new Map<string, Jackpot>();
  const drawIndex = (id: string) => new Map((input.draws[id] ?? []).map((d) => [d.drawNo, d]));
  const base = (id: string, drawNo: number, idx: Map<number, DrawSummary>) => {
    const d = idx.get(drawNo);
    return {
      lotteryId: id,
      drawNo,
      date: d?.date ?? null,
      letter: d?.letter ?? null,
      numbers: d ? d.numbers : null,
      bonus: d?.bonus ?? null,
      inDrawHistory: !!d,
    };
  };

  for (const [id, rows] of Object.entries(input.prizes)) {
    const idx = drawIndex(id);
    for (const r of rows) {
      if (!r.superPrizeWinners) continue;
      const b = base(id, r.drawNo, idx);
      byKey.set(`${id}#${r.drawNo}`, {
        ...b,
        date: b.date ?? r.date,
        jackpotWinners: r.superPrizeWinners,
        superPrizeAmount: r.superPrizeAmount,
        source: "nlb-prize-table",
      });
    }
  }

  for (const [id, listings] of Object.entries(input.directory)) {
    const idx = drawIndex(id);
    const checked = new Set((input.prizes[id] ?? []).filter((r) => r.superPrizeWinners !== null).map((r) => r.drawNo));
    for (const [drawNo, entry] of listings) {
      const key = `${id}#${drawNo}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.listedIn = entry.listedIn;
        continue;
      }
      // the prize table is authoritative where we have it (e.g. a Mega Power "Power Super Prize" card)
      if (checked.has(drawNo)) continue;
      // a card dated after the month page listing it has a wrong draw number (e.g. Dhana Nidhanaya "1930" on 2024-09)
      const lastMonth = entry.listedIn.filter((l) => /^\d{4}-\d{2}$/.test(l)).sort().at(-1);
      if (entry.date && lastMonth && entry.date.slice(0, 7) > lastMonth) continue;
      const b = base(id, drawNo, idx);
      byKey.set(key, {
        ...b,
        date: b.date ?? entry.date,
        jackpotWinners: null,
        superPrizeAmount: null,
        source: "nlb-winners-directory",
        listedIn: entry.listedIn,
      });
    }
  }

  for (const [id, rows] of Object.entries(input.dlbSnapshots)) {
    const idx = drawIndex(id);
    for (const { drawNo, amount } of inferJackpotResets(rows)) {
      const key = `${id}#${drawNo}`;
      if (byKey.has(key)) continue;
      byKey.set(key, { ...base(id, drawNo, idx), jackpotWinners: null, superPrizeAmount: amount, source: "dlb-jackpot-reset" });
    }
  }

  return [...byKey.values()].sort(
    (a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.lotteryId.localeCompare(b.lotteryId) || b.drawNo - a.drawNo,
  );
}

const fmtAmount = (n: number | null) =>
  n === null ? "-" : `Rs. ${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

function fmtNumbers(j: Jackpot): string {
  if (!j.numbers) return "- (draw older than our archive)";
  const main = [j.letter, ...j.numbers.map((n) => String(n).padStart(2, "0"))].filter(Boolean).join(" ");
  const b = j.bonus as { label?: string; digits?: number[] } | number | null;
  if (b === null || b === undefined) return main;
  return typeof b === "object" ? `${main} (${b.label ?? "bonus"} ${b.digits?.join("") ?? ""})` : `${main} + ${b}`;
}

export interface DocLottery {
  id: string;
  name: string;
  board: string;
  prizes: PrizeRow[];
  firstDate: string | null; // our draw archive
  lastDate: string | null;
}

/** Single-draw dips in the published NLB amounts (typos such as "8,896,221" for ~89 M), oldest first. */
function suspiciousAmounts(rows: PrizeRow[]): PrizeRow[] {
  const asc = rows.filter((r) => r.superPrizeAmount !== null).sort((a, b) => a.drawNo - b.drawNo);
  return asc.filter((r, i) => {
    const prev = asc[i - 1]?.superPrizeAmount;
    const next = asc[i + 1]?.superPrizeAmount;
    return prev && next && !asc[i - 1].superPrizeWinners && r.superPrizeAmount! < prev * 0.5 && next > prev * 0.9;
  });
}

const span = (dates: string[]) => (dates.length ? `${dates.at(-1)} to ${dates[0]}` : "-");

/** Markdown for docs/JACKPOT-WINS.md (deterministic for the same data). */
export function renderJackpotDoc(jackpots: Jackpot[], lotteries: DocLottery[]): string {
  const asOf = lotteries.map((l) => l.lastDate ?? "").sort().at(-1) || "?";
  const out: string[] = [
    "# Jackpot (Super Prize) wins",
    "",
    `Snapshot as of ${asOf}, generated by \`npm run jackpots\` from \`data/jackpots.json\` (that file is also`,
    "refreshed by the daily `npm run update`). Do not edit by hand.",
    "",
    "Only draws where the top prize was actually won are listed: NLB *Super Prize* (Mega Power: *Mega Super Prize*),",
    "DLB *Super Prize* (jackpot). Winner names and towns are deliberately not stored.",
    "",
    "## Summary",
    "",
    "| Lottery | Board | Jackpot wins listed | Checked draw by draw | Won in checked draws | Older wins (winners directory) " +
      "| Notes |",
    "|---|---|---|---|---|---|---|",
  ];
  const notes: string[] = [];
  for (const l of lotteries) {
    const own = jackpots.filter((j) => j.lotteryId === l.id);
    const checked = l.prizes.filter((p) => p.tier !== "advertised" && p.superPrizeWinners !== null);
    const tableWins = own.filter((j) => j.source === "nlb-prize-table");
    const dir = own.filter((j) => j.source === "nlb-winners-directory");
    const dirDates = dir.flatMap((j) => (j.date ? [j.date] : []));
    const undated = dir.length - dirDates.length;
    let note = "";
    if (l.board === "NLB") {
      if (checked.length && !tableWins.length) {
        const [first, last] = [checked.at(-1)!, checked[0]];
        note = `not won since ${first.date}: grew from ${fmtAmount(first.superPrizeAmount)} to ${fmtAmount(last.superPrizeAmount)}`;
      }
      for (const r of suspiciousAmounts(l.prizes)) {
        notes.push(
          `- ${l.name} draw ${r.drawNo} (${r.date}): NLB publishes a jackpot of ${fmtAmount(r.superPrizeAmount)}, ` +
            "an obvious typo (the draws around it are ~10x higher); kept as published.",
        );
      }
    } else {
      const snaps = l.prizes.filter((p) => p.tier === "advertised");
      const resets = own.filter((j) => j.source === "dlb-jackpot-reset").length;
      note = snaps.length
        ? `${resets} inferred from ${snaps.length} next-jackpot snapshot(s) since draw ${snaps.at(-1)!.drawNo}; ` +
          `now ${fmtAmount(snaps[0].superPrizeAmount)}`
        : "no snapshots yet";
    }
    const cells = [
      l.name,
      l.board,
      own.length,
      checked.length
        ? `${checked.length} draws, ${checked.at(-1)!.date} to ${checked[0].date}`
        : "not possible (prizes only as images)",
      l.board === "NLB" ? tableWins.length : "-",
      l.board === "NLB" ? `${dir.length} (${span(dirDates)}${undated ? `, ${undated} undated` : ""})` : "-",
      note || "-",
    ];
    out.push(`| ${cells.join(" | ")} |`);
  }
  out.push(
    "",
    "Sources:",
    "- `nlb-prize-table`: the *Prize Structure* table of `https://www.nlb.lk/results/<slug>/<drawNo>`; winners > 0 on the",
    "  jackpot row. Exact (winners count and amount), but NLB only serves it for its latest ~208 draws per lottery.",
    "- `nlb-winners-directory`: *Super Prize* cards on `https://www.nlb.lk/winners[/YYYY/MM]` (2014 onwards). No numbers",
    "  or amount; the date comes from the emptied NLB page of that draw (missing for the oldest draws). Mega Power cards",
    "  labelled *Power Super Prize* (fixed Rs. 10 M tier) are excluded; cards labelled just *Super Prize* are kept but may",
    "  also be that tier. A card dated after the month page listing it (wrong draw number on the card) is dropped.",
    "- `dlb-jackpot-reset`: DLB jackpots grow every draw until won. From the *NEXT JACKPOT* column of",
    "  `https://www.dlb.lk/home/en`, snapshotted daily, draw K counts as won when the jackpot of K+1 is lower than K's",
    "  and K+2 is still below K's (inferred; DLB has no text winners list). Tried on the NLB prize tables, this rule",
    "  finds exactly the real wins.",
    "",
    "## Gaps and limitations",
    "",
    "- NLB: exact data only for the draws NLB still serves (see *Checked draw by draw*; it grows daily). Older wins come",
    "  only from the publicity cards, which show only winners who came forward, so earlier years are incomplete, and",
    "  their winning numbers are unknown (NLB empties old draw pages and our NLB archive starts 2026-03-27).",
    "- DLB: no history at all. Its per-draw prize table is only an image (`front_img/*_PRIZE_<date>_<draw>.PNG`, not",
    "  OCR'd) and its news releases about cheque ceremonies name jackpot wins without draw numbers. Wins are inferred",
    "  from the first snapshot on, one draw late, without the number of winners.",
    ...notes,
    "",
  );
  for (const l of lotteries) {
    const own = jackpots.filter((j) => j.lotteryId === l.id);
    out.push(`## ${l.name} (${l.board})`, "");
    if (!own.length) {
      out.push("No jackpot win found in the available sources.", "");
      continue;
    }
    out.push("| Date | Draw | Winning letter + numbers | Winners | Jackpot amount | Source |", "|---|---|---|---|---|---|");
    for (const j of own) {
      const date = j.date ?? `? (card listed ${j.listedIn?.join(", ") ?? "?"})`;
      const cells = [date, j.drawNo, fmtNumbers(j), j.jackpotWinners ?? "?", fmtAmount(j.superPrizeAmount), j.source];
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}
