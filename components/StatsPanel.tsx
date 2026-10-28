// SPDX-License-Identifier: Apache-2.0
'use client'
import { useState } from 'react'
import type { Lottery, Stats, StatsWindow } from '@/lib/types'
import { fmtInt } from './util/format'
import { FrequencyBars } from './charts/FrequencyBars'
import { SumLine } from './charts/SumLine'
import { PositionHeatmap } from './charts/Heatmaps'
import { HighLow, LetterFrequency, OddEven, TopPairs } from './charts/Distributions'

const WINDOWS: { key: StatsWindow; label: string }[] = [
  { key: 'all', label: 'All draws' },
  { key: '500', label: 'Last 500' },
  { key: '100', label: 'Last 100' },
]

interface Props {
  lottery: Pick<Lottery, 'mainCount' | 'mainMin' | 'mainMax' | 'letterKind'>
  /** All three windows are precomputed at build time; switching is instant. */
  stats: Record<StatsWindow, Stats>
}

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

/** "Patterns in past draws": window switcher + every history chart. */
export function StatsPanel({ lottery, stats }: Props) {
  const [win, setWin] = useState<StatsWindow>('all')
  const s = stats[win]
  const { mainCount, mainMin, mainMax } = lottery
  const joinTop = (xs: number[]) => (xs.length ? xs.slice(0, 5).join(' · ') : '—')

  return (
    <section aria-labelledby="stats-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">History statistics</p>
          <h2 id="stats-title">Patterns in past draws</h2>
        </div>
        <WindowSwitch value={win} onChange={setWin} />
      </div>

      <div className="stack" style={{ gap: 18 }} aria-live="polite">
        <div className="stat-row">
          <div className="stat">
            <p className="label">Draws in window</p>
            <p className="value">{fmtInt(s.drawCount)}</p>
          </div>
          <div className="stat">
            <p className="label">Hot</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.hot)}
            </p>
          </div>
          <div className="stat">
            <p className="label">Cold</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.cold)}
            </p>
          </div>
          <div className="stat">
            <p className="label">Overdue</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.overdue)}
            </p>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Number frequency</h3>
            <p className="card-sub">How many times each number was drawn</p>
          </div>
          <FrequencyBars stats={s} />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>Sum of numbers over time</h3>
            <p className="card-sub">Last {Math.min(200, s.sumSeries.length)} draws</p>
          </div>
          <SumLine series={s.sumSeries} mainCount={mainCount} mainMin={mainMin} mainMax={mainMax} />
        </div>

        <div className="grid grid-3">
          <div className="card">
            <div className="card-head">
              <h3>Odd / even</h3>
            </div>
            <OddEven stats={s} />
          </div>
          <div className="card">
            <div className="card-head">
              <h3>High / low</h3>
              <p className="card-sub">High = above {(mainMin + mainMax) / 2}</p>
            </div>
            <HighLow stats={s} />
          </div>
          <div className="card">
            <div className="card-head">
              <h3>Top pairs</h3>
              <p className="card-sub">Drawn together most often</p>
            </div>
            <TopPairs stats={s} />
          </div>
        </div>

        {lottery.letterKind !== 'none' ? (
          <div className="card">
            <div className="card-head">
              <h3>{lottery.letterKind === 'zodiac' ? 'Zodiac sign' : 'Letter'} frequency</h3>
            </div>
            <LetterFrequency stats={s} />
          </div>
        ) : null}

        <div className="card">
          <div className="card-head">
            <h3>Position heatmap</h3>
            <p className="card-sub">Which numbers tend to be drawn first, second, …</p>
          </div>
          <PositionHeatmap heat={s.positionHeat} mainMin={mainMin} mainCount={mainCount} />
        </div>
      </div>
    </section>
  )
}
