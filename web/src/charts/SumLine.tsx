// SPDX-License-Identifier: Apache-2.0
import { useState } from 'react'
import type { Stats } from '../api/types'
import { fmtDateShort } from '../lib/format'
import { niceTicks } from './useTooltip'

interface Props {
  series: Stats['sumSeries']
  mainCount: number
  mainMin: number
  mainMax: number
}

/** Sum of the drawn numbers per draw (last 200), with the expected mean as a dashed reference. */
export function SumLine({ series, mainCount, mainMin, mainMax }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  if (series.length < 2) return <p className="muted small">Not enough draws for a trend yet.</p>

  const W = 900
  const H = 240
  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const expected = (mainCount * (mainMin + mainMax)) / 2
  const vals = series.map((s) => s.sum)
  const lo = Math.min(...vals, expected)
  const hi = Math.max(...vals, expected)
  const ticks = niceTicks(hi)
  const yMin = Math.max(0, Math.floor(lo / 10) * 10 - 10)
  const yMax = ticks[ticks.length - 1] || hi
  const x = (i: number) => padL + (i / (series.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH
  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.sum).toFixed(1)}`).join(' ')
  const area = `${path} L${x(series.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`
  const h = hover !== null ? series[hover] : null
  const yTicks = niceTicks(yMax - yMin, 4).map((t) => t + yMin)
  const xLabelEvery = Math.max(1, Math.floor(series.length / 6))

  return (
    <div className="chart">
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: 'var(--viz-series-1)' }} />
          Sum of numbers
        </span>
        <span>
          <i style={{ background: 'var(--viz-series-2)' }} />
          Expected mean ({expected})
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Sum of drawn numbers over the last ${series.length} draws; expected mean ${expected}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const px = ((e.clientX - rect.left) / rect.width) * W
          const i = Math.round(((px - padL) / innerW) * (series.length - 1))
          setHover(Math.max(0, Math.min(series.length - 1, i)))
        }}
      >
        <g className="axis">
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
              <text x={padL - 6} y={y(t) + 4} textAnchor="end">
                {t}
              </text>
            </g>
          ))}
          {series.map((s, i) =>
            (i % xLabelEvery === 0 && series.length - 1 - i > xLabelEvery * 0.6) || i === series.length - 1 ? (
              <text key={s.drawNo} x={x(i)} y={H - 8} textAnchor={i === series.length - 1 ? 'end' : 'middle'}>
                {fmtDateShort(s.date)}
              </text>
            ) : null,
          )}
        </g>
        <path className="area" d={area} />
        <line className="line secondary" x1={padL} x2={W - padR} y1={y(expected)} y2={y(expected)} />
        <path className="line" d={path} />
        {h ? (
          <g>
            <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={padT} y2={padT + innerH} />
            <circle className="marker" cx={x(hover!)} cy={y(h.sum)} r={5} />
          </g>
        ) : (
          <circle className="marker" cx={x(series.length - 1)} cy={y(vals[vals.length - 1])} r={4} />
        )}
      </svg>
      {h ? (
        <div
          className="chart-tooltip"
          role="tooltip"
          style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(h.sum) / H) * 100}%` }}
        >
          <b>Draw {h.drawNo}</b> · {fmtDateShort(h.date)}
          <br />
          sum {h.sum} ({h.sum > expected ? '+' : ''}
          {h.sum - expected} vs mean)
        </div>
      ) : null}
    </div>
  )
}
