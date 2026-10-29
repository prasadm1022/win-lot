// SPDX-License-Identifier: Apache-2.0
// Data shapes produced by lib/data.ts at build time (same as the former API contract, plus the additive
// jackpot and model v2 fields of docs/MODEL-V2.md section 3).

import type { JackpotSource } from './jackpots'

export type { JackpotSource }

export type Board = 'NLB' | 'DLB'
export type LetterKind = 'none' | 'letter' | 'zodiac'

/** Jackpot (Super Prize) won on this draw. */
export interface DrawJackpot {
  winners: number | null // jackpotWinners (null for DLB inferred wins)
  amount: number | null // superPrizeAmount (LKR)
  source: JackpotSource
}

export interface DrawSummary {
  drawNo: number
  date: string // YYYY-MM-DD
  letter: string | null
  numbers: number[]
  bonus: unknown | null
  /** Only on draws of THIS lottery whose jackpot was won (data/jackpots.json joined on lotteryId + drawNo).
   *  A fact, so it is not gated by knownFrom. Never set from another lottery's jackpot. */
  jackpot?: DrawJackpot
}

export interface Lottery {
  id: string
  name: string
  board: Board
  letterKind: LetterKind
  mainCount: number
  mainMin: number
  mainMax: number
  hasBonus: boolean
  bonusLabel: string | null
  drawCount: number
  firstDate: string
  lastDraw: DrawSummary | null
}

export interface DrawsPage {
  total: number
  draws: DrawSummary[]
}

export type StatsWindow = 'all' | '500' | '100'

export interface Stats {
  lotteryId: string
  window: StatsWindow
  drawCount: number
  frequency: { n: number; count: number; lastSeenDrawsAgo: number | null; expectedGap: number }[] // null: never drawn in the window
  hot: number[]
  cold: number[]
  overdue: number[]
  letterFrequency: { letter: string; count: number }[]
  sumSeries: { drawNo: number; date: string; sum: number }[]
  oddEven: { odd: number; even: number; count: number }[]
  highLow: { high: number; low: number; count: number }[]
  pairs: { a: number; b: number; count: number }[]
  positionHeat: number[][]
}

// ---- Jackpot wins (docs/MODEL-V2.md section 3.2) ----

export interface JackpotWin {
  drawNo: number
  date: string | null
  letter: string | null
  numbers: number[] | null
  bonus: unknown | null
  winners: number | null
  amount: number | null
  source: JackpotSource
  inArchive: boolean // = inDrawHistory
  listedIn?: string[]
  knownFrom: string | null // knownFrom() of lib/model-v2/evidence.ts (the single shared rule)
  usedAs: ('combination' | 'date')[] // how v2 uses it for the NEXT draw ([] = undated or not known yet)
}

export interface JackpotStatus {
  lotteryId: string
  wins: JackpotWin[] // own lottery only, newest first (all sources, including undated)
  lastWin: { drawNo: number; date: string | null; inArchive: boolean } | null
  drawsSinceLastWin: number | null // latest drawNo - lastWin.drawNo (draw numbers are consecutive)
  daysSinceLastWin: number | null // latest draw date - lastWin.date
  current: { amount: number; drawNo: number; date: string | null; kind: 'last-draw' | 'advertised-next' } | null
  // Jackpot outcome of the newest archived draw: 'won' (marked jackpot draw or prize row with winners), 'not-won' (NLB prize
  // row with 0 winners: it rolls over), 'unknown' (no prize row with a winners count yet; always for DLB). Never guess 'not-won'.
  latestDraw: { drawNo: number; date: string; outcome: 'won' | 'not-won' | 'unknown' } | null
  checked: { draws: number; wins: number; from: string | null; to: string | null } | null // NLB rows with a known winners count
  notes: string[] // DLB inference lag, older wins without numbers, known amount typos
}

// ---- Predictions (v1 fields unchanged; v2 fields optional, docs/MODEL-V2.md section 3.3) ----

export type EvidenceSource = 'jackpotCombinations' | 'jackpotDates' | 'dailyDraws'
/** Per evidence source; 0 for an absent source (its share is never redistributed). */
export type SourceSplit = Record<EvidenceSource, number>

export interface PredictionSet {
  label: string
  letter: string | null
  numbers: number[]
  bonus: unknown | null
  score: number // 0..1
  // v2 only
  source?: 'all' | EvidenceSource | 'luckyDip'
  parts?: SourceSplit // pattern points per source (lean units, not probabilities)
  orderHeld?: boolean // parts follow J >= T >= D over present sources (claimed for the Top pick only)
  pastJackpotNumbers?: number // numbers shared with the union of usable own jackpot combinations
  maxSharedWithOneJackpot?: number
  note?: string
}

export interface CalendarFeature {
  feature: 'moonPhase' | 'dayOfMonth' | 'weekday'
  strength: number // von Mises kappa; 0 = switched off
  peak: string // plain language, e.g. "about 2 days before the full moon"
  rayleighP: number
  holmP: number
}

