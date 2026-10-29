// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOTTERY_IDS, getDraws, getJackpotStatus, getLottery, getPrediction, getStatus } from '@/lib/data'
import type { Prediction } from '@/lib/types'
import { fmtDate, fmtDateTime, fmtInt } from '@/components/util/format'
import { metaFor } from '@/components/util/lotteryMeta'
import { BallRow } from '@/components/Ball'
import { Countdown } from '@/components/Countdown'
import { Disclaimer } from '@/components/Notices'
import { StaleNotice } from '@/components/StaleNotice'
import { HistoryTable } from '@/components/HistoryTable'
import { HISTORY_PAGE as PAGE } from '@/components/util/constants'
import { PickCards } from '@/components/Picks'
import { HowPicksAreMade } from '@/components/HowPicksAreMade'
import { JackpotWins } from '@/components/JackpotWins'
import { LatestDrawJackpot } from '@/components/JackpotBadge'

type Params = { id: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return LOTTERY_IDS.map((id) => ({ id }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params
  const lottery = getLottery(id)
  if (!lottery) return { title: 'Lottery not found' }
  const last = lottery.lastDraw ? ` Latest draw #${lottery.lastDraw.drawNo} on ${fmtDate(lottery.lastDraw.date)}.` : ''
  return {
    title: lottery.name,
    description: `${lottery.name} (${lottery.board}) results with its known jackpot wins listed, number statistics and picks for the next draw.${last} For entertainment only; draws are random and every ticket has the same chance.`,
  }
}

function safePrediction(id: string): Prediction | null {
  try {
    const p = getPrediction(id)
    return p && p.sets.length ? p : null
  } catch {
    return null
  }
}

export default async function LotteryPage({ params }: { params: Promise<Params> }) {
  const { id } = await params
  const lottery = getLottery(id)
  if (!lottery) notFound()

  const meta = metaFor(id)
  const hasDraws = lottery.drawCount > 0 && lottery.lastDraw !== null
  const prediction = hasDraws ? safePrediction(id) : null
  const draws = hasDraws ? getDraws(id) : []
  const jackpots = getJackpotStatus(id)
  const status = getStatus()
  const { mainCount, mainMin, mainMax } = lottery

  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link href="/">All lotteries</Link> <span className="muted">/</span> {lottery.name}
      </nav>

      <header className="page-head">
        <div>
          <p className="eyebrow">
            <span className={`badge badge-${lottery.board.toLowerCase()}`}>{lottery.board}</span>{' '}
            {lottery.letterKind !== 'none' ? `${lottery.letterKind === 'zodiac' ? 'Zodiac sign' : 'Letter'} + ` : ''}
            {mainCount} numbers from {mainMin}–{mainMax}
            {lottery.hasBonus ? ` + ${lottery.bonusLabel ?? 'bonus'}` : ''}
          </p>
          <h1>
            {lottery.name}{' '}
            {meta.si ? (
              <span className="native">
                <span lang="si">{meta.si}</span> · <span lang="ta">{meta.ta}</span>
              </span>
            ) : null}
          </h1>
        </div>
        {prediction ? (
          <div>
            <Countdown dateIso={prediction.nextDrawDate} heading={`Draw #${prediction.nextDrawNo} · ${fmtDate(prediction.nextDrawDate)}`} />
          </div>
        ) : null}
      </header>

      <StaleNotice newestDrawDate={lottery.lastDraw?.date ?? null} lastRun={status.lastRun} thresholdDays={9} />

      {/* Picks + latest draw */}
      <div className="detail-top">
        <section className="card" aria-labelledby="picks-title">
          <div className="card-head">
            <div>
              <p className="eyebrow">Picks for fun</p>
              <h2 id="picks-title">Next draw picks</h2>
            </div>
            {prediction ? (
              <p className="card-sub">
                Generated {fmtDateTime(prediction.generatedAt)} from {fmtInt(prediction.basedOnDraws)} draws
              </p>
            ) : null}
          </div>
          {prediction ? (
            <>
              {prediction.explanation?.summary ? <p className="picks-summary">{prediction.explanation.summary}</p> : null}
              <PickCards prediction={prediction} lottery={lottery} />
            </>
          ) : (
            <p className="muted small">No picks yet - they appear once draws have been recorded.</p>
          )}
        </section>

        <div className="stack" style={{ gap: 18 }}>
          <section className="card" aria-labelledby="latest-title">
            <div className="card-head">
              <h2 id="latest-title" style={{ fontSize: '1.2rem' }}>
                Latest draw
              </h2>
              {lottery.lastDraw ? (
                <p className="card-sub">
                  #{lottery.lastDraw.drawNo} · {fmtDate(lottery.lastDraw.date)}
                </p>
              ) : null}
            </div>
            {lottery.lastDraw ? (
              <>
                <BallRow
                  letter={lottery.lastDraw.letter}
                  numbers={lottery.lastDraw.numbers}
                  bonus={lottery.lastDraw.bonus}
                  bonusLabel={lottery.bonusLabel}
                  caption="Latest draw"
                />
                <div className="latest-jp">
                  <LatestDrawJackpot draw={lottery.lastDraw} latest={jackpots.latestDraw} id="latest-jp" />
                </div>
              </>
            ) : (
              <p className="muted small">No draws recorded yet.</p>
            )}
          </section>

        </div>
      </div>

      {/* Method: the weights, their order and the maths */}
      {prediction ? <HowPicksAreMade prediction={prediction} lottery={lottery} /> : null}

      {/* Jackpot wins: the evidence the picks weigh first */}
      <JackpotWins status={jackpots} lottery={lottery} />

      {/* History */}
      <section className="card" aria-labelledby="hist-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Archive</p>
            <h2 id="hist-title">Draw history</h2>
          </div>
          <p className="card-sub">
            {fmtInt(draws.length)} draws
            {draws.some((d) => d.jackpot) ? ` · ${draws.filter((d) => d.jackpot).length} jackpot-winning days marked` : ''}
          </p>
        </div>
        <HistoryTable id={id} initial={draws.slice(0, PAGE)} total={draws.length} bonusLabel={lottery.bonusLabel} />
      </section>

      <Disclaimer />
    </div>
  )
}
