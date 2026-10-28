// SPDX-License-Identifier: Apache-2.0
// Lottery metadata. Single source of truth: data/lotteries.json (camelCase).
// Internally the model, stats and parsers use the snake_case `Lottery` shape below.

import raw from "../data/lotteries.json";

export type Board = "NLB" | "DLB";
export type LetterKind = "none" | "letter" | "zodiac";

export interface LotteryMeta {
  id: string;
  name: string;
  board: Board;
  sourceUrl: string;
  sourceKey: string; // NLB slug or DLB lottery id
  letterKind: LetterKind;
  mainCount: number;
  mainMin: number;
  mainMax: number;
  hasBonus: boolean;
  bonusLabel: string | null;
  bonusMin: number | null;
  bonusMax: number | null;
}

export interface Lottery {
  id: string;
  name: string;
  board: Board;
  source_url: string;
  source_key: string;
  letter_kind: LetterKind;
  main_count: number;
  main_min: number;
  main_max: number;
  has_bonus: number;
  bonus_label: string | null;
  bonus_min: number | null;
  bonus_max: number | null;
}

export const LOTTERY_META = raw as LotteryMeta[];

export const LOTTERIES: Lottery[] = LOTTERY_META.map((m) => ({
  id: m.id,
  name: m.name,
  board: m.board,
  source_url: m.sourceUrl,
  source_key: m.sourceKey,
  letter_kind: m.letterKind,
  main_count: m.mainCount,
  main_min: m.mainMin,
  main_max: m.mainMax,
  has_bonus: m.hasBonus ? 1 : 0,
  bonus_label: m.bonusLabel,
  bonus_min: m.bonusMin,
  bonus_max: m.bonusMax,
}));

export const LOTTERY_BY_ID: Record<string, Lottery> = Object.fromEntries(LOTTERIES.map((l) => [l.id, l]));
