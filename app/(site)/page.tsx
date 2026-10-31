// SPDX-License-Identifier: Apache-2.0
import { getJackpotStatus, getLotteries, getPrediction, getStats, getStatus } from '@/lib/data'
import type { JackpotStatus, Prediction } from '@/lib/types'
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

function safeJackpots(id: string): JackpotStatus | null {
  try {
    return getJackpotStatus(id)
  } catch {
    return null
  }
}

export default function HomePage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const predictions = new Map<string, Prediction | null>()
  const jackpots = new Map<string, JackpotStatus | null>()
  const sums = new Map<string, number[]>()
  for (const l of lotteries) {
    predictions.set(l.id, l.drawCount > 0 ? safePrediction(l.id) : null)
    jackpots.set(l.id, safeJackpots(l.id))
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
    const latestDraw = l.lastDraw
    const outcome = jackpots.get(l.id)?.latestDraw ?? null
    return [
      {
        lottery: { id: l.id, name: l.name, board: l.board, bonusLabel: l.bonusLabel },
        pick: p.sets[0],
        nextDrawDate: p.nextDrawDate,
        latest: latestDraw
          ? {
              drawNo: latestDraw.drawNo,
              date: latestDraw.date,
              jackpot: latestDraw.jackpot ?? null,
              outcome: outcome && outcome.drawNo === latestDraw.drawNo ? outcome.outcome : 'unknown',
            }
          : null,
      },
    ]
  })

  const newest = lotteries.reduce<string | null>((acc, l) => {
    const d = l.lastDraw?.date ?? null
    return d && (!acc || d > acc) ? d : acc
  }, null)
  // Where the marked jackpot days come from: the first date an NLB prize table with a winners count could be checked.
  const nlbCheckedFrom = lotteries.reduce<string | null>((acc, l) => {
    const f = l.board === 'NLB' ? (jackpots.get(l.id)?.checked?.from ?? null) : null
    return f && (!acc || f < acc) ? f : acc
  }, null)
  const status = getStatus()

  return (
    <div className="stack">
      <Hero items={showcase} nlbCheckedFrom={nlbCheckedFrom} />
      <StaleNotice newestDrawDate={newest} lastRun={status.lastRun} />

      <section id="lotteries" aria-labelledby="lotteries-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Seven lotteries</p>
            <h2 id="lotteries-title">Latest results, jackpots and picks</h2>
          </div>
          <p className="card-sub">Tap a lottery for its jackpot wins, charts, history and the full set of picks.</p>
        </div>

        {lotteries.length === 0 ? (
          <EmptyState title="No lotteries yet" hint="The data files are empty. Run the fetch script, then rebuild." />
        ) : (
          <div className="lottery-grid">
            {lotteries.map((l) => (
              <LotteryCard
                key={l.id}
                lottery={l}
                prediction={predictions.get(l.id) ?? null}
                jackpots={jackpots.get(l.id) ?? null}
                sums={sums.get(l.id) ?? []}
              />
            ))}
          </div>
        )}
      </section>

      <Disclaimer />
    </div>
  )
}
