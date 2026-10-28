import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { Lottery, Prediction } from '../api/types'
import { fmtDate, fmtInt } from '../lib/format'
import { metaFor } from '../lib/lotteryMeta'
import { BallRow } from './Ball'
import { Countdown } from './Countdown'
import { Sparkline } from '../charts/Sparkline'
import { Skeleton, SkeletonBalls } from './Skeleton'

interface Props {
  lottery: Lottery
  prediction: Prediction | null
  sums: number[] | null
}

export function LotteryCard({ lottery, prediction, sums }: Props) {
  const meta = metaFor(lottery.id)
  const style = { '--hue': meta.hue } as CSSProperties
  const top = prediction?.sets[0]
  return (
    <article className="card lottery-card" style={style} aria-labelledby={`lc-${lottery.id}`}>
      <div className="title-row">
        <h3 id={`lc-${lottery.id}`}>
          <Link to={`/l/${lottery.id}`} className="stretched" style={{ color: 'inherit', textDecoration: 'none' }}>
            {lottery.name}
          </Link>
          {meta.si ? (
            <span className="native" lang="si">
              {meta.si} <span lang="ta">· {meta.ta}</span>
            </span>
          ) : null}
        </h3>
        <span className={`badge badge-${lottery.board.toLowerCase()}`}>{lottery.board}</span>
      </div>

      <div>
        <p className="row-label">
          <span>Latest draw</span>
          {lottery.lastDraw ? (
            <span>
              #{lottery.lastDraw.drawNo} · {fmtDate(lottery.lastDraw.date)}
            </span>
          ) : null}
        </p>
        {lottery.lastDraw ? (
          <BallRow
            letter={lottery.lastDraw.letter}
            numbers={lottery.lastDraw.numbers}
            bonus={lottery.lastDraw.bonus}
            bonusLabel={lottery.bonusLabel}
            size="sm"
            caption="Latest draw"
          />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            No draws recorded yet.
          </p>
        )}
      </div>

      <div>
        <p className="row-label">
          <span>Top pick for next draw</span>
          {prediction ? <span>score {(top!.score * 100).toFixed(0)}</span> : null}
        </p>
        {prediction && top ? (
          <BallRow letter={top.letter} numbers={top.numbers} bonus={top.bonus} bonusLabel={lottery.bonusLabel} size="sm" caption="Top pick" />
        ) : prediction === null ? (
          <SkeletonBalls n={lottery.mainCount + 1} />
        ) : null}
      </div>

      <div className="meta">
        <span>
          <span className="muted">Next draw </span>
          {prediction ? (
            <>
              {fmtDate(prediction.nextDrawDate)} · <Countdown dateIso={prediction.nextDrawDate} variant="inline" />
            </>
          ) : (
            <Skeleton w={120} style={{ display: 'inline-block', verticalAlign: 'middle' }} />
          )}
        </span>
        {sums ? (
          <Sparkline values={sums} label="Sum of numbers, last 30 draws" />
        ) : (
          <Skeleton w={120} h={32} />
        )}
      </div>
      <p className="small muted" style={{ margin: '-6px 0 0' }}>
        {fmtInt(lottery.drawCount)} draws since {fmtDate(lottery.firstDate)}
      </p>
    </article>
  )
}
