// SPDX-License-Identifier: Apache-2.0
'use client'
import { useRef, useState, type KeyboardEvent } from 'react'
import type { Stats } from '@/lib/types'
import { niceTicks, useTooltip } from './useTooltip'

interface Props {
  stats: Stats
  /** Balls no longer in use (prediction.liveBalls.excluded): drawn dimmed, never tagged, and said so in text. */
  excluded?: number[]
}

type Tag = 'hot' | 'cold' | 'overdue' | ''

/** Visible names: descriptions of past frequency only, never a claim about the next draw. */
const TAG_TEXT: Record<Exclude<Tag, ''>, string> = { hot: 'most drawn', cold: 'least drawn', overdue: 'longest gap' }

/**
 * One bar per number. Single series (gold); hot/cold/overdue are status-like highlights with a legend and chips, so
 * the information is never colour-alone. Every bar carries its facts as text (aria-label and <title>), and the chart
 * takes focus: the arrow keys walk the bars and show the same tooltip the mouse gets (spec 7.6).
 */
export function FrequencyBars({ stats, excluded = [] }: Props) {
  const { show, hide, el } = useTooltip()
  const svgRef = useRef<SVGSVGElement>(null)
  const [kb, setKb] = useState<number | null>(null)
  const data = stats.frequency
  if (!data.length) return <p className="muted small">No draws in this window.</p>
  const dead = new Set(excluded)
  const hot = new Set(stats.hot)
  const cold = new Set(stats.cold)
  const overdue = new Set(stats.overdue)
  const tagOf = (n: number): Tag => (dead.has(n) ? '' : hot.has(n) ? 'hot' : cold.has(n) ? 'cold' : overdue.has(n) ? 'overdue' : '')

  const W = 900
  const H = 240
  const padL = 34
  const padB = 26
  const padT = 10
  const innerW = W - padL - 8
  const innerH = H - padT - padB
  const max = Math.max(1, ...data.map((d) => d.count))
  const ticks = niceTicks(max)
  const top = ticks[ticks.length - 1] || max
  const slot = innerW / data.length
  const bw = Math.max(2, slot - 2) // 2px surface gap
  const labelEvery = data.length > 50 ? 10 : data.length > 25 ? 5 : 1

  /** "last seen 12 draws ago", or "never drawn in this window" (lib/stats.ts sets lastSeenDrawsAgo to null then). */
  const lastSeen = (d: Stats['frequency'][number]): string => {
    const ago: number | null = d.lastSeenDrawsAgo
    return ago === null || d.count === 0 ? 'never drawn in this window' : `last seen ${ago} ${ago === 1 ? 'draw' : 'draws'} ago`
  }
  const factsOf = (d: Stats['frequency'][number]): string => {
    const tag = tagOf(d.n)
    return `Number ${d.n}: ${d.count} draws, ${lastSeen(d)}${tag ? `, ${TAG_TEXT[tag]}` : ''}${dead.has(d.n) ? ', not in use' : ''}`
  }
  const tip = (d: Stats['frequency'][number]) => {
    const tag = tagOf(d.n)
    return (
      <>
        <b>#{d.n}</b> · {d.count} draws
        {tag ? ` · ${TAG_TEXT[tag]}` : ''}
        {dead.has(d.n) ? ' · not in use' : ''}
        <br />
        {lastSeen(d)}
      </>
    )
  }
  /** Show the tooltip for bar i at the bar's top, from the keyboard (no pointer position). */
  const showBar = (i: number) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const d = data[i]
    const x = padL + i * slot + 1 + bw / 2
    const y = padT + innerH - (d.count / top) * innerH
    show({ clientX: rect.left + (x / W) * rect.width, clientY: rect.top + (y / H) * rect.height, currentTarget: svg }, tip(d))
    setKb(i)
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = data.length - 1
    const next =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? Math.min(last, (kb ?? -1) + 1)
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? Math.max(0, (kb ?? data.length) - 1)
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : null
    if (next === null) return
    e.preventDefault()
    showBar(next)
  }

  return (
    <div className="chart">
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: 'var(--viz-series-1)' }} />
          Draw count
        </span>
        <span>
          <i style={{ background: 'var(--viz-hot)' }} />
          Most drawn (top 10)
        </span>
        <span>
          <i style={{ background: 'var(--viz-cold)' }} />
          Least drawn (bottom 10)
        </span>
        <span>
          <i style={{ background: 'var(--viz-overdue)' }} />
          Longest gap since drawn
        </span>
        {excluded.length ? (
          <span>
            <i style={{ background: 'var(--viz-series-1)', opacity: 0.45 }} />
            Not in use
          </span>
        ) : null}
      </div>
      <div className="chart-scroll">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          tabIndex={0}
          aria-label={`Frequency of each number over ${stats.drawCount} draws. Use the arrow keys to read each bar.`}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setKb(null)
            hide()
          }}
        >
          <g className="axis">
            {ticks.map((t) => {
              const y = padT + innerH - (t / top) * innerH
              return (
                <g key={t}>
                  <line className="grid-line" x1={padL} x2={W - 8} y1={y} y2={y} />
                  <text x={padL - 6} y={y + 4} textAnchor="end">
                    {t}
                  </text>
                </g>
              )
            })}
          </g>
          <g role="list">
            {data.map((d, i) => {
              const h = (d.count / top) * innerH
              const x = padL + i * slot + 1
              const y = padT + innerH - h
              const tag = tagOf(d.n)
              return (
                <g key={d.n} role="listitem" aria-label={factsOf(d)}>
                  <rect className={`bar ${tag}${dead.has(d.n) ? ' dim' : ''}`} x={x} y={y} width={bw} height={h} rx={Math.min(3, bw / 2)} />
                  <rect
                    className={`hit${kb === i ? ' kb' : ''}`}
                    x={padL + i * slot}
                    y={padT}
                    width={slot}
                    height={innerH}
                    onMouseMove={(e) => show(e, tip(d))}
                    onMouseLeave={hide}
                  />
                  {i % labelEvery === 0 ? (
                    <text className="axis" x={x + bw / 2} y={H - 8} textAnchor="middle" fill="var(--viz-axis)" fontSize="11">
                      {d.n}
                    </text>
                  ) : null}
                  <title>{factsOf(d)}</title>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
      <span className="sr-only" aria-live="polite">
        {kb !== null ? factsOf(data[kb]) : ''}
      </span>
      {el}
    </div>
  )
}
