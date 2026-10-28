// SPDX-License-Identifier: Apache-2.0
'use client'
import { useEffect, useState } from 'react'
import { drawInstant, fmtDate } from './util/format'

interface Props {
  dateIso: string
  variant?: 'tiles' | 'inline'
}

interface Remaining {
  d: number
  h: number
  m: number
  s: number
  past: boolean
}

function remaining(target: Date): Remaining {
  const diff = target.getTime() - Date.now()
  if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0, past: true }
  const s = Math.floor(diff / 1000)
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
    past: false,
  }
}

const two = (n: number) => String(n).padStart(2, '0')

/**
 * Counts down to 20:00 Colombo time on the draw date. The static HTML carries a neutral
 * placeholder; the real value appears after hydration and ticks once a second.
 */
export function Countdown({ dateIso, variant = 'tiles' }: Props) {
  const [r, setR] = useState<Remaining | null>(null)

  useEffect(() => {
    const target = drawInstant(dateIso)
    setR(remaining(target))
    const t = setInterval(() => setR(remaining(target)), 1000)
    return () => clearInterval(t)
  }, [dateIso])

  const text = !r
    ? `Next draw on ${fmtDate(dateIso)} at 8 pm`
    : r.past
      ? `Draw time has passed (${fmtDate(dateIso)}); results arrive after the daily refresh.`
      : `Next draw in ${r.d} days ${r.h} hours ${r.m} minutes`

  if (variant === 'inline') {
    return (
      <span className="countdown-inline" aria-live="off" title={text}>
        {!r ? '--:--:--' : r.past ? 'Awaiting results' : `${r.d > 0 ? `${r.d}d ` : ''}${two(r.h)}:${two(r.m)}:${two(r.s)}`}
      </span>
    )
  }

  const unit = (v: string, name: string) => (
    <span className="unit" aria-hidden="true">
      <b>{v}</b>
      <span>{name}</span>
    </span>
  )
  return (
    <div className="countdown" role="timer" aria-label={text}>
      {r && r.d > 0 ? unit(String(r.d), 'days') : null}
      {unit(r ? two(r.h) : '--', 'hrs')}
      {unit(r ? two(r.m) : '--', 'min')}
      {unit(r ? two(r.s) : '--', 'sec')}
    </div>
  )
}
