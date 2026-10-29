// SPDX-License-Identifier: Apache-2.0
// The single availability rule for jackpot evidence (docs/MODEL-V2.md section 2.4). Used by the build, the
// backtest, lib/data.ts and the tests, so production and the walk-forward can never disagree. Pure: no fs.

import type { Jackpot, JackpotSource } from "../jackpots";
import { V2_CONSTANTS } from "./constants";

/** The draw fields needed to resolve when a DLB inferred win became known. */
export interface DatedDraw {
  drawNo: number;
  date: string;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Last day of a "YYYY-MM" month. */
function monthEnd(ym: string): string {
  return new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
}

/**
 * Earliest date (ISO) on which a jackpot win was public, or null if it can never be used. This is a publication
 * rule, not the date our scraper first saw the item (data/jackpots.json is rebuilt in full).
 * - nlb-prize-table: date + PRIZE_TABLE_LAG_DAYS
 * - nlb-winners-directory: max(date, last day of the earliest "YYYY-MM" listing month); no month: date + lag
 * - dlb-jackpot-reset: date of this lottery's draw number drawNo + 2 (by number, not +2 days); null until archived
 * - undated item or unknown source: null
 */
export function knownFrom(
  item: Pick<Jackpot, "drawNo" | "date" | "source" | "listedIn">,
  drawsOfLottery: readonly DatedDraw[],
): string | null {
  if (!item.date) return null;
  const lag = V2_CONSTANTS.PRIZE_TABLE_LAG_DAYS;
  switch (item.source) {
    case "nlb-prize-table":
      return addDays(item.date, lag);
    case "nlb-winners-directory": {
      const months = (item.listedIn ?? []).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
      if (!months.length) return addDays(item.date, lag);
      const end = monthEnd(months[0]);
      return end > item.date ? end : item.date;
    }
    case "dlb-jackpot-reset":
      return drawsOfLottery.find((d) => d.drawNo === item.drawNo + 2)?.date ?? null;
    default:
      return null;
  }
}

/** An item is usable for a draw on date `tau` only if it was known strictly before it (plain ISO comparison). */
export function usableAt(known: string | null, tau: string): boolean {
  return known !== null && known < tau;
}

// ---------------------------------------------------------------- own items, usable sets, partition rule

/** One jackpot item of this lottery, resolved against its draw archive once per context. */
export interface OwnItem {
  drawNo: number;
  date: string | null;
  letter: string | null;
  /** Winning numbers, ascending; null when they are unknown (win older than the archive). */
  numbers: number[] | null;
  /** Integer bonus only (Mega Power Super Number, Kapruka bonus); anything else is null. */
  bonus: number | null;
  source: JackpotSource;
  listedIn: string[] | null;
  knownFrom: string | null;
  /** Archive index of the jackpot draw (draws oldest first), or -1 when it is not in the archive. */
  index: number;
}

/**
 * The lottery's own jackpot items in canonical order (drawNo ascending, then date, then source). Items of other
 * lotteries are never used: there is no borrowing across lotteries or boards (spec 2.4).
 */
export function ownItems(lotteryId: string, jackpots: readonly Jackpot[], draws: readonly DatedDraw[]): OwnItem[] {
  const indexByNo = new Map<number, number>();
  draws.forEach((d, i) => indexByNo.set(d.drawNo, i));
  return jackpots
    .filter((j) => j.lotteryId === lotteryId)
    .map((j) => ({
      drawNo: j.drawNo,
      date: j.date,
      letter: j.letter,
      numbers: j.numbers ? [...j.numbers].sort((a, b) => a - b) : null,
      bonus: Number.isInteger(j.bonus) ? (j.bonus as number) : null,
      source: j.source,
      listedIn: j.listedIn ? [...j.listedIn] : null,
      knownFrom: knownFrom(j, draws),
      index: indexByNo.get(j.drawNo) ?? -1,
    }))
    .sort((a, b) => a.drawNo - b.drawNo || cmp(a.date ?? "", b.date ?? "") || cmp(a.source, b.source));
}

/** Plain code-unit string order (never localeCompare: the build must not depend on the locale). */
export function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Evidence usable at walk-forward step t for a draw on date tau (spec 2.4). */
export interface EvidenceAt {
  /** 𝒥_t: usable items with winning numbers (jackpot-winning combinations), canonical order. */
  combinations: OwnItem[];
  /** 𝒯_t: usable items with a date (jackpot-winning dates, including those of the combinations). */
  dates: OwnItem[];
  /** X_t: archive indices below t of the 𝒥_t draws, ascending. They count once, as combinations, never as daily draws. */
  excluded: number[];
}

export function evidenceAt(items: readonly OwnItem[], t: number, tau: string): EvidenceAt {
  const usable = items.filter((it) => usableAt(it.knownFrom, tau));
  const combinations = usable.filter((it) => it.numbers !== null);
  const dates = usable.filter((it) => it.date !== null);
  const excluded = combinations
    .map((it) => it.index)
    .filter((i) => i >= 0 && i < t)
    .sort((a, b) => a - b)
    .filter((i, q, arr) => q === 0 || arr[q - 1] !== i);
  return { combinations, dates, excluded };
}

/**
 * The daily pool 𝒫_t = { i : start <= i < t, i not in X_t } (partition rule: a draw counts once, at its highest tier).
 * Before a jackpot becomes usable its draw is an ordinary daily draw; once usable it moves to the combinations.
 */
export function dailyPool(start: number, t: number, excluded: readonly number[]): number[] {
  const pool: number[] = [];
  let q = 0;
  for (let i = start; i < t; i++) {
    while (q < excluded.length && excluded[q] < i) q++;
    if (q < excluded.length && excluded[q] === i) continue;
    pool.push(i);
  }
  return pool;
}

/** Items that are dated but not usable yet at tau (DLB resets wait for draw K+2: knownFrom null until it exists). */
export function pendingItems(
  items: readonly OwnItem[],
  tau: string,
): { drawNo: number; date: string | null; knownFrom: string | null }[] {
  return items
    .filter(
      (it) =>
        it.date !== null &&
        !usableAt(it.knownFrom, tau) &&
        (it.knownFrom !== null || it.source === "dlb-jackpot-reset"),
    )
    .map((it) => ({ drawNo: it.drawNo, date: it.date, knownFrom: it.knownFrom }));
}

/** The `evidence.used` list: every usable item, as a combination when its numbers are known, else as a date. */
export function usedItems(ev: EvidenceAt): {
  drawNo: number;
  date: string | null;
  kind: "combination" | "date";
  source: JackpotSource;
  knownFrom: string;
}[] {
  return ev.dates.map((it) => ({
    drawNo: it.drawNo,
    date: it.date,
    kind: it.numbers !== null ? ("combination" as const) : ("date" as const),
    source: it.source,
    knownFrom: it.knownFrom as string,
  }));
}

/** Evidence counts of the payload (`evidence.counts`, spec 3.3). */
export interface EvidenceCounts {
  jackpotCombinations: { used: number; known: number };
  jackpotDates: { used: number; known: number; undated: number; olderThanArchive: number; clusters: number; effective: number };
  dailyDraws: { used: number; total: number; since: string; excludedAsJackpot: number };
}

export function evidenceCounts(
  items: readonly OwnItem[],
  ev: EvidenceAt,
  archiveStart: string | null,
  calendar: { clusters: number; effective: number },
  daily: { used: number; total: number; since: string; excludedAsJackpot: number },
): EvidenceCounts {
  return {
    jackpotCombinations: {
      used: ev.combinations.length,
      known: items.filter((it) => it.numbers !== null).length,
    },
    jackpotDates: {
      used: ev.dates.length,
      known: items.filter((it) => it.date !== null).length,
      undated: items.filter((it) => it.date === null).length,
      olderThanArchive: ev.dates.filter((it) => archiveStart !== null && (it.date as string) < archiveStart).length,
      clusters: calendar.clusters,
      effective: calendar.effective,
    },
    dailyDraws: daily,
  };
}
