// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOTTERY_IDS, getDraws, getJackpotStatus, getLotteries, getLottery, getPrediction, getStatus } from '@/lib/data'
import type { Lottery, Prediction } from '@/lib/types'
import { BOARD_NAME, lotteryJsonLd, pageMetadata, ticketText } from '@/lib/seo'
import { JsonLd } from '@/components/JsonLd'
import { orderIndex } from '@/components/util/lotteryMeta'
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
  return pageMetadata({ title: lotteryTitle(lottery), description: lotteryDescription(lottery), path: `/l/${id}` })
}

/** "Mega Power Results - Latest Draw 2705 (NLB)": the draw number is what people search for the day after. */
function lotteryTitle(lottery: Lottery): string {
  const last = lottery.lastDraw
  return last ? `${lottery.name} Results - Latest Draw ${last.drawNo} (${lottery.board})` : `${lottery.name} Results (${lottery.board})`
}

/** The latest result itself, then what else the page holds. */
function lotteryDescription(lottery: Lottery): string {
  const last = lottery.lastDraw
  const latest = last
    ? `Latest ${lottery.name} result: draw ${last.drawNo} on ${fmtDate(last.date)} - ${ticketText(last)}. `
    : `${lottery.name} results from the ${BOARD_NAME[lottery.board] ?? lottery.board}. `
  return `${latest}${lottery.board} ${lottery.name} draw history, statistics and known jackpot wins, updated daily.`
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
  const others = getLotteries()
    .filter((l) => l.id !== id)
    .sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
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
            {lottery.name} results{' '}
            {meta.si ? (
              <span className="native">
                <span lang="si">{meta.si}</span> · <span lang="ta">{meta.ta}</span>
              </span>
            ) : null}
          </h1>
          <p className="page-intro">{introText(lottery)}</p>
        </div>
        {prediction ? (
          <div>
            <Countdown dateIso={prediction.nextDrawDate} heading={`Draw #${prediction.nextDrawNo} · ${fmtDate(prediction.nextDrawDate)}`} />
          </div>
        ) : null}
      </header>

      <StaleNotice newestDrawDate={lottery.lastDraw?.date ?? null} lastRun={status.lastRun} thresholdDays={9} />

      {/* Latest draw, then picks */}
      <section className="card" aria-labelledby="latest-title">
        <div className="card-head">
          <h2 id="latest-title" style={{ fontSize: '1.2rem' }}>
            Latest {lottery.name} result
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

      {/* Method: the weights, their order and the maths */}
      {prediction ? <HowPicksAreMade prediction={prediction} lottery={lottery} /> : null}

      {/* Jackpot wins: the evidence the picks weigh first */}
      <JackpotWins status={jackpots} lottery={lottery} />

      {/* History */}
      <section className="card" aria-labelledby="hist-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Archive</p>
            <h2 id="hist-title">{lottery.name} draw history</h2>
          </div>
          <p className="card-sub">
            {fmtInt(draws.length)} draws
            {draws.some((d) => d.jackpot) ? ` · ${draws.filter((d) => d.jackpot).length} jackpot-winning days marked` : ''}
          </p>
        </div>
        <HistoryTable id={id} initial={draws.slice(0, PAGE)} total={draws.length} bonusLabel={lottery.bonusLabel} />
      </section>

      <nav className="card related" aria-labelledby="related-title">
        <h2 id="related-title">More Sri Lanka lottery results</h2>
        <ul className="related-list">
          {others.map((o) => (
            <li key={o.id}>
              <Link href={`/l/${o.id}`}>{o.name} results</Link> <span className="muted small">{o.board}</span>
            </li>
          ))}
        </ul>
      </nav>

      <Disclaimer />
      <JsonLd data={lotteryJsonLd(lottery, lotteryDescription(lottery))} />
    </div>
  )
}

/** One plain paragraph under the heading: what the lottery is and what the page holds, in the words people search. */
function introText(lottery: Lottery): string {
  const board = BOARD_NAME[lottery.board] ?? lottery.board
  const letter = lottery.letterKind === 'zodiac' ? 'a zodiac sign, ' : lottery.letterKind !== 'none' ? 'a letter, ' : ''
  const bonus = lottery.hasBonus ? ` and a ${lottery.bonusLabel ?? 'bonus number'}` : ''
  const archive =
    lottery.drawCount > 0 ? `the full ${lottery.name} draw history (${fmtInt(lottery.drawCount)} draws since ${fmtDate(lottery.firstDate)}), ` : ''
  return (
    `${lottery.name} is a ${board} (${lottery.board}) lottery. A ticket has ${letter}${lottery.mainCount} numbers from ` +
    `${lottery.mainMin} to ${lottery.mainMax}${bonus}. This page shows the latest ${lottery.name} result, ${archive}` +
    `the jackpot wins we know of, number statistics and picks for the next draw - for fun only, as every draw is random.`
  )
}
