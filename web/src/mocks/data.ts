// SPDX-License-Identifier: Apache-2.0
// Deterministic mock data for all 7 lotteries, shaped exactly like the API contract.
// Used when /api is unreachable or when the page is opened with ?mock=1.

import type {
  DrawSummary,
  DrawsPage,
  Lottery,
  Prediction,
  PredictionSet,
  Stats,
  StatsWindow,
  Status,
} from '../api/types'
import { ZODIAC } from '../lib/lotteryMeta'

interface Config {
  id: string
  name: string
  board: 'NLB' | 'DLB'
  letterKind: 'none' | 'letter' | 'zodiac'
  mainCount: number
  mainMin: number
  mainMax: number
  hasBonus: boolean
  bonusLabel: string | null
  bonusMin: number
  bonusMax: number
  drawCount: number
  lastDrawNo: number
  /** days between draws (1 = daily) */
  cadence: number
}

const CONFIGS: Config[] = [
  { id: 'dhana-nidhanaya', name: 'Dhana Nidhanaya', board: 'NLB', letterKind: 'letter', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: false, bonusLabel: null, bonusMin: 0, bonusMax: 0, drawCount: 2140, lastDrawNo: 2140, cadence: 1 },
  { id: 'mega-power', name: 'Mega Power', board: 'NLB', letterKind: 'letter', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: true, bonusLabel: 'Super Number', bonusMin: 1, bonusMax: 20, drawCount: 2680, lastDrawNo: 2680, cadence: 1 },
  { id: 'govisetha', name: 'Govisetha', board: 'NLB', letterKind: 'letter', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: false, bonusLabel: null, bonusMin: 0, bonusMax: 0, drawCount: 4320, lastDrawNo: 4320, cadence: 1 },
  { id: 'ada-kotipathi', name: 'Ada Kotipathi', board: 'DLB', letterKind: 'letter', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: false, bonusLabel: null, bonusMin: 0, bonusMax: 0, drawCount: 2960, lastDrawNo: 2960, cadence: 1 },
  { id: 'super-ball', name: 'Super Ball', board: 'DLB', letterKind: 'letter', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: true, bonusLabel: 'Super Number', bonusMin: 1, bonusMax: 20, drawCount: 3129, lastDrawNo: 3129, cadence: 1 },
  { id: 'shanida', name: 'Shanida', board: 'DLB', letterKind: 'zodiac', mainCount: 4, mainMin: 1, mainMax: 80, hasBonus: false, bonusLabel: null, bonusMin: 0, bonusMax: 0, drawCount: 4610, lastDrawNo: 4610, cadence: 1 },
  { id: 'kapruka', name: 'Kapruka', board: 'DLB', letterKind: 'letter', mainCount: 6, mainMin: 1, mainMax: 70, hasBonus: true, bonusLabel: 'Bonus Number', bonusMin: 1, bonusMax: 70, drawCount: 1480, lastDrawNo: 1480, cadence: 1 },
]

// Small seeded PRNG (mulberry32) so mock pages are stable between reloads.
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** Next draw: today if it is before 20:00 Colombo time (14:30 UTC), else tomorrow. */
function nextDrawIso(): string {
  const now = new Date()
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()
  return isoDaysAgo(utcMinutes < 14 * 60 + 30 ? 0 : -1)
}

function pickLetter(cfg: Config, r: () => number): string | null {
  if (cfg.letterKind === 'none') return null
  const pool = cfg.letterKind === 'zodiac' ? ZODIAC : LETTERS
  return pool[Math.floor(r() * pool.length)]
}

const drawCache = new Map<string, DrawSummary[]>()

/** All draws for a lottery, newest first. A mild bias makes "hot" numbers visible. */
function allDraws(cfg: Config): DrawSummary[] {
  const cached = drawCache.get(cfg.id)
  if (cached) return cached
  const r = rng(hash(cfg.id))
  const range = cfg.mainMax - cfg.mainMin + 1
  const weights = Array.from({ length: range }, () => 0.8 + r() * 0.5)
  const total = weights.reduce((a, b) => a + b, 0)
  const draws: DrawSummary[] = []
  for (let i = 0; i < cfg.drawCount; i++) {
    const picked = new Set<number>()
    while (picked.size < cfg.mainCount) {
      let x = r() * total
      let n = cfg.mainMin
      for (let k = 0; k < range; k++) {
        x -= weights[k]
        if (x <= 0) {
          n = cfg.mainMin + k
          break
        }
      }
      picked.add(n)
    }
    draws.push({
      drawNo: cfg.lastDrawNo - i,
      date: isoDaysAgo(1 + i * cfg.cadence),
      letter: pickLetter(cfg, r),
      numbers: [...picked], // drawn order, not sorted
      bonus: cfg.hasBonus ? cfg.bonusMin + Math.floor(r() * (cfg.bonusMax - cfg.bonusMin + 1)) : null,
    })
  }
  drawCache.set(cfg.id, draws)
  return draws
}

