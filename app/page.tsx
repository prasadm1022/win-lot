// SPDX-License-Identifier: Apache-2.0
import { getLotteries, getPrediction, getStats, getStatus } from '@/lib/data'
import type { Prediction } from '@/lib/types'
import { orderIndex } from '@/components/util/lotteryMeta'
import { Hero, type Showcase } from '@/components/Hero'
import { LotteryCard } from '@/components/LotteryCard'
import { Disclaimer, EmptyState } from '@/components/Notices'
import { StaleNotice } from '@/components/StaleNotice'

function safePrediction(id: string): Prediction | null {
  try {
    const p = getPrediction(id)
    return p && p.sets.length ? p : null
  } catch {
    return null
  }
}

export default function HomePage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const predictions = new Map<string, Prediction | null>()
  const sums = new Map<string, number[]>()
  for (const l of lotteries) {
    predictions.set(l.id, l.drawCount > 0 ? safePrediction(l.id) : null)
    sums.set(
      l.id,
      l.drawCount > 0
        ? getStats(l.id, '100')
            .sumSeries.slice(-30)
            .map((x) => x.sum)
        : [],
    )
  }

  const showcase: Showcase[] = lotteries.flatMap((l) => {
    const p = predictions.get(l.id)
    if (!p) return []
    return [
      {
        lottery: { id: l.id, name: l.name, board: l.board, bonusLabel: l.bonusLabel },
        pick: p.sets[0],
        nextDrawDate: p.nextDrawDate,
      },
    ]
  })

  const newest = lotteries.reduce<string | null>((acc, l) => {
    const d = l.lastDraw?.date ?? null
    return d && (!acc || d > acc) ? d : acc
  }, null)
  const status = getStatus()

  return (
    <div className="stack">
      <Hero items={showcase} />
      <StaleNotice newestDrawDate={newest} lastRun={status.lastRun} />

      <section id="lotteries" aria-labelledby="lotteries-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Seven lotteries</p>
            <h2 id="lotteries-title">Latest results and picks</h2>
          </div>
          <p className="card-sub">Tap a lottery for charts, history and the full set of picks.</p>
        </div>

        {lotteries.length === 0 ? (
          <EmptyState title="No lotteries yet" hint="The data files are empty. Run the fetch script, then rebuild." />
        ) : (
          <div className="lottery-grid">
            {lotteries.map((l) => (
              <LotteryCard key={l.id} lottery={l} prediction={predictions.get(l.id) ?? null} sums={sums.get(l.id) ?? []} />
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  )
}
