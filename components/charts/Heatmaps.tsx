// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from 'react'
import type { Prediction, Stats } from '@/lib/types'

/** 6-step single-hue (gold) sequential ramp from tokens; t in 0..1. */
function seqVar(t: number): string {
  const step = Math.max(0, Math.min(5, Math.round(t * 5)))
  return `var(--viz-seq-${step})`
}
function seqInk(t: number): string {
  // Bright gold steps on dark need dark ink; the light ramp goes dark at the high end,
  // so the same threshold flips to inverse ink via the theme token.
  return t >= 0.6 ? 'var(--seq-ink-hi, var(--ink-inverse))' : 'var(--ink)'
}

export function NumberScoreHeatmap({ scores, mainMin }: { scores: Prediction['numberScores']; mainMin: number }) {
  if (!scores.length) return <p className="muted small">No scores yet.</p>
  const max = Math.max(...scores.map((s) => s.score), 0.0001)
  const min = Math.min(...scores.map((s) => s.score))
  const norm = (s: number) => (max === min ? 0.5 : (s - min) / (max - min))
  const sorted = [...scores].sort((a, b) => a.n - b.n)
  return (
    <div>
      <div className="heat-grid" role="list" aria-label="Score per number">
        {sorted.map((s) => {
          const t = norm(s.score)
          const style = { '--cell': seqVar(t), '--cell-ink': seqInk(t) } as CSSProperties
          return (
            <span
              key={s.n}
              className="heat-cell"
              style={style}
              role="listitem"
              tabIndex={0}
              aria-label={`Number ${s.n}, score ${(s.score * 100).toFixed(0)} of 100`}
              title={`#${s.n} · score ${(s.score * 100).toFixed(0)}`}
            >
              {s.n}
            </span>
          )
        })}
      </div>
      <div className="heat-scale" aria-hidden="true">
        <span>lower</span>
        <span className="ramp" />
        <span>higher score</span>
        <span style={{ marginLeft: 'auto' }}>from {mainMin}</span>
      </div>
    </div>
  )
}

export function PositionHeatmap({ heat, mainMin, mainCount }: { heat: Stats['positionHeat']; mainMin: number; mainCount: number }) {
  if (!heat.length || !heat[0].length) return <p className="muted small">No position data.</p>
  const cols = heat[0].length
  const max = Math.max(1, ...heat.flat())
  const style = {
    gridTemplateColumns: `auto repeat(${cols}, minmax(6px, 1fr))`,
  } as CSSProperties
  const labelEvery = cols > 50 ? 10 : 5
  return (
    <div className="pos-heat-wrap">
      <div className="pos-heat" style={style} role="table" aria-label="How often each number appears in each drawn position">
        {heat.slice(0, mainCount).map((row, p) => (
          <div key={p} role="row" style={{ display: 'contents' }}>
            <span className="rowlabel" role="rowheader">
              Pos {p + 1}
            </span>
            {row.map((c, k) => (
              <span
                key={k}
                role="cell"
                className="cell"
                style={{ '--cell': seqVar(c / max) } as CSSProperties}
                title={`Position ${p + 1}, number ${mainMin + k}: ${c} draws`}
                aria-label={`Position ${p + 1}, number ${mainMin + k}: ${c} draws`}
              />
            ))}
          </div>
        ))}
        <div role="row" style={{ display: 'contents' }}>
          <span className="rowlabel" role="rowheader" aria-hidden="true" />
          {heat[0].map((_, k) => (
            <span key={k} role="cell" className="rowlabel" style={{ justifyContent: 'center', padding: 0, fontSize: '0.65rem' }}>
              {(k + 1) % labelEvery === 0 || k === 0 ? mainMin + k : ''}
            </span>
          ))}
        </div>
      </div>
      <div className="heat-scale" aria-hidden="true">
        <span>0</span>
        <span className="ramp" />
        <span>{max} draws</span>
      </div>
    </div>
  )
}
