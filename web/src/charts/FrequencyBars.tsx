import type { Stats } from '../api/types'
import { niceTicks, useTooltip } from './useTooltip'

interface Props {
  stats: Stats
}

type Tag = 'hot' | 'cold' | 'overdue' | ''

/**
 * One bar per number. Single series (gold); hot/cold/overdue are status-like highlights
 * with a legend and chips, so the information is never colour-alone.
 */
export function FrequencyBars({ stats }: Props) {
  const { show, hide, el } = useTooltip()
  const data = stats.frequency
  const hot = new Set(stats.hot)
  const cold = new Set(stats.cold)
  const overdue = new Set(stats.overdue)
  const tagOf = (n: number): Tag => (hot.has(n) ? 'hot' : cold.has(n) ? 'cold' : overdue.has(n) ? 'overdue' : '')

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

  return (
    <div className="chart">
      <div className="legend" aria-hidden="true">
        <span>
          <i style={{ background: 'var(--viz-series-1)' }} />
          Draw count
        </span>
        <span>
          <i style={{ background: 'var(--viz-hot)' }} />
          Hot (top 10)
        </span>
        <span>
          <i style={{ background: 'var(--viz-cold)' }} />
          Cold (bottom 10)
        </span>
        <span>
          <i style={{ background: 'var(--viz-overdue)' }} />
          Overdue
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Frequency of each number over ${stats.drawCount} draws`}>
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
        {data.map((d, i) => {
          const h = (d.count / top) * innerH
          const x = padL + i * slot + 1
          const y = padT + innerH - h
          const tag = tagOf(d.n)
          return (
            <g key={d.n}>
              <rect
                className={`bar ${tag}`}
                x={x}
                y={y}
                width={bw}
                height={h}
                rx={Math.min(3, bw / 2)}
              />
              <rect
                className="hit"
                x={padL + i * slot}
                y={padT}
                width={slot}
                height={innerH}
                onMouseMove={(e) =>
                  show(e, (
                    <>
                      <b>#{d.n}</b> · {d.count} draws
                      {tag ? ` · ${tag}` : ''}
                      <br />
                      last seen {d.lastSeenDrawsAgo} draws ago
                    </>
                  ))
                }
                onMouseLeave={hide}
              />
              {i % labelEvery === 0 ? (
                <text className="axis" x={x + bw / 2} y={H - 8} textAnchor="middle" fill="var(--viz-axis)" fontSize="11">
                  {d.n}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      {el}
    </div>
  )
}
