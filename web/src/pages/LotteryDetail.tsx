// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { Lottery, StatsWindow } from '../api/types'
import { useQuery } from '../lib/useQuery'
import { useReducedMotion } from '../lib/useTheme'
import { fmtDate, fmtDateTime, fmtInt } from '../lib/format'
import { metaFor } from '../lib/lotteryMeta'
import { BallRow } from '../components/Ball'
import { Countdown } from '../components/Countdown'
import { Disclaimer, EmptyState, ErrorNotice } from '../components/Notices'
import { Skeleton, SkeletonBalls, SkeletonChart } from '../components/Skeleton'
import { FrequencyBars } from '../charts/FrequencyBars'
import { SumLine } from '../charts/SumLine'
import { NumberScoreHeatmap, PositionHeatmap } from '../charts/Heatmaps'
import { HighLow, LetterFrequency, OddEven, TopPairs } from '../charts/Distributions'
import { Backtest } from '../charts/Backtest'

const WINDOWS: { key: StatsWindow; label: string }[] = [
  { key: 'all', label: 'All draws' },
  { key: '500', label: 'Last 500' },
  { key: '100', label: 'Last 100' },
]
const PAGE = 25

function WindowSwitch({ value, onChange }: { value: StatsWindow; onChange: (w: StatsWindow) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Statistics window">
      {WINDOWS.map((w) => (
        <button key={w.key} type="button" aria-pressed={value === w.key} onClick={() => onChange(w.key)}>
          {w.label}
        </button>
      ))}
    </div>
  )
}

