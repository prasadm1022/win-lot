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
  'Next-draw lottery predictions for every NLB and DLB lottery, calculated daily from the official results: Mega Power, Govisetha, Dhana Nidhanaya and more.'

export const metadata = pageMetadata({
  title: 'WinLot - Sri Lanka Lottery Predictions, NLB & DLB',
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
            <h2 id="lotteries-title">Next draw predictions</h2>
          </div>
          <p className="card-sub">Tap a lottery for its full set of predictions, the maths behind them and its draw history.</p>
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
        <h2 id="about-lotteries-title">Lottery predictions calculated from official results</h2>
        <p>
          WinLot is a prediction tool. Every evening it reads the official results published by the{' '}
          <a href="https://www.nlb.lk">National Lotteries Board (nlb.lk)</a> and the{' '}
          <a href="https://www.dlb.lk">Development Lotteries Board (dlb.lk)</a>, and calculates predictions for each
          lottery&apos;s next draw from them: NLB results since {archiveFrom('NLB')}, DLB results since {archiveFrom('DLB')}. The
          results belong to the two boards; WinLot only does the maths. Each lottery page shows its predictions, how they were
          calculated and the draw history they are based on.
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
                  .map((l) => {
                    const p = predictions.get(l.id)
                    return (
                      <li key={l.id}>
                        <Link href={`/l/${l.id}`}>{l.name} predictions</Link>
                        {p ? (
                          <span className="muted small">
                            {' '}
                            · next draw {p.nextDrawNo}, {fmtDate(p.nextDrawDate)}
                          </span>
                        ) : null}
                      </li>
                    )
                  })}
              </ul>
            </div>
          ))}
        </div>
        <p>
          New to the results? The <Link href="/guides">guides</Link> explain{' '}
          <Link href="/guides/how-to-read-lottery-results">how to read a result</Link>, the{' '}
          <Link href="/guides/jackpot-wins-history">record of jackpot wins</Link> and{' '}
          <Link href="/guides/number-frequency-and-gaps">what number frequency can and cannot tell you</Link>, and every lottery
          has a full results archive grouped by year.
        </p>
        <p className="small muted">
          WinLot is independent and not affiliated with either board. Always check a ticket against the official result on nlb.lk
          or dlb.lk before claiming a prize.
        </p>
      </section>

      <Disclaimer />
      <JsonLd data={homeJsonLd(lotteries, HOME_DESCRIPTION)} />
    </div>
  )
}
