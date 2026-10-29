// SPDX-License-Identifier: Apache-2.0
'use client'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { Stats } from '@/lib/types'
import { fmtDateShort } from '../util/format'
import { niceTicks } from './useTooltip'

interface Props {
  series: Stats['sumSeries']
  mainCount: number
  mainMin: number
  mainMax: number
}

/**
 * Sum of the drawn numbers per draw (last 200), with the expected mean as a dashed reference. The chart takes focus:
 * the arrow keys walk the draws and show the same reading the mouse gets, and a live region speaks it (spec 7.6).
 * On phones the chart scrolls sideways (.chart-scroll, as the frequency chart does) so the axis labels keep their
 * size; the tooltip sits outside that scrolling box and is placed from the svg's measured position, never clipped.
 */
export function SumLine({ series, mainCount, mainMin, mainMax }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
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
  const reading = (s: Stats['sumSeries'][number]) => `Draw ${s.drawNo}, ${fmtDateShort(s.date)}: sum ${s.sum} (${s.sum > expected ? '+' : ''}${s.sum - expected} vs mean)`

  /** Select draw i and place the tooltip over its point, in px relative to the .chart wrapper (the svg may be wider and scrolled). */
  const select = (i: number) => {
    setHover(i)
    const svg = svgRef.current
    const wrap = svg?.closest('.chart')
    if (!svg || !wrap) return
    const r = svg.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    setPos({ left: r.left - w.left + (x(i) / W) * r.width, top: r.top - w.top + (y(series[i].sum) / H) * r.height })
  }

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = series.length - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? Math.min(last, (hover ?? -1) + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? Math.max(0, (hover ?? series.length) - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    select(next)
  }

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
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          tabIndex={0}
          aria-label={`Sum of drawn numbers over the last ${series.length} draws; expected mean ${expected}. Use the arrow keys to read each draw.`}
          onKeyDown={onKeyDown}
          onFocus={() => {
            if (hover === null) select(series.length - 1)
          }}
          onBlur={() => setHover(null)}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - rect.left) / rect.width) * W
            const i = Math.round(((px - padL) / innerW) * (series.length - 1))
            select(Math.max(0, Math.min(series.length - 1, i)))
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
          {h && hover !== null ? (
            <g>
              <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} />
              <circle className="marker" cx={x(hover)} cy={y(h.sum)} r={5} />
            </g>
          ) : (
            <circle className="marker" cx={x(series.length - 1)} cy={y(vals[vals.length - 1])} r={4} />
          )}
        </svg>
      </div>
      <span className="sr-only" aria-live="polite">
        {h ? reading(h) : ''}
      </span>
      {h && hover !== null ? (
        <div
          className="chart-tooltip"
          role="tooltip"
          style={pos ? { left: pos.left, top: pos.top } : { left: `${(x(hover) / W) * 100}%`, top: `${(y(h.sum) / H) * 100}%` }}
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
