import type { DrawsPage, Lottery, Prediction, Stats, StatsWindow, Status } from './types'
import { mockDraws, mockLotteries, mockPrediction, mockStats, mockStatus } from '../mocks/data'

const forcedMock = new URLSearchParams(window.location.search).get('mock') === '1'
let fallbackMock = false

/** True when the UI is showing mock data (forced via ?mock=1 or because /api failed). */
export function isMockMode(): boolean {
  return forcedMock || fallbackMock
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onMockModeChange(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

async function getJson<T>(path: string, mock: () => T): Promise<T> {
  if (forcedMock || fallbackMock) return delay(mock())
  try {
    const res = await fetch(path, { headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`API ${res.status} for ${path}`)
    return (await res.json()) as T
  } catch (err) {
    // The Worker is unreachable (dev without wrangler, or an outage): fall back to mock
    // data once and tell the UI so it can show the "sample data" banner.
    console.warn('[winlot] API unavailable, switching to mock data:', err)
    fallbackMock = true
    listeners.forEach((l) => l())
    return mock()
  }
}

function delay<T>(v: T, ms = 250): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(v), ms))
}

export const api = {
  lotteries: () => getJson<Lottery[]>('/api/lotteries', mockLotteries),
  draws: (id: string, limit = 50, offset = 0) =>
    getJson<DrawsPage>(
      `/api/lotteries/${encodeURIComponent(id)}/draws?limit=${limit}&offset=${offset}`,
      () => mockDraws(id, limit, offset),
    ),
  stats: (id: string, window: StatsWindow) =>
    getJson<Stats>(`/api/lotteries/${encodeURIComponent(id)}/stats?window=${window}`, () =>
      mockStats(id, window),
    ),
  prediction: (id: string) =>
    getJson<Prediction>(`/api/lotteries/${encodeURIComponent(id)}/prediction`, () =>
      mockPrediction(id),
    ),
  status: () => getJson<Status>('/api/status', mockStatus),
}
