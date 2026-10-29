// SPDX-License-Identifier: Apache-2.0
// Server component: everything here is known at build time except the inline countdown.
import type { CSSProperties } from 'react'
import Link from 'next/link'
import type { JackpotStatus, Lottery, Prediction } from '@/lib/types'
import { fmtDate, fmtInt, fmtMillions } from './util/format'
import { metaFor } from './util/lotteryMeta'
import { BallRow } from './Ball'
import { Countdown } from './Countdown'
import { LatestDrawJackpot, TrophyIcon, jackpotJustWon } from './JackpotBadge'
import { Sparkline } from './charts/Sparkline'

interface Props {
  lottery: Lottery
  prediction: Prediction | null
  jackpots: JackpotStatus | null
  /** Sum of numbers for the last ~30 draws (oldest first). */
  sums: number[]
}

/**
 * "Last jackpot: 24 Aug 2026 (#2319) · 64 draws ago" and its alternatives (spec 7.1). A win before our archive is the
 * last one we know of: the draws between it and the archive could not all be checked, so it is never stated as the last.
 * On the day the jackpot was won on the newest draw it says "won at the latest draw", never "0 draws ago".
 */
export function lastJackpotLine(j: JackpotStatus | null): string {
  const last = j?.lastWin
  if (!j || !last) return 'No jackpot win recorded yet'
  const when = `${last.date ? fmtDate(last.date) : 'date unknown'} (#${last.drawNo})`
  if (!last.inArchive) return `Last known jackpot: ${when}, before our archive (not every draw since could be checked)`
  const n = j.drawsSinceLastWin
  const ago = n === null ? '' : n === 0 ? ' · won at the latest draw' : ` · ${fmtInt(n)} ${n === 1 ? 'draw' : 'draws'} ago`
  return `Last jackpot: ${when}${ago}`
}

/**
 * "Jackpot now: Rs. 93.9 M (at draw #2383)" for NLB, "Advertised jackpot for draw #2505: Rs. 397.2 M" for DLB. On the
 * day an NLB jackpot was won on the newest draw, the newest published amount is the one just paid out, so it is shown
 * as such and never as the jackpot "now".
 */
export function jackpotNowLine(j: JackpotStatus | null): string | null {
  const c = j?.current
  if (!c) return null
  if (c.kind === 'advertised-next') return `Advertised jackpot for draw #${c.drawNo}: ${fmtMillions(c.amount)}`
  if (jackpotJustWon(j)) return `Won at draw #${c.drawNo}: ${fmtMillions(c.amount)} (next jackpot not published yet)`
  return `Jackpot now: ${fmtMillions(c.amount)} (at draw #${c.drawNo})`
}

export function LotteryCard({ lottery, prediction, jackpots, sums }: Props) {
  const meta = metaFor(lottery.id)
  const style = { '--hue': meta.hue } as CSSProperties
  const top = prediction?.sets[0] ?? null
  const now = jackpotNowLine(jackpots)
  return (
    <article className="card lottery-card" style={style} aria-labelledby={`lc-${lottery.id}`}>
      <div className="title-row">
        <h3 id={`lc-${lottery.id}`}>
          <Link href={`/l/${lottery.id}`} className="stretched" style={{ color: 'inherit', textDecoration: 'none' }}>
            {lottery.name}
          </Link>{' '}
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
          <>
            <BallRow
              letter={lottery.lastDraw.letter}
              numbers={lottery.lastDraw.numbers}
              bonus={lottery.lastDraw.bonus}
              bonusLabel={lottery.bonusLabel}
              size="sm"
              caption="Latest draw"
            />
            <div className="lc-latest-jp">
              <LatestDrawJackpot draw={lottery.lastDraw} latest={jackpots?.latestDraw} id={`lc-jp-${lottery.id}`} size="sm" />
            </div>
          </>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            No draws recorded yet.
          </p>
        )}
      </div>

      <div>
        <p className="row-label">
          <span>Top pick for next draw</span>
          {top ? <span>for fun</span> : null}
        </p>
        {top ? (
          <BallRow letter={top.letter} numbers={top.numbers} bonus={top.bonus} bonusLabel={lottery.bonusLabel} size="sm" caption="Top pick" />
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Picks appear after the first draws are recorded.
          </p>
        )}
      </div>

      <div className="lc-jackpot">
        <p className="line">
          <TrophyIcon size={13} />
          <span>{lastJackpotLine(jackpots)}</span>
        </p>
        {now ? <p className="line muted">{now}</p> : null}
      </div>

      <div className="meta">
        <span>
          <span className="muted">Next draw </span>
          {prediction ? (
            <>
              {fmtDate(prediction.nextDrawDate)} · <Countdown dateIso={prediction.nextDrawDate} variant="inline" />
            </>
          ) : (
            '-'
          )}
        </span>
        <Sparkline values={sums} label="Sum of numbers, last 30 draws" />
      </div>
      <p className="small muted" style={{ margin: '-6px 0 0' }}>
        {lottery.drawCount > 0 ? `${fmtInt(lottery.drawCount)} draws since ${fmtDate(lottery.firstDate)}` : 'No history yet'}
      </p>
    </article>
  )
}