export function LotteryDetail() {
  const { id = '' } = useParams()
  const reduced = useReducedMotion()
  const [win, setWin] = useState<StatsWindow>('all')
  const [page, setPage] = useState(0)

  const lotteries = useQuery(() => api.lotteries(), [])
  const lottery: Lottery | undefined = lotteries.data?.find((l) => l.id === id)
  const prediction = useQuery(() => api.prediction(id), [id])
  const stats = useQuery(() => api.stats(id, win), [id, win])
  const draws = useQuery(() => api.draws(id, PAGE, page * PAGE), [id, page])
  const meta = metaFor(id)

  useEffect(() => {
    setPage(0)
    setWin('all')
  }, [id])
  useEffect(() => {
    if (lottery) document.title = `${lottery.name} — WinLot`
  }, [lottery])

  if (lotteries.error) return <ErrorNotice message={lotteries.error} onRetry={lotteries.refetch} />
  if (!lotteries.loading && !lottery) {
    return (
      <div className="card">
        <EmptyState title="We don't track that lottery" hint={`"${id}" is not in the list.`} />
        <p style={{ textAlign: 'center' }}>
          <Link to="/" className="btn">
            Back to all lotteries
          </Link>
        </p>
      </div>
    )
  }

  const mainCount = lottery?.mainCount ?? 4
  const mainMin = lottery?.mainMin ?? 1
  const mainMax = lottery?.mainMax ?? 80
  const totalPages = draws.data ? Math.max(1, Math.ceil(draws.data.total / PAGE)) : 1

  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link to="/">All lotteries</Link> <span className="muted">/</span> {lottery?.name ?? '…'}
      </nav>

      <header className="page-head">
        <div>
          {lottery ? (
            <>
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
            </>
          ) : (
            <>
              <Skeleton w={160} style={{ marginBottom: 10 }} />
              <Skeleton w={280} h={40} />
            </>
          )}
        </div>
        {prediction.data ? (
          <div>
            <p className="row-label small muted" style={{ margin: '0 0 6px' }}>
              Draw #{prediction.data.nextDrawNo} · {fmtDate(prediction.data.nextDrawDate)}
            </p>
            <Countdown dateIso={prediction.data.nextDrawDate} />
          </div>
        ) : null}
      </header>

      {/* Latest draw + picks */}
      <div className="detail-top">
        <section className="card" aria-labelledby="picks-title">
          <div className="card-head">
            <div>
              <p className="eyebrow">Statistical picks</p>
              <h2 id="picks-title">Next draw picks</h2>
            </div>
            {prediction.data ? (
              <p className="card-sub">
                Generated {fmtDateTime(prediction.data.generatedAt)} from {fmtInt(prediction.data.basedOnDraws)} draws
              </p>
            ) : null}
          </div>
          {prediction.error ? (
            <ErrorNotice message={prediction.error} onRetry={prediction.refetch} />
          ) : prediction.loading || !prediction.data ? (
            <div className="pred-sets" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="pred-set">
                  <Skeleton w={100} />
                  <SkeletonBalls n={mainCount + 1} />
                </div>
              ))}
            </div>
          ) : (
            <div className="pred-sets">
              {prediction.data.sets.map((s, i) => (
                <div key={s.label} className={`pred-set${i === 0 ? ' lead' : ''}`}>
                  <p className="label">
                    {i === 0 ? '★ ' : ''}
                    {s.label}
                  </p>
                  <BallRow
                    letter={s.letter}
                    numbers={s.numbers}
                    bonus={s.bonus}
                    bonusLabel={lottery?.bonusLabel}
                    reveal={!reduced}
                    caption={s.label}
                  />
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
          )}
          <div style={{ marginTop: 14 }}>
            <Disclaimer compact text={prediction.data?.disclaimer} />
          </div>
        </section>

        <div className="stack" style={{ gap: 18 }}>
          <section className="card" aria-labelledby="latest-title">
            <div className="card-head">
              <h2 id="latest-title" style={{ fontSize: '1.2rem' }}>
                Latest draw
              </h2>
              {lottery?.lastDraw ? (
                <p className="card-sub">
                  #{lottery.lastDraw.drawNo} · {fmtDate(lottery.lastDraw.date)}
                </p>
              ) : null}
            </div>
            {lottery?.lastDraw ? (
              <BallRow
                letter={lottery.lastDraw.letter}
                numbers={lottery.lastDraw.numbers}
                bonus={lottery.lastDraw.bonus}
                bonusLabel={lottery.bonusLabel}
                caption="Latest draw"
              />
            ) : lottery ? (
              <p className="muted small">No draws recorded yet.</p>
            ) : (
              <SkeletonBalls />
            )}
          </section>

          <section className="card" aria-labelledby="bt-title">
            <div className="card-head">
              <h2 id="bt-title" style={{ fontSize: '1.2rem' }}>
                Does it beat random?
              </h2>
            </div>
            {prediction.data ? (
              <Backtest backtest={prediction.data.backtest} mainCount={mainCount} />
            ) : prediction.error ? (
              <p className="muted small">Backtest unavailable.</p>
            ) : (
              <SkeletonChart h={90} />
            )}
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
        {prediction.data ? (
          <NumberScoreHeatmap scores={prediction.data.numberScores} mainMin={mainMin} />
        ) : prediction.error ? (
          <p className="muted small">Scores unavailable.</p>
        ) : (
          <SkeletonChart h={160} />
        )}
      </section>

      {/* Statistics with window switcher */}
      <section aria-labelledby="stats-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">History statistics</p>
            <h2 id="stats-title">Patterns in past draws</h2>
          </div>
          <WindowSwitch value={win} onChange={setWin} />
        </div>

        {stats.error ? (
          <ErrorNotice message={stats.error} onRetry={stats.refetch} />
        ) : (
          <div className="stack" style={{ gap: 18 }} aria-busy={stats.loading}>
            {stats.data ? (
              <div className="stat-row">
                <div className="stat">
                  <p className="label">Draws in window</p>
                  <p className="value">{fmtInt(stats.data.drawCount)}</p>
                </div>
                <div className="stat">
                  <p className="label">Hot</p>
                  <p className="value" style={{ fontSize: '1rem' }}>
                    {stats.data.hot.slice(0, 5).join(' · ')}
                  </p>
                </div>
                <div className="stat">
                  <p className="label">Cold</p>
                  <p className="value" style={{ fontSize: '1rem' }}>
                    {stats.data.cold.slice(0, 5).join(' · ')}
                  </p>
                </div>
                <div className="stat">
                  <p className="label">Overdue</p>
                  <p className="value" style={{ fontSize: '1rem' }}>
                    {stats.data.overdue.slice(0, 5).join(' · ')}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card-head">
                <h3>Number frequency</h3>
                <p className="card-sub">How many times each number was drawn</p>
              </div>
              {stats.data ? <FrequencyBars stats={stats.data} /> : <SkeletonChart />}
            </div>

            <div className="card">
              <div className="card-head">
                <h3>Sum of numbers over time</h3>
                <p className="card-sub">Last {Math.min(200, stats.data?.sumSeries.length ?? 200)} draws</p>
              </div>
              {stats.data ? (
                <SumLine series={stats.data.sumSeries} mainCount={mainCount} mainMin={mainMin} mainMax={mainMax} />
              ) : (
                <SkeletonChart />
              )}
            </div>

            <div className="grid grid-3">
              <div className="card">
                <div className="card-head">
                  <h3>Odd / even</h3>
                </div>
                {stats.data ? <OddEven stats={stats.data} /> : <SkeletonChart h={120} />}
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>High / low</h3>
                  <p className="card-sub">High = above {(mainMin + mainMax) / 2}</p>
                </div>
                {stats.data ? <HighLow stats={stats.data} /> : <SkeletonChart h={120} />}
              </div>
              <div className="card">
                <div className="card-head">
                  <h3>Top pairs</h3>
                  <p className="card-sub">Drawn together most often</p>
                </div>
                {stats.data ? <TopPairs stats={stats.data} /> : <SkeletonChart h={120} />}
              </div>
            </div>

            {lottery?.letterKind !== 'none' ? (
              <div className="card">
                <div className="card-head">
                  <h3>{lottery?.letterKind === 'zodiac' ? 'Zodiac sign' : 'Letter'} frequency</h3>
                </div>
                {stats.data ? <LetterFrequency stats={stats.data} /> : <SkeletonChart h={150} />}
              </div>
            ) : null}

            <div className="card">
              <div className="card-head">
                <h3>Position heatmap</h3>
                <p className="card-sub">Which numbers tend to be drawn first, second, …</p>
              </div>
              {stats.data ? (
                <PositionHeatmap heat={stats.data.positionHeat} mainMin={mainMin} mainCount={mainCount} />
              ) : (
                <SkeletonChart h={120} />
              )}
            </div>
          </div>
        )}
      </section>

      {/* History */}
      <section className="card" aria-labelledby="hist-title">
        <div className="card-head">
          <div>
            <p className="eyebrow">Archive</p>
            <h2 id="hist-title">Draw history</h2>
          </div>
          {draws.data ? <p className="card-sub">{fmtInt(draws.data.total)} draws</p> : null}
        </div>
        {draws.error ? (
          <ErrorNotice message={draws.error} onRetry={draws.refetch} />
        ) : draws.data && draws.data.draws.length === 0 ? (
          <EmptyState title="No draws yet" hint="History will appear after the first fetch." />
        ) : (
          <>
            <div className="table-wrap" aria-busy={draws.loading}>
              <table className="history">
                <thead>
                  <tr>
                    <th scope="col">Draw</th>
                    <th scope="col">Date</th>
                    <th scope="col">Result</th>
                    <th scope="col">Sum</th>
                  </tr>
                </thead>
                <tbody>
                  {draws.data
                    ? draws.data.draws.map((d) => (
                        <tr key={d.drawNo}>
                          <td className="num">#{d.drawNo}</td>
                          <td>{fmtDate(d.date)}</td>
                          <td>
                            <BallRow letter={d.letter} numbers={d.numbers} bonus={d.bonus} bonusLabel={lottery?.bonusLabel} size="sm" />
                          </td>
                          <td className="num">{d.numbers.reduce((a, b) => a + b, 0)}</td>
                        </tr>
                      ))
                    : Array.from({ length: 8 }, (_, i) => (
                        <tr key={i}>
                          <td>
                            <Skeleton w={50} />
                          </td>
                          <td>
                            <Skeleton w={90} />
                          </td>
                          <td>
                            <SkeletonBalls n={mainCount + 1} />
                          </td>
                          <td>
                            <Skeleton w={30} />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            <div className="pager">
              <span aria-live="polite">
                Page {page + 1} of {totalPages}
              </span>
              <div className="btns">
                <button type="button" className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || draws.loading}>
                  ← Newer
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || draws.loading}
                >
                  Older →
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      <Disclaimer />
    </div>
  )
}
