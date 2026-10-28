// SPDX-License-Identifier: Apache-2.0
import type { Stats } from '../api/types'
import { fmtPct } from '../lib/format'
import { ZODIAC_GLYPH } from '../lib/lotteryMeta'

interface Row {
  label: string
  count: number
  hl?: boolean
}

function Bars({ rows, total, ariaLabel }: { rows: Row[]; total: number; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="dist" role="list" aria-label={ariaLabel}>
      {rows.map((r) => (
        <div key={r.label} className={`dist-row${r.hl ? ' hl' : ''}`} role="listitem">
          <span>{r.label}</span>
          <span className="track" aria-hidden="true">
            <span className="fill" style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="val">
            {total ? fmtPct(r.count / total) : '—'}
            <span className="sr-only">
              , {r.count} draws
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function OddEven({ stats }: { stats: Stats }) {
  const rows: Row[] = stats.oddEven.map((r) => ({ label: `${r.odd} odd · ${r.even} even`, count: r.count }))
  const top = Math.max(...rows.map((r) => r.count))
  rows.forEach((r) => (r.hl = r.count === top))
  return <Bars rows={rows} total={stats.drawCount} ariaLabel="Odd/even split of each draw" />
}

export function HighLow({ stats }: { stats: Stats }) {
  const rows: Row[] = stats.highLow.map((r) => ({ label: `${r.high} high · ${r.low} low`, count: r.count }))
  const top = Math.max(...rows.map((r) => r.count))
  rows.forEach((r) => (r.hl = r.count === top))
  return <Bars rows={rows} total={stats.drawCount} ariaLabel="High/low split of each draw" />
}

export function LetterFrequency({ stats }: { stats: Stats }) {
  if (!stats.letterFrequency.length) return <p className="muted small">This lottery has no letter.</p>
  const sorted = [...stats.letterFrequency].sort((a, b) => b.count - a.count)
  const max = sorted[0].count
  const W = 900
  const H = 170
  const padB = 24
  const slot = W / sorted.length
  const bw = Math.max(3, slot - 3)
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Letter frequency, most common ${sorted[0].letter} with ${max} draws`}>
        {sorted.map((d, i) => {
          const h = (d.count / max) * (H - padB - 18)
          const x = i * slot + 1.5
          const y = H - padB - h
          return (
            <g key={d.letter}>
              <rect className={`bar${i === 0 ? '' : ' dim'}`} x={x} y={y} width={bw} height={h} rx={3} />
              <text className="value-label" x={x + bw / 2} y={y - 4} textAnchor="middle">
                {d.count}
              </text>
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fill="var(--viz-axis)" fontSize="15" fontWeight={i === 0 ? 700 : 400}>
                {ZODIAC_GLYPH[d.letter] ?? d.letter}
              </text>
              <title>
                {d.letter}: {d.count} draws
              </title>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function TopPairs({ stats }: { stats: Stats }) {
  if (!stats.pairs.length) return <p className="muted small">No pairs yet.</p>
  const max = stats.pairs[0].count
  return (
    <div className="chips" role="list" aria-label="Most frequent number pairs">
      {stats.pairs.slice(0, 20).map((p) => (
        <span key={`${p.a}-${p.b}`} className="chip" role="listitem" title={`${p.a} & ${p.b} drawn together ${p.count} times`}>
          <i style={{ background: 'var(--viz-series-1)', opacity: 0.4 + 0.6 * (p.count / max) }} aria-hidden="true" />
          {p.a}&thinsp;&amp;&thinsp;{p.b}
          <span className="muted">×{p.count}</span>
        </span>
      ))}
    </div>
  )
}
