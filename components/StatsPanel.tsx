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
  /** Balls no longer in use (prediction.liveBalls.excluded): left out of the "least drawn" and "longest gap" lists. */
  excluded?: number[]
}

/** [76, 77, 78, 79, 80] -> "76-80". */
function ranges(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`)
    i = j + 1
  }
  return out.join(', ')
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
export function StatsPanel({ lottery, stats, excluded = [] }: Props) {
  const [win, setWin] = useState<StatsWindow>('all')
  const s = stats[win]
  const { mainCount, mainMin, mainMax } = lottery
  const dead = new Set(excluded)
  // A ball that is no longer in the machine is neither "least drawn" nor "longest gap": it is simply not in use.
  const joinTop = (xs: number[]) => {
    const live = xs.filter((n) => !dead.has(n)).slice(0, 5)
    return live.length ? live.join(' · ') : '-'
  }

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
            <p className="label">Most drawn</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.hot)}
            </p>
          </div>
          <div className="stat">
            <p className="label">Least drawn</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.cold)}
            </p>
          </div>
          <div className="stat">
            <p className="label">Longest gap since drawn</p>
            <p className="value" style={{ fontSize: '1rem' }}>
              {joinTop(s.overdue)}
            </p>
          </div>
        </div>
        <p className="small muted" style={{ margin: '-8px 0 0' }}>
          These describe past draws only. A lottery draw has no memory, so none of them changes the next draw.
          {excluded.length
            ? ` ${excluded.length === 1 ? 'Ball' : 'Balls'} ${ranges(excluded)} ${excluded.length === 1 ? 'is' : 'are'} no longer in use and ${
                excluded.length === 1 ? 'is' : 'are'
              } left out of these lists.`
            : ''}
        </p>

        <div className="card">
          <div className="card-head">
            <h3>Number frequency</h3>
            <p className="card-sub">How many times each number was drawn</p>
          </div>
          <FrequencyBars stats={s} excluded={excluded} />
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
