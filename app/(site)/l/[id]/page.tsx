// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOTTERY_IDS, getDraws, getJackpotStatus, getLotteries, getLottery, getPrediction, getPrizeRows, getStatus } from '@/lib/data'
import type { Lottery, Prediction } from '@/lib/types'
import { BOARD_SOURCE, lotteryJsonLd, pageMetadata, ticketText } from '@/lib/seo'
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
import { LotteryGuide } from '@/components/LotteryGuide'

type Params = { id: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return LOTTERY_IDS.map((id) => ({ id }))
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params
  const lottery = getLottery(id)
  if (!lottery) return { title: 'Lottery not found' }
  const prediction = lottery.drawCount > 0 ? safePrediction(id) : null
  return pageMetadata({
    title: lotteryTitle(lottery, prediction),
    description: lotteryDescription(lottery, prediction),
    path: `/l/${id}`,
  })
}

/** "Mega Power Prediction for Draw 2706 (NLB)": the next draw number is what people search before a draw. */
function lotteryTitle(lottery: Lottery, prediction: Prediction | null): string {
  return prediction
    ? `${lottery.name} Prediction for Draw ${prediction.nextDrawNo} (${lottery.board})`
    : `${lottery.name} Predictions (${lottery.board})`
}

/** The prediction first, then the official result it builds on. */
function lotteryDescription(lottery: Lottery, prediction: Prediction | null): string {
  const source = BOARD_SOURCE[lottery.board]?.host ?? lottery.board
  const head = prediction
    ? `${lottery.name} prediction for draw ${prediction.nextDrawNo} on ${fmtDate(prediction.nextDrawDate)}, calculated from ${fmtInt(prediction.basedOnDraws)} official ${source} results.`
    : `${lottery.name} predictions, calculated from the official ${source} results.`
  const last = lottery.lastDraw
  return last ? `${head} Latest result: draw ${last.drawNo} - ${ticketText(last)}.` : head
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
  const source = BOARD_SOURCE[lottery.board] ?? { name: lottery.board, url: '/', host: lottery.board }

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
            {lottery.name} predictions{' '}
            {meta.si ? (
              <span className="native">
                <span lang="si">{meta.si}</span> · <span lang="ta">{meta.ta}</span>
              </span>
            ) : null}
          </h1>
          <p className="page-intro">{introText(lottery)}</p>
          <p className="page-links small">
            <a href="#guide">{lottery.name} at a glance</a> · <Link href={`/l/${id}/results`}>Results archive</Link> ·{' '}
            <Link href="/guides">Guides</Link>
          </p>
        </div>
        {prediction ? (
          <div>
            <Countdown dateIso={prediction.nextDrawDate} heading={`Draw #${prediction.nextDrawNo} · ${fmtDate(prediction.nextDrawDate)}`} />
          </div>
        ) : null}
      </header>

      <StaleNotice newestDrawDate={lottery.lastDraw?.date ?? null} lastRun={status.lastRun} thresholdDays={9} />

      {/* The prediction leads (it is what WinLot is for), then the official result it builds on */}
      <section className="card" aria-labelledby="picks-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Predictions for fun</p>
            <h2 id="picks-title">
              {prediction ? `${lottery.name} prediction for draw #${prediction.nextDrawNo}` : `${lottery.name} predictions`}
            </h2>
          </div>
          {prediction ? (
            <p className="card-sub">
              Calculated {fmtDateTime(prediction.generatedAt)} from {fmtInt(prediction.basedOnDraws)} official results
            </p>
          ) : null}
        </div>
        {prediction ? (
          <>
            {prediction.explanation?.summary ? <p className="picks-summary">{prediction.explanation.summary}</p> : null}
            <PickCards prediction={prediction} lottery={lottery} />
          </>
        ) : (
          <p className="muted small">No predictions yet - they appear once draws have been recorded.</p>
        )}
      </section>

      <section className="card" aria-labelledby="latest-title">
        <div className="card-head">
          <h2 id="latest-title" style={{ fontSize: '1.2rem' }}>
            Latest official {lottery.name} result
          </h2>
          {lottery.lastDraw ? (
            <p className="card-sub">
              #{lottery.lastDraw.drawNo} · {fmtDate(lottery.lastDraw.date)} · source{' '}
              <a href={source.url}>{source.host}</a>
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
            {fmtInt(draws.length)} official results from <a href={source.url}>{source.host}</a>
            {draws.some((d) => d.jackpot) ? ` · ${draws.filter((d) => d.jackpot).length} jackpot-winning days marked` : ''}
          </p>
        </div>
        <HistoryTable id={id} initial={draws.slice(0, PAGE)} total={draws.length} bonusLabel={lottery.bonusLabel} />
        {draws.length > 0 ? (
          <p className="small archive-link">
            <Link href={`/l/${id}/results`}>
              All {fmtInt(draws.length)} {lottery.name} results on one page, grouped by year
            </Link>
          </p>
        ) : null}
      </section>

      {/* Reference: who runs it, when it is drawn, what a result looks like, where the official information lives */}
      <LotteryGuide lottery={lottery} draws={draws} rows={getPrizeRows(id)} status={jackpots} />

      <nav className="card related" aria-labelledby="related-title">
        <h2 id="related-title">More Sri Lanka lottery predictions</h2>
        <ul className="related-list">
          {others.map((o) => (
            <li key={o.id}>
              <Link href={`/l/${o.id}`}>{o.name} predictions</Link> <span className="muted small">{o.board}</span>
            </li>
          ))}
        </ul>
      </nav>

      <Disclaimer />
      <JsonLd data={lotteryJsonLd(lottery, lotteryDescription(lottery, prediction))} />
    </div>
  )
}

/** One plain paragraph under the heading: what WinLot predicts here, and whose results it is calculated from. */
function introText(lottery: Lottery): string {
  const source = BOARD_SOURCE[lottery.board]
  const board = source ? `${source.name} (${source.host})` : lottery.board
  const letter = lottery.letterKind === 'zodiac' ? 'a zodiac sign, ' : lottery.letterKind !== 'none' ? 'a letter, ' : ''
  const bonus = lottery.hasBonus ? ` and a ${lottery.bonusLabel ?? 'bonus number'}` : ''
  const archive =
    lottery.drawCount > 0 ? `${fmtInt(lottery.drawCount)} official results since ${fmtDate(lottery.firstDate)}` : 'its official results'
  return (
    `WinLot predicts numbers for the next ${lottery.name} draw: ${letter}${lottery.mainCount} numbers from ${lottery.mainMin} ` +
    `to ${lottery.mainMax}${bonus}. The predictions are calculated from ${archive}, published by the ${board}; WinLot ` +
    `only does the maths. They are for fun only, as every draw is random.`
  )
}
