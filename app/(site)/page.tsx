// SPDX-License-Identifier: Apache-2.0
import Link from 'next/link'
import { getJackpotStatus, getLotteries, getPrediction, getStats, getStatus } from '@/lib/data'
import type { JackpotStatus, Prediction } from '@/lib/types'
import { orderIndex } from '@/components/util/lotteryMeta'
import { Hero, type Showcase } from '@/components/Hero'
import { LotteryCard } from '@/components/LotteryCard'
import { Disclaimer, EmptyState } from '@/components/Notices'
import { StaleNotice } from '@/components/StaleNotice'
import { JsonLd } from '@/components/JsonLd'
import { fmtDate, fmtMonthYear } from '@/components/util/format'
import { BOARD_NAME, homeJsonLd, pageMetadata } from '@/lib/seo'

const HOME_DESCRIPTION =
  'Latest Sri Lanka lottery results for NLB and DLB: Dhana Nidhanaya, Mega Power, Govisetha, Ada Kotipathi, Super Ball, Shanida and Kapruka, with draw history.'

export const metadata = pageMetadata({
  title: 'WinLot - Sri Lanka Lottery Results Today, NLB & DLB',
  description: HOME_DESCRIPTION,
  path: '/',
  absoluteTitle: true,
})

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
  // The archive start per board, from the data, so the sentence stays true as the archive grows.
  const archiveFrom = (board: 'NLB' | 'DLB') =>
    fmtMonthYear(
      lotteries
        .filter((l) => l.board === board && l.drawCount > 0)
        .map((l) => l.firstDate)
        .sort()[0],
    )

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

      <section className="card prose about-lotteries" aria-labelledby="about-lotteries-title">
        <h2 id="about-lotteries-title">Sri Lanka lottery results in one place</h2>
        <p>
          WinLot collects the official results of Sri Lanka&apos;s two lottery boards every evening and keeps the full archive:
          the National Lotteries Board (NLB) since {archiveFrom('NLB')} and the Development Lotteries Board (DLB) since{' '}
          {archiveFrom('DLB')}. Each lottery page shows the latest result, every past draw, the jackpot wins we know of and number
          statistics.
        </p>
        <div className="board-lists">
          {(['NLB', 'DLB'] as const).map((board) => (
            <div key={board}>
              <h3>
                {BOARD_NAME[board]} ({board})
              </h3>
              <ul>
                {lotteries
                  .filter((l) => l.board === board)
                  .map((l) => (
                    <li key={l.id}>
                      <Link href={`/l/${l.id}`}>{l.name} results</Link>
                      {l.lastDraw ? (
                        <span className="muted small">
                          {' '}
                          · draw {l.lastDraw.drawNo}, {fmtDate(l.lastDraw.date)}
                        </span>
                      ) : null}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="small muted">
          WinLot is independent and not affiliated with either board. Always check a ticket against the official result before
          claiming a prize.
        </p>
      </section>

      <Disclaimer />
      <JsonLd data={homeJsonLd(lotteries, HOME_DESCRIPTION)} />
    </div>
  )
}
