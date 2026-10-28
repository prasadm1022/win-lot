// Lottery metadata. Mirrors scraper/lotteries.py and the `lotteries` D1 table (seed/0000_lotteries.sql).

export type Board = "NLB" | "DLB";
export type LetterKind = "none" | "letter" | "zodiac";

export interface Lottery {
  id: string;
  name: string;
  board: Board;
  source_url: string;
  source_key: string; // NLB slug or DLB lottery id
  letter_kind: LetterKind;
  main_count: number;
  main_min: number;
  main_max: number;
  has_bonus: number;
  bonus_label: string | null;
  bonus_min: number | null;
  bonus_max: number | null;
}

const base = { letter_kind: "letter" as LetterKind, main_count: 4, main_min: 1, main_max: 80 };
const noBonus = { has_bonus: 0, bonus_label: null, bonus_min: null, bonus_max: null };

export const LOTTERIES: Lottery[] = [
  {
    id: "dhana-nidhanaya", name: "Dhana Nidhanaya", board: "NLB",
    source_url: "https://www.nlb.lk/results/dhana-nidhanaya", source_key: "dhana-nidhanaya",
    ...base, main_max: 82, has_bonus: 1, bonus_label: "Sunday Bonus", bonus_min: 0, bonus_max: 9,
  },
  {
    id: "mega-power", name: "Mega Power", board: "NLB",
    source_url: "https://www.nlb.lk/results/mega-power", source_key: "mega-power",
    ...base, has_bonus: 1, bonus_label: "Super Number", bonus_min: 1, bonus_max: 26,
  },
  {
    id: "govisetha", name: "Govisetha", board: "NLB",
    source_url: "https://www.nlb.lk/results/govisetha", source_key: "govisetha",
    ...base, ...noBonus,
  },
  {
    id: "ada-kotipathi", name: "Ada Kotipathi", board: "DLB",
    source_url: "https://www.dlb.lk/result/11/", source_key: "11",
    ...base, ...noBonus,
  },
  {
    id: "super-ball", name: "Super Ball", board: "DLB",
    source_url: "https://www.dlb.lk/result/3/", source_key: "3",
    ...base, ...noBonus,
  },
  {
    id: "shanida", name: "Shanida", board: "DLB",
    source_url: "https://www.dlb.lk/result/1/", source_key: "1",
    ...base, ...noBonus,
  },
  {
    id: "kapruka", name: "Kapruka", board: "DLB",
    source_url: "https://www.dlb.lk/result/12/", source_key: "12",
    ...base, has_bonus: 1, bonus_label: "Bonus Number", bonus_min: 1, bonus_max: 40,
  },
];

export const LOTTERY_BY_ID: Record<string, Lottery> = Object.fromEntries(LOTTERIES.map((l) => [l.id, l]));
