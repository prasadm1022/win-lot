import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Prediction } from '../api/types'
import { useQuery } from '../lib/useQuery'
import { LOTTERY_ORDER } from '../lib/lotteryMeta'
import { Hero } from '../components/Hero'
import { LotteryCard } from '../components/LotteryCard'
import { Disclaimer, EmptyState, ErrorNotice } from '../components/Notices'
import { SkeletonCard } from '../components/Skeleton'

export function Home() {
  const lotteries = useQuery(() => api.lotteries(), [])
  const [preds, setPreds] = useState<Record<string, Prediction | null>>({})
  const [sums, setSums] = useState<Record<string, number[] | null>>({})

  useEffect(() => {
    document.title = 'WinLot — Sri Lanka lottery statistics and picks'
  }, [])

  // Fan out per-lottery prediction + recent sums once the list is known.
  useEffect(() => {
    if (!lotteries.data) return
    let alive = true
    for (const l of lotteries.data) {
      api.prediction(l.id).then(
        (p) => alive && setPreds((s) => ({ ...s, [l.id]: p })),
        () => alive && setPreds((s) => ({ ...s, [l.id]: null })),
      )
      api.stats(l.id, '100').then(
        (st) => alive && setSums((s) => ({ ...s, [l.id]: st.sumSeries.slice(-30).map((x) => x.sum) })),
        () => alive && setSums((s) => ({ ...s, [l.id]: [] })),
      )
    }
    return () => {
      alive = false
    }
  }, [lotteries.data])

  const ordered = lotteries.data
    ? [...lotteries.data].sort((a, b) => {
        const ia = LOTTERY_ORDER.indexOf(a.id)
        const ib = LOTTERY_ORDER.indexOf(b.id)
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      })
    : []

  return (
    <div className="stack">
      <Hero lotteries={ordered} predictions={preds} />

      <section id="lotteries" aria-labelledby="lotteries-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Seven lotteries</p>
            <h2 id="lotteries-title">Latest results and picks</h2>
          </div>
          <p className="card-sub">Tap a lottery for charts, history and the full set of picks.</p>
        </div>

        {lotteries.error ? (
          <ErrorNotice message={lotteries.error} onRetry={lotteries.refetch} />
        ) : lotteries.loading ? (
          <div className="lottery-grid">
            {Array.from({ length: 7 }, (_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState title="No lotteries yet" hint="The database is empty. Run the scraper seed, then refresh." />
        ) : (
          <div className="lottery-grid">
            {ordered.map((l) => (
              <LotteryCard key={l.id} lottery={l} prediction={preds[l.id] === undefined ? null : preds[l.id]} sums={sums[l.id] ?? null} />
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  )
}
