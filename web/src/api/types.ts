// Mirrors docs/ARCHITECTURE.md "API contract". Do not change without updating the Worker.

export type Board = 'NLB' | 'DLB'
export type LetterKind = 'none' | 'letter' | 'zodiac'

export interface DrawSummary {
  drawNo: number
  date: string // YYYY-MM-DD
  letter: string | null
  numbers: number[]
  bonus: unknown | null
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
  frequency: { n: number; count: number; lastSeenDrawsAgo: number; expectedGap: number }[]
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

export interface PredictionSet {
  label: string
  letter: string | null
  numbers: number[]
  bonus: unknown | null
  score: number // 0..1
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
