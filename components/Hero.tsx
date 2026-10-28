// SPDX-License-Identifier: Apache-2.0
'use client'
import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { Lottery, PredictionSet } from '@/lib/types'
import { fmtDate } from './util/format'
import { Ball, BallRow } from './Ball'
import { Countdown } from './Countdown'

/** Minimal slice of a lottery + its top pick, so the client bundle carries no full Prediction. */
export interface Showcase {
  lottery: Pick<Lottery, 'id' | 'name' | 'board' | 'bonusLabel'>
  pick: PredictionSet
  nextDrawDate: string
}

interface Props {
  items: Showcase[]
}

const ORBIT = [7, 23, 41, 58, 66, 12, 34, 79]

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** Hero: a spinning "drum" of balls and a rotating showcase of each lottery's top pick. */
export function Hero({ items }: Props) {
  const reduced = useReducedMotion()
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused || items.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000)
    return () => clearInterval(t)
  }, [reduced, paused, items.length])

  const current = items[idx % Math.max(1, items.length)] ?? null

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <p className="eyebrow">NLB · DLB · updated daily</p>
        <h1 id="hero-title">Tomorrow&apos;s numbers, read from yesterday&apos;s.</h1>
        <p className="hero-lede">
          Every Sri Lankan draw, charted and scored. Hot, cold and overdue numbers, honest backtests, and a fresh set of
          statistical picks for each lottery after every evening draw.
        </p>
        {current ? (
          <div style={{ margin: '18px 0 4px' }}>
            <p className="row-label small muted" style={{ margin: '0 0 6px' }}>
              Next draw · {fmtDate(current.nextDrawDate)} at 8 pm
            </p>
            <Countdown dateIso={current.nextDrawDate} />
          </div>
        ) : null}
        <div className="hero-actions">
          <a href="#lotteries" className="btn btn-primary">
            See all picks
          </a>
          <Link href="/about" className="btn">
            How it works
          </Link>
        </div>
      </div>

      <div className="hero-visual" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
        <div className="hero-drum" aria-hidden="true">
          <span className="ring" />
          <span className="orbit">
            {ORBIT.map((n, i) => (
              <span key={n} className="ball" style={{ '--a': `${(360 / ORBIT.length) * i}deg` } as CSSProperties}>
                {n}
              </span>
            ))}
          </span>
          {current ? (
            <Ball
              value={current.pick.letter ?? current.pick.numbers[0]}
              kind={current.pick.letter ? 'letter' : 'number'}
              size="xl"
            />
          ) : null}
        </div>

        <div className="hero-picks" aria-live="polite" aria-atomic="true">
          {current ? (
            <div key={current.lottery.id}>
              <p className="hero-pick-name">
                <Link href={`/l/${current.lottery.id}`} style={{ color: 'inherit' }}>
                  {current.lottery.name}
                </Link>{' '}
                <span className={`badge badge-${current.lottery.board.toLowerCase()}`}>{current.lottery.board}</span>
              </p>
              <BallRow
                letter={current.pick.letter}
                numbers={current.pick.numbers}
                bonus={current.pick.bonus}
                bonusLabel={current.lottery.bonusLabel}
                size="lg"
                reveal
                caption={`${current.lottery.name} top pick`}
              />
              <p className="hero-pick-label">
                {current.pick.label} · score {(current.pick.score * 100).toFixed(0)} · statistical pick, not a forecast
              </p>
            </div>
          ) : (
            <div>
              <p className="hero-pick-name">No picks yet</p>
              <p className="hero-pick-label">Picks appear after the first draws are recorded.</p>
            </div>
          )}
          {items.length > 1 ? (
            <div className="hero-dots" role="tablist" aria-label="Showcased lottery">
              {items.map((it, i) => (
                <button
                  key={it.lottery.id}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  aria-current={i === idx ? 'true' : undefined}
                  aria-label={it.lottery.name}
                  onClick={() => {
                    setIdx(i)
                    setPaused(true)
                  }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