function cfgFor(id: string): Config {
  const c = CONFIGS.find((x) => x.id === id)
  if (!c) throw new Error(`Unknown lottery "${id}"`)
  return c
}

export function mockLotteries(): Lottery[] {
  return CONFIGS.map((c) => {
    const draws = allDraws(c)
    return {
      id: c.id,
      name: c.name,
      board: c.board,
      letterKind: c.letterKind,
      mainCount: c.mainCount,
      mainMin: c.mainMin,
      mainMax: c.mainMax,
      hasBonus: c.hasBonus,
      bonusLabel: c.bonusLabel,
      drawCount: c.drawCount,
      firstDate: draws[draws.length - 1].date,
      lastDraw: draws[0],
    }
  })
}

export function mockDraws(id: string, limit: number, offset: number): DrawsPage {
  const draws = allDraws(cfgFor(id))
  return { total: draws.length, draws: draws.slice(offset, offset + limit) }
}

export function mockStats(id: string, window: StatsWindow): Stats {
  const cfg = cfgFor(id)
  const all = allDraws(cfg)
  const n = window === 'all' ? all.length : Math.min(all.length, Number(window))
  const draws = all.slice(0, n)
  const range = cfg.mainMax - cfg.mainMin + 1
  const counts = new Array<number>(range).fill(0)
  const lastSeen = new Array<number>(range).fill(n)
  const posHeat: number[][] = Array.from({ length: cfg.mainCount }, () => new Array<number>(range).fill(0))
  const letterCounts = new Map<string, number>()
  const pairCounts = new Map<string, number>()
  const oddEven = new Map<string, number>()
  const highLow = new Map<string, number>()
  const mid = (cfg.mainMin + cfg.mainMax) / 2

  draws.forEach((d, i) => {
    let odd = 0
    let high = 0
    d.numbers.forEach((num, pos) => {
      const k = num - cfg.mainMin
      counts[k]++
      if (i < lastSeen[k]) lastSeen[k] = i
      posHeat[pos][k]++
      if (num % 2 === 1) odd++
      if (num > mid) high++
    })
    if (d.letter) letterCounts.set(d.letter, (letterCounts.get(d.letter) ?? 0) + 1)
    const sorted = [...d.numbers].sort((a, b) => a - b)
    for (let a = 0; a < sorted.length; a++)
      for (let b = a + 1; b < sorted.length; b++) {
        const key = `${sorted[a]}-${sorted[b]}`
        pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
      }
    const oe = `${odd}-${cfg.mainCount - odd}`
    oddEven.set(oe, (oddEven.get(oe) ?? 0) + 1)
    const hl = `${high}-${cfg.mainCount - high}`
    highLow.set(hl, (highLow.get(hl) ?? 0) + 1)
  })

  const expectedGap = range / cfg.mainCount
  const frequency = counts.map((count, k) => ({
    n: cfg.mainMin + k,
    count,
    lastSeenDrawsAgo: lastSeen[k],
    expectedGap,
  }))
  const byCount = [...frequency].sort((a, b) => b.count - a.count || a.n - b.n)
  const byOverdue = [...frequency].sort(
    (a, b) => b.lastSeenDrawsAgo / b.expectedGap - a.lastSeenDrawsAgo / a.expectedGap,
  )

  return {
    lotteryId: id,
    window,
    drawCount: n,
    frequency,
    hot: byCount.slice(0, 10).map((f) => f.n),
    cold: byCount.slice(-10).reverse().map((f) => f.n),
    overdue: byOverdue.slice(0, 10).map((f) => f.n),
    letterFrequency: [...letterCounts.entries()]
      .map(([letter, count]) => ({ letter, count }))
      .sort((a, b) => a.letter.localeCompare(b.letter)),
    sumSeries: draws
      .slice(0, 200)
      .reverse()
      .map((d) => ({ drawNo: d.drawNo, date: d.date, sum: d.numbers.reduce((a, b) => a + b, 0) })),
    oddEven: [...oddEven.entries()]
      .map(([k, count]) => {
        const [odd, even] = k.split('-').map(Number)
        return { odd, even, count }
      })
      .sort((a, b) => a.odd - b.odd),
    highLow: [...highLow.entries()]
      .map(([k, count]) => {
        const [high, low] = k.split('-').map(Number)
        return { high, low, count }
      })
      .sort((a, b) => a.high - b.high),
    pairs: [...pairCounts.entries()]
      .map(([k, count]) => {
        const [a, b] = k.split('-').map(Number)
        return { a, b, count }
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
    positionHeat: posHeat,
  }
}

const DISCLAIMER =
  'Lottery draws are random. These picks are statistical patterns from past results, offered for entertainment only, and do not improve your odds. Please play responsibly.'

const METHOD =
  'Each number is scored by a weighted blend of long-run frequency, recent frequency (last 30/100 draws, exponentially decayed) and overdue-ness (gap vs. expected gap), normalised 0..1. Sets are sampled from the score distribution under realistic constraints (odd/even balance and sum inside the historic interquartile range). The letter follows decayed letter frequency.'

export function mockPrediction(id: string): Prediction {
  const cfg = cfgFor(id)
  const stats = mockStats(id, 'all')
  const recent = mockStats(id, '100')
  const r = rng(hash(`${id}-pred`))
  const max = Math.max(...stats.frequency.map((f) => f.count))
  const rmax = Math.max(...recent.frequency.map((f) => f.count))
  const numberScores = stats.frequency.map((f, k) => {
    const long = f.count / max
    const rec = recent.frequency[k].count / rmax
    const over = Math.min(1, f.lastSeenDrawsAgo / (f.expectedGap * 2))
    return { n: f.n, score: Math.round((0.45 * long + 0.35 * rec + 0.2 * over) * 1000) / 1000 }
  })
  const ranked = [...numberScores].sort((a, b) => b.score - a.score)
  const letters = [...stats.letterFrequency].sort((a, b) => b.count - a.count)

  const labels = ['Prime pick', 'Hot streak', 'Balanced', 'Overdue mix', 'Wildcard']
  const sets: PredictionSet[] = labels.map((label, i) => {
    const pool = ranked.slice(i * 2, i * 2 + 14)
    const chosen = new Set<number>()
    while (chosen.size < cfg.mainCount) chosen.add(pool[Math.floor(r() * pool.length)].n)
    const numbers = [...chosen].sort((a, b) => a - b)
    const score = numbers.reduce((s, n) => s + numberScores[n - cfg.mainMin].score, 0) / cfg.mainCount
    return {
      label,
      letter: letters[i % Math.max(1, letters.length)]?.letter ?? null,
      numbers,
      bonus: cfg.hasBonus ? cfg.bonusMin + Math.floor(r() * (cfg.bonusMax - cfg.bonusMin + 1)) : null,
      score: Math.round(score * 1000) / 1000,
    }
  })
  sets.sort((a, b) => b.score - a.score)

  const last = allDraws(cfg)[0]
  const baseline = (cfg.mainCount * cfg.mainCount) / (cfg.mainMax - cfg.mainMin + 1)
  return {
    lotteryId: id,
    generatedAt: new Date(Date.now() - 3600_000 * 6).toISOString(),
    basedOnDraws: cfg.drawCount,
    nextDrawDate: nextDrawIso(),
    nextDrawNo: last.drawNo + 1,
    sets,
    numberScores,
    method: METHOD,
    disclaimer: DISCLAIMER,
    backtest: {
      draws: 200,
      avgHits: Math.round((baseline * (1 + (r() - 0.4) * 0.25)) * 1000) / 1000,
      randomBaseline: Math.round(baseline * 1000) / 1000,
    },
  }
}

export function mockStatus(): Status {
  const runs = []
  let idN = 140
  for (let day = 0; day < 3; day++) {
    for (const c of CONFIGS) {
      const at = new Date()
      at.setDate(at.getDate() - day)
      at.setHours(20, 1 + Math.floor(Math.random() * 3), 12, 0)
      const ok = !(day === 1 && c.id === 'shanida')
      runs.push({
        id: idN--,
        run_at: at.toISOString(),
        lottery_id: c.id,
        inserted: ok ? (day === 0 ? 1 : 1) : 0,
        status: ok ? 'ok' : 'error',
        message: ok ? null : 'HTTP 503 from dlb.lk; retried at 22:30',
      })
    }
  }
  return { lastRun: runs[0].run_at, runs: runs.slice(0, 20) }
}
