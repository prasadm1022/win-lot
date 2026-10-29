// SPDX-License-Identifier: Apache-2.0
// Diverging bars around 1.00 for the v2 leans (numbers, letters, bonus): "pattern score, not a probability".
// Server-safe SVG: every bar carries its value as text (aria-label + <title>), so nothing depends on hover.
import { fmtSigned } from '../util/format'

export interface LeanItem {
  key: string
  lean: number
  j: number
  t: number
  d: number
}

interface Props {
  items: LeanItem[]
  /** What one item is, for the accessible text ("Number", "Letter", "Bonus"). */
  noun: string
  title: string
  /** Label every n-th bar on the x axis. */
  labelEvery?: number
  min?: number
  max?: number
}

export function LeanBars({ items, noun, title, labelEvery = 5, min = 0.75, max = 1.25 }: Props) {
  if (!items.length) return <p className="muted small">Nothing to show.</p>
  const W = 900
  const H = 190
  const padL = 46
  const padR = 8
  const padT = 12
  const padB = 24
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const yOf = (v: number) => padT + ((max - v) / (max - min)) * innerH
  const base = yOf(1)
  const slot = innerW / items.length
  const bw = Math.max(2, slot - 2)
  const ticks = [max, (1 + max) / 2, 1, (1 + min) / 2, min]
  const describe = (it: LeanItem) =>
    `${noun} ${it.key}: pattern score ${it.lean.toFixed(2)} (jackpot combinations ${fmtSigned(it.j, 3)}, jackpot dates ${fmtSigned(
      it.t,
      3,
    )}, daily draws ${fmtSigned(it.d, 3)})`
  /** Short hover text (the full sentence is the aria-label). */
  const brief = (it: LeanItem) => `${it.key}: ${it.lean.toFixed(2)} · J ${fmtSigned(it.j, 3)} · T ${fmtSigned(it.t, 3)} · D ${fmtSigned(it.d, 3)}`

  return (
    <div className="chart lean-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${title}: pattern score per ${noun.toLowerCase()}, 1.00 means no lean`}>
        <g className="axis">
          {ticks.map((t) => (
            <g key={t}>
              <line className="grid-line" x1={padL} x2={W - padR} y1={yOf(t)} y2={yOf(t)} />
              <text x={padL - 6} y={yOf(t) + 4} textAnchor="end">
                {t.toFixed(2)}
              </text>
            </g>
          ))}
        </g>
        <line className="lean-base" x1={padL} x2={W - padR} y1={base} y2={base} />
        <g role="list">
          {items.map((it, i) => {
            const y = yOf(it.lean)
            const x = padL + i * slot + 1
            const up = it.lean >= 1
            const h = Math.max(0.5, Math.abs(y - base))
            return (
              <g key={it.key} role="listitem" aria-label={describe(it)}>
                <rect className={`lean-bar ${up ? 'up' : 'down'}`} x={x} y={up ? y : base} width={bw} height={h} rx={Math.min(2, bw / 2)} />
                {i % labelEvery === 0 || labelEvery === 1 ? (
                  <text className="axis" x={x + bw / 2} y={H - 7} textAnchor="middle" fill="var(--viz-axis)" fontSize="11">
                    {it.key}
                  </text>
                ) : null}
                <title>{brief(it)}</title>
              </g>
            )
          })}
        </g>
      </svg>
      <p className="lean-caption small muted">
        <b>Pattern score, not a probability.</b> 1.00 = no lean; a bar above the line leans toward that {noun.toLowerCase()}, below it
        away. No score leaves {min.toFixed(2)} to {max.toFixed(2)}. Hover text: J = jackpot combinations, T = jackpot dates, D = daily draws.
      </p>
    </div>
  )
}
