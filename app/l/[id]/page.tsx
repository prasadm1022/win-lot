// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOTTERY_IDS, getDraws, getLottery, getPrediction, getStats, getStatus } from '@/lib/data'
import type { Prediction, Stats, StatsWindow } from '@/lib/types'
import { fmtDate, fmtDateTime, fmtInt } from '@/components/util/format'
import { metaFor } from '@/components/util/lotteryMeta'
import { BallRow } from '@/components/Ball'
import { Countdown } from '@/components/Countdown'
import { Disclaimer } from '@/components/Notices'
import { StaleNotice } from '@/components/StaleNotice'
import { StatsPanel } from '@/components/StatsPanel'
import { HistoryTable } from '@/components/HistoryTable'
import { HISTORY_PAGE as PAGE } from '@/components/util/constants'
import { Backtest } from '@/components/charts/Backtest'
import { NumberScoreHeatmap } from '@/components/charts/Heatmaps'

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
    description: `${lottery.name} (${lottery.board}) results, number statistics and statistical picks for the next draw.${last} For entertainment only.`,
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
  const windows: StatsWindow[] = ['all', '500', '100']
  const stats = Object.fromEntries(windows.map((w) => [w, getStats(id, w)])) as Record<StatsWindow, Stats>
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
            <p className="row-label small muted" style={{ margin: '0 0 6px' }}>
              Draw #{prediction.nextDrawNo} · {fmtDate(prediction.nextDrawDate)}
            </p>
            <Countdown dateIso={prediction.nextDrawDate} />
          </div>
        ) : null}
      </header>

      <StaleNotice newestDrawDate={lottery.lastDraw?.date ?? null} lastRun={status.lastRun} thresholdDays={9} />

      {/* Latest draw + picks */}
      <div className="detail-top">
        <section className="card" aria-labelledby="picks-title">
          <div className="card-head">
            <div>
              <p className="eyebrow">Statistical picks</p>
              <h2 id="picks-title">Next draw picks</h2>
            </div>
            {prediction ? (
              <p className="card-sub">
                Generated {fmtDateTime(prediction.generatedAt)} from {fmtInt(prediction.basedOnDraws)} draws
              </p>
            ) : null}
          </div>
          {prediction ? (
            <div className="pred-sets">
              {prediction.sets.map((s, i) => (
                <div key={s.label} className={`pred-set${i === 0 ? ' lead' : ''}`}>
                  <p className="label">
                    {i === 0 ? '★ ' : ''}
                    {s.label}
                  </p>
                  <BallRow letter={s.letter} numbers={s.numbers} bonus={s.bonus} bonusLabel={lottery.bonusLabel} reveal caption={s.label} />
                  <div className="score">
                    <span>Score</span>
                    <span className="score-bar" aria-hidden="true">
                      <span style={{ width: `${s.score * 100}%`, animationDelay: `${i * 120}ms` }} />
                    </span>
                    <b>{(s.score * 100).toFixed(0)}</b>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No picks yet - they appear once draws have been recorded.</p>
          )}
          <div style={{ marginTop: 14 }}>
            <Disclaimer compact text={prediction?.disclaimer} />
          </div>
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
              <BallRow
                letter={lottery.lastDraw.letter}
                numbers={lottery.lastDraw.numbers}
                bonus={lottery.lastDraw.bonus}
                bonusLabel={lottery.bonusLabel}
                caption="Latest draw"
              />
            ) : (
              <p className="muted small">No draws recorded yet.</p>
            )}
          </section>

          <section className="card" aria-labelledby="bt-title">
            <div className="card-head">
              <h2 id="bt-title" style={{ fontSize: '1.2rem' }}>
                Does it beat random?
              </h2>
            </div>
            {prediction ? <Backtest backtest={prediction.backtest} mainCount={mainCount} /> : <p className="muted small">Backtest unavailable.</p>}
          </section>
        </div>
      </div>

      {/* Score heatmap */}
      <section className="card" aria-labelledby="heat-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Model view</p>
            <h2 id="heat-title">Number scores</h2>
          </div>
          <p className="card-sub">Blend of long-run frequency, recent frequency and overdue-ness.</p>
        </div>
        {prediction ? <NumberScoreHeatmap scores={prediction.numberScores} mainMin={mainMin} /> : <p className="muted small">Scores unavailable.</p>}
      </section>

      {/* Statistics with window switcher (all three windows precomputed) */}
      <StatsPanel lottery={{ mainCount, mainMin, mainMax, letterKind: lottery.letterKind }} stats={stats} />

      {/* History */}
      <section className="card" aria-labelledby="hist-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Archive</p>
            <h2 id="hist-title">Draw history</h2>
          </div>
          <p className="card-sub">{fmtInt(draws.length)} draws</p>
        </div>
        <HistoryTable id={id} initial={draws.slice(0, PAGE)} total={draws.length} bonusLabel={lottery.bonusLabel} />
      </section>

      <Disclaimer />
    </div>
  )
}
