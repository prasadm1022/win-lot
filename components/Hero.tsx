// SPDX-License-Identifier: Apache-2.0
'use client'
import { useEffect, useState, type CSSProperties, type FocusEvent } from 'react'
import Link from 'next/link'
import type { DrawJackpot, Lottery, PredictionSet } from '@/lib/types'
import { fmtDate, fmtMonthYear } from './util/format'
import { Ball, BallRow } from './Ball'
import { Countdown } from './Countdown'
import { LatestDrawJackpot } from './JackpotBadge'

/** Minimal slice of a lottery + its top pick, so the client bundle carries no full Prediction or JackpotStatus. */
export interface Showcase {
  lottery: Pick<Lottery, 'id' | 'name' | 'board' | 'bonusLabel'>
  pick: PredictionSet
  nextDrawDate: string
  /** The newest draw and its jackpot outcome (spec 7.1): badge when won, roll-over text when proven not won, else nothing. */
  latest: { drawNo: number; date: string; jackpot: DrawJackpot | null; outcome: 'won' | 'not-won' | 'unknown' } | null
}

interface Props {
  items: Showcase[]
  /** First date an NLB prize table with a winners count could be checked (JackpotStatus.checked.from); null without data. */
  nlbCheckedFrom?: string | null
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

/**
 * Hero: a spinning "drum" of balls and a rotating showcase of each lottery's top pick and latest draw. The rotation
 * stops while the showcase is hovered or holds focus, when a dot is picked, when the visible Pause control is used,
 * and always under prefers-reduced-motion. The showcase is a live region only after the visitor picked a lottery, so
 * the automatic rotation never interrupts a screen reader.
 */
export function Hero({ items, nlbCheckedFrom = null }: Props) {
  const reduced = useReducedMotion()
  const [idx, setIdx] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [stopped, setStopped] = useState(false)
  const rotating = !reduced && !stopped && !hovered && !focused && items.length > 1

  useEffect(() => {
    if (!rotating) return
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), 6000)
    return () => clearInterval(t)
  }, [rotating, items.length])

  const current = items[idx % Math.max(1, items.length)] ?? null
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
  }
  const nlbFrom = nlbCheckedFrom ? ` from ${fmtMonthYear(nlbCheckedFrom)}` : ''

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <p className="eyebrow">NLB · DLB · updated daily</p>
        <h1 id="hero-title">Every draw charted. Known jackpot days marked.</h1>
        <p className="hero-lede">
          Results and statistics for all seven Sri Lankan lotteries, with every jackpot win we know of marked on its draw: NLB prize
          tables{nlbFrom}, and for DLB, which publishes no winners list, wins inferred from now on when its advertised jackpot drops.
          The picks weigh jackpot-winning numbers first, then jackpot dates, then the daily draws, and show that split plainly. Draws
          are random, so every ticket has the same chance: the picks are for fun.
        </p>
        {current ? (
          <div style={{ margin: '18px 0 4px' }}>
            <Countdown
              dateIso={current.nextDrawDate}
              heading={`Next draw · ${fmtDate(current.nextDrawDate)} at 8 pm`}
              pastHeading={`Last scheduled draw · ${fmtDate(current.nextDrawDate)} at 8 pm`}
            />
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

      <div
        className="hero-visual"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={onBlur}
      >
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

        <div className="hero-picks">
          {/* Only the showcased pick is a live region, and only after the visitor picked a lottery; the controls are outside it. */}
          <div aria-live={stopped ? 'polite' : 'off'} aria-atomic="true">
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
                  {current.pick.label}
                  {current.pick.note ? ` · ${current.pick.note.replace(/\.$/, '')}` : ''} · for fun, not a forecast
                </p>
                {current.latest ? (
                  // A <div>, not a <p>: the badge is a <details> element, which a <p> cannot contain.
                  <div className="hero-latest">
                    <span>
                      Latest draw #{current.latest.drawNo} · {fmtDate(current.latest.date)}
                    </span>
                    <LatestDrawJackpot
                      draw={{ drawNo: current.latest.drawNo, jackpot: current.latest.jackpot ?? undefined }}
                      latest={{ drawNo: current.latest.drawNo, date: current.latest.date, outcome: current.latest.outcome }}
                      id={`hero-jp-${current.lottery.id}`}
                      size="sm"
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div>
                <p className="hero-pick-name">No picks yet</p>
                <p className="hero-pick-label">Picks appear after the first draws are recorded.</p>
              </div>
            )}
          </div>
          {items.length > 1 ? (
            <div className="hero-nav">
              <div className="hero-dots" role="group" aria-label="Showcased lottery">
                {items.map((it, i) => (
                  <button
                    key={it.lottery.id}
                    type="button"
                    aria-pressed={i === idx}
                    aria-label={it.lottery.name}
                    title={it.lottery.name}
                    onClick={() => {
                      setIdx(i)
                      setStopped(true)
                    }}
                  />
                ))}
              </div>
              {!reduced ? (
                <button
                  type="button"
                  className="hero-ctl"
                  aria-label={stopped ? 'Play the showcase' : 'Pause the showcase'}
                  onClick={() => setStopped((s) => !s)}
                >
                  <span aria-hidden="true">{stopped ? '▶' : '❚❚'}</span> {stopped ? 'Play' : 'Pause'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