export interface PredictionEvidence {
  status: 'combinations' | 'dates-only' | 'none'
  asOf: string // = nextDrawDate; evidence known strictly before it
  counts: {
    jackpotCombinations: { used: number; known: number }
    jackpotDates: { used: number; known: number; undated: number; olderThanArchive: number; clusters: number; effective: number }
    dailyDraws: { used: number; total: number; since: string; excludedAsJackpot: number }
  }
  mass: SourceSplit // pseudo-draws spent before damping
  used: { drawNo: number; date: string | null; kind: 'combination' | 'date'; source: JackpotSource; knownFrom: string }[]
  pending: { drawNo: number; date: string | null; knownFrom: string | null }[]
  calendar: CalendarFeature[] | null
  calendarEss: number | null
  guard: { perCombination: number; union: number; excludedShare: number }
}

/** lean - 1 = j + t + d exactly (parts per source). */
export interface SourceLean {
  lean: number
  j: number
  t: number
  d: number
}

/** Mean main-number hits per draw with its 95% interval. */
export interface HitStat {
  avgHits: number
  lo: number
  hi: number
}

/** Walk-forward backtest of the v2 Top pick (docs/MODEL-V2.md section 5). Floats r4. */
export interface BacktestDetail {
  draws: number // test draws: v1's window (start = max(30, N - 200)), stride 1
  from: string | null
  to: string | null
  v2: HitStat // Top pick
  random: HitStat // honest chance level mean_t k^2/L_t over live balls; lo/hi = where a random ticket's average lands 95% of the time
  v1: HitStat & { pairedDiff: number; pairedZ: number } // previous model's "Top scores" set on the same draws
  z: number // v2 vs random
  ci95: [number, number] // v2.avgHits - random.avgHits +/- 1.96 SE
  rank: { pct: number; z: number } // mean percentile of the drawn numbers in the model ranking (chance 0.5)
  logScoreNats: number // ball log-score vs uniform over live balls (<= 0 expected under fair draws)
  letter: { hitRate: number; chance: number } | null // chance: 1 in the letters the game allows (26, or 12 zodiac signs)
  bonus: { hitRate: number; chance: number } | null // chance: 1 in the bonus range
  lifts: { jackpotNumbersZ: number | null; sourceZ: Partial<SourceSplit> } // null / left out until the check has 30 test draws (docs/MODEL-V2.md 5.2)
  copyTilt: { steps: number; avgPastJackpotNumbers: number; random: number; maxSharedWithOne: number; maxFromUnion: number } | null
  orderHeld: { steps: number; held: number; filterChanged: number }
  jackpotDrawHits: { drawNo: number; date: string; hits: number }[] // descriptive only
  outOfDomain: number
  pooled: {
    lotteries: number
    draws: number
    v2: HitStat
    random: HitStat
    v1: HitStat
    z: number
    pairedZ: number
    rankZ: number
  } | null // attached by predictAllV2
  holm: { tests: number; minP: number; anySignificant: boolean } // over this lottery's z tests
  holmAll: { tests: number; minP: number; anySignificant: boolean } | null // over the 7 headline hit z's (predictAllV2)
  power: { mdeShare: number; pooledMdeShare: number | null } // minimum detectable effect as a share of the baseline: 80% power at the first Holm cut over the lottery's holm.tests checks (pooled: over holmAll.tests)
  text: { verdict: string; power: string; holm: string | null; copyTilt: string | null } // plain language (section 5.4)
}

export interface Prediction {
  lotteryId: string
  generatedAt: string
  basedOnDraws: number
  nextDrawDate: string
  nextDrawNo: number
  sets: PredictionSet[]
  numberScores: { n: number; score: number }[]
  method: string
  disclaimer: string
  backtest: { draws: number; avgHits: number; randomBaseline: number }
  modelVersion: string // 'win-lot-heuristic-v1' | 'win-lot-jackpot-v2'
  // v2 only
  evidence?: PredictionEvidence
  weights?: { jackpotCombination: number; jackpotDate: number; dailyDraw: number; orderRatio: number; maxLean: number; jackpotPrior: number }
  influence?: { numbers: SourceSplit; letters: SourceSplit | null; bonus: SourceSplit | null; odd: SourceSplit; spread: SourceSplit }
  damping?: { numbers: SourceSplit; letters: SourceSplit | null; bonus: SourceSplit | null } // c_s, 1 = not turned down
  patternLean?: number // 0..100, how far from all-numbers-equal; not an advantage
  numberLean?: ({ n: number } & SourceLean)[] // live numbers
  letterLean?: ({ letter: string } & SourceLean)[] | null
  bonusLean?: ({ n: number } & SourceLean)[] | null
  shapeLean?: { feature: 'odd' | 'spread'; bins: { label: string; lean: number }[] }[]
  liveBalls?: { count: number; excluded: number[]; since: string }
  odds?: { numbers: number; numbersAndLetter: number | null; basis: string } // identical for every set
  backtestDetail?: BacktestDetail
  previousModel?: {
    modelVersion: string
    sets: PredictionSet[]
    backtest: { draws: number; avgHits: number; randomBaseline: number } // v1's own figures, unchanged
    honestRandomBaseline: number // mean k^2/L_t over live balls (Ada Kotipathi 0.2105, Kapruka 0.2133)
  }
  explanation?: {
    summary: string
    weights: string
    combinations: string
    dates: string
    daily: string
    sets: string
    backtest: string
    odds: string
    limits: string
  }
  notes?: string[] // plain-language degradation and disclosure messages
}

export interface FetchRun {
  id: number
  run_at: string
  lottery_id: string
  inserted: number
  status: string
  message: string | null
}

export interface Status {
  lastRun: string | null
  runs: FetchRun[]
}
