import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Lottery, Prediction } from '../api/types'
import { useReducedMotion } from '../lib/useTheme'
import { fmtDate } from '../lib/format'
import { Ball, BallRow } from './Ball'
import { Countdown } from './Countdown'
import { SkeletonBalls } from './Skeleton'

interface Props {
  lotteries: Lottery[]
  predictions: Record<string, Prediction | null>
}

const ORBIT = [7, 23, 41, 58, 66, 12, 34, 79]

/** Hero: a spinning "drum" of balls and a rotating showcase of each lottery's top pick. */
export function Hero({ lotteries, predictions }: Props) {
  const reduced = useReducedMotion()
  const ready = lotteries.filter((l) => predictions[l.id])
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (reduced || paused || ready.length < 2) return
    const t = setInterval(() => setIdx((i) => (i + 1) % ready.length), 6000)
    return () => clearInterval(t)
  }, [reduced, paused, ready.length])

  const current = ready[idx % Math.max(1, ready.length)]
  const pick = current ? predictions[current.id]!.sets[0] : null
  const nextDate = current ? predictions[current.id]!.nextDrawDate : null

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div>
        <p className="eyebrow">NLB · DLB · updated nightly</p>
        <h1 id="hero-title">Tomorrow's numbers, read from yesterday's.</h1>
        <p className="hero-lede">
          Every Sri Lankan draw, charted and scored. Hot, cold and overdue numbers, honest backtests, and a
          fresh set of statistical picks for each lottery after every evening draw.
        </p>
        {nextDate ? (
          <div style={{ margin: '18px 0 4px' }}>
            <p className="row-label small muted" style={{ margin: '0 0 6px' }}>
              Next draw · {fmtDate(nextDate)} at 8 pm
            </p>
            <Countdown dateIso={nextDate} />
          </div>
        ) : null}
        <div className="hero-actions">
          <a href="#lotteries" className="btn btn-primary">
            See all picks
          </a>
          <Link to="/about" className="btn">
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
          {pick ? (
            <Ball value={pick.letter ?? pick.numbers[0]} kind={pick.letter ? 'letter' : 'number'} size="xl" />
          ) : null}
        </div>

        <div className="hero-picks" aria-live="polite" aria-atomic="true">
          {current && pick ? (
            <div key={current.id}>
              <p className="hero-pick-name">
                <Link to={`/l/${current.id}`} style={{ color: 'inherit' }}>
                  {current.name}
                </Link>{' '}
                <span className={`badge badge-${current.board.toLowerCase()}`}>{current.board}</span>
              </p>
              <BallRow
                letter={pick.letter}
                numbers={pick.numbers}
                bonus={pick.bonus}
                bonusLabel={current.bonusLabel}
                size="lg"
                reveal={!reduced}
                caption={`${current.name} top pick`}
              />
              <p className="hero-pick-label">
                {pick.label} · score {(pick.score * 100).toFixed(0)} · statistical pick, not a forecast
              </p>
            </div>
          ) : (
            <div>
              <p className="hero-pick-name">Loading picks…</p>
              <SkeletonBalls />
            </div>
          )}
          {ready.length > 1 ? (
            <div className="hero-dots" role="tablist" aria-label="Showcased lottery">
              {ready.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  role="tab"
                  aria-selected={i === idx}
                  aria-current={i === idx ? 'true' : undefined}
                  aria-label={l.name}
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
