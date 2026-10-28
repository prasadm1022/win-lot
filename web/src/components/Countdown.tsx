// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from 'react'
import { drawInstant, fmtDate } from '../lib/format'

interface Props {
  dateIso: string
  variant?: 'tiles' | 'inline'
}

function remaining(target: Date): { d: number; h: number; m: number; s: number; past: boolean } {
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

/** Counts down to 20:00 Colombo time on the draw date. Updates once a second. */
export function Countdown({ dateIso, variant = 'tiles' }: Props) {
  const target = drawInstant(dateIso)
  const [r, setR] = useState(() => remaining(target))

  useEffect(() => {
    const t = setInterval(() => setR(remaining(target)), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIso])

  const text = r.past
    ? `Draw time has passed (${fmtDate(dateIso)}); results arrive after the evening fetch.`
    : `Next draw in ${r.d} days ${r.h} hours ${r.m} minutes`

  if (variant === 'inline') {
    return (
      <span className="countdown-inline" aria-live="off" title={text}>
        {r.past ? 'Awaiting results' : `${r.d > 0 ? `${r.d}d ` : ''}${two(r.h)}:${two(r.m)}:${two(r.s)}`}
      </span>
    )
  }

  return (
    <div className="countdown" role="timer" aria-label={text}>
      {r.d > 0 ? (
        <span className="unit" aria-hidden="true">
          <b>{r.d}</b>
          <span>days</span>
        </span>
      ) : null}
      <span className="unit" aria-hidden="true">
        <b>{two(r.h)}</b>
        <span>hrs</span>
      </span>
      <span className="unit" aria-hidden="true">
        <b>{two(r.m)}</b>
        <span>min</span>
      </span>
      <span className="unit" aria-hidden="true">
        <b>{two(r.s)}</b>
        <span>sec</span>
      </span>
    </div>
  )
}
