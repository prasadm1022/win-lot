// SPDX-License-Identifier: Apache-2.0
'use client'
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Prediction, Stats } from '@/lib/types'
import { fmtDate } from '../util/format'

/** 6-step single-hue (gold) sequential ramp from tokens; t in 0..1. */
function seqStep(t: number): number {
  return Math.max(0, Math.min(5, Math.round(t * 5)))
}
function seqVar(t: number): string {
  return `var(--viz-seq-${seqStep(t)})`
}
/**
 * Ink per ramp step (never per threshold, so the ink always matches the fill it sits on). The theme tokens
 * --seq-ink-3 and --seq-ink-hi (app/globals.css) pick dark or light ink for the mid-gold and high steps so every cell
 * keeps at least 4.5:1 in both themes (spec 7.6); the low steps use the ordinary ink.
 */
function seqInk(t: number): string {
  const step = seqStep(t)
  return step >= 4 ? 'var(--seq-ink-hi)' : step === 3 ? 'var(--seq-ink-3)' : 'var(--ink)'
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

interface ScoreProps {
  scores: Prediction['numberScores']
  mainMin: number
  /** Balls no longer in use (prediction.liveBalls.excluded) and since when (prediction.liveBalls.since). */
  excluded?: number[]
  since?: string | null
}

/** Cells per visual row of a grid (its resolved track list), for the up and down keys; 10 until the grid is laid out. */
function columnsOf(grid: HTMLElement | null): number {
  if (!grid || typeof getComputedStyle !== 'function') return 10
  const tracks = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
  return tracks > 0 ? tracks : 10
}

/**
 * v2 pattern score per number (a min-max of the lean: not a probability). Balls not in use are drawn as dashed,
 * empty cells and say so in text; they are never confused with a low score. The grid is one tab stop: the arrow
 * keys (and Home / End) walk the cells, the reached cell shows the same text the mouse gets as a tooltip and a live
 * region speaks it (spec 7.6), the same pattern as the frequency and sum charts.
 */
export function NumberScoreHeatmap({ scores, mainMin, excluded = [], since = null }: ScoreProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const [kb, setKb] = useState<number | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  if (!scores.length) return <p className="muted small">No scores yet.</p>
  const dead = new Set(excluded)
  const live = scores.filter((s) => !dead.has(s.n))
  const max = Math.max(...live.map((s) => s.score), 0.0001)
  const min = Math.min(...live.map((s) => s.score))
  const norm = (s: number) => (max === min ? 0.5 : (s - min) / (max - min))
  const sorted = [...scores].sort((a, b) => a.n - b.n)
  const sinceText = since ? `not drawn since ${fmtDate(since)}` : 'not drawn in the current range'
  /** The cell's facts (aria-label and the live region). */
  const textOf = (s: Prediction['numberScores'][number]): string =>
    dead.has(s.n) ? `Number ${s.n}: not in use, ${sinceText}` : `Number ${s.n}: pattern score ${(s.score * 100).toFixed(0)} of 100`
  /** The hover tooltip (title), also shown for the cell reached with the keyboard. */
  const tipOf = (s: Prediction['numberScores'][number]): string => (dead.has(s.n) ? textOf(s) : `#${s.n} · pattern score ${(s.score * 100).toFixed(0)}`)

  /** Reach cell i: mark it and place the tooltip above it, in px relative to the focusable wrapper. */
  const reach = (i: number) => {
    setKb(i)
    const grid = gridRef.current
    const wrap = grid?.parentElement
    const cell = grid?.children[i] as HTMLElement | undefined
    if (!cell || !wrap) return
    const c = cell.getBoundingClientRect()
    const w = wrap.getBoundingClientRect()
    // Keep the (centred, at most 240px wide) tooltip inside the wrapper so it never widens a phone page.
    const half = 120
    setPos({ left: Math.max(half, Math.min(Math.max(half, w.width - half), c.left - w.left + c.width / 2)), top: c.top - w.top })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = sorted.length - 1
    const cols = columnsOf(gridRef.current)
    const next =
      e.key === 'ArrowRight'
        ? Math.min(last, (kb ?? -1) + 1)
        : e.key === 'ArrowLeft'
          ? Math.max(0, (kb ?? sorted.length) - 1)
          : e.key === 'ArrowDown'
            ? kb === null
              ? 0
              : Math.min(last, kb + cols)
            : e.key === 'ArrowUp'
              ? kb === null
                ? last
                : Math.max(0, kb - cols)
              : e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : null
    if (next === null) return
    e.preventDefault()
    reach(next)
  }

  return (
    <div>
      <div
        className="heat-grid-wrap"
        role="group"
        tabIndex={0}
        aria-label="Pattern score per number. Use the arrow keys to read each number."
        onKeyDown={onKeyDown}
        onBlur={() => setKb(null)}
      >
        <div ref={gridRef} className="heat-grid" role="list">
          {sorted.map((s, i) => {
            const text = textOf(s)
            const isDead = dead.has(s.n)
            const t = isDead ? 0 : norm(s.score)
            const style = isDead ? undefined : ({ '--cell': seqVar(t), '--cell-ink': seqInk(t) } as CSSProperties)
            return (
              <span
                key={s.n}
                className={`heat-cell${isDead ? ' dead' : ''}${kb === i ? ' kb' : ''}`}
                style={style}
                role="listitem"
                aria-label={text}
                title={tipOf(s)}
              >
                {s.n}
              </span>
            )
          })}
        </div>
        {kb !== null && pos ? (
          <span className="chart-tooltip heat-tip" aria-hidden="true" style={{ left: pos.left, top: pos.top }}>
            {tipOf(sorted[kb])}
          </span>
        ) : null}
      </div>
      <span className="sr-only" aria-live="polite">
        {kb !== null ? textOf(sorted[kb]) : ''}
      </span>
      <div className="heat-scale" aria-hidden="true">
        <span>lower</span>
        <span className="ramp" />
        <span>higher pattern score</span>
        <span style={{ marginLeft: 'auto' }}>from {mainMin}</span>
      </div>
      {excluded.length ? (
        <p className="heat-dead-note small muted">
          <span className="heat-cell dead mini" aria-hidden="true" />
          Dashed cells {ranges(excluded)}: balls not in use, {sinceText}. They have no score.
        </p>
      ) : null}
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
