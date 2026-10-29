// SPDX-License-Identifier: Apache-2.0
// Jackpot-day marking (docs/MODEL-V2.md 7.1). Pure presentational, no hooks: usable from server and client components.
// The badge carries text ("Jackpot won"), never only a colour or an icon. It is a <details> element, so the winners,
// amount and source expand on click, tap, Enter or Space (keyboard reachable, nothing depends on hover), and the same
// facts also appear in the "Jackpot wins" table of the lottery page.
import type { DrawJackpot, JackpotSource, JackpotStatus } from '@/lib/types'
import { fmtRupees } from './util/format'

/** Source labels of spec 7.2. */
export const SOURCE_LABEL: Record<JackpotSource, string> = {
  'nlb-prize-table': 'NLB prize table',
  'nlb-winners-directory': 'NLB winners page (publicity card; may be incomplete)',
  'dlb-jackpot-reset': 'DLB (inferred from jackpot drop)',
}

/** Expandable text of spec 7.1, e.g. "Super Prize won on this draw · 1 winner · Rs. 87,804,496 · source: NLB prize table". */
export function jackpotDetailText(j: DrawJackpot | null): string {
  if (!j) return 'Super Prize won on this draw · source: NLB prize table'
  if (j.source === 'dlb-jackpot-reset') {
    return 'Jackpot won (inferred from the advertised jackpot dropping; DLB does not publish winners)'
  }
  const parts = ['Super Prize won on this draw']
  if (j.winners !== null) parts.push(`${j.winners} winner${j.winners === 1 ? '' : 's'}`)
  if (j.amount !== null) parts.push(fmtRupees(j.amount))
  parts.push(`source: ${SOURCE_LABEL[j.source]}`)
  return parts.join(' · ')
}

export function TrophyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3" />
    </svg>
  )
}

interface BadgeProps {
  /** The draw's jackpot facts; null when the outcome is known as "won" but the item is not in jackpots.json yet. */
  jackpot: DrawJackpot | null
  /** Unique id for the expandable text. */
  id: string
  size?: 'sm' | 'md'
}

/** Trophy + "Jackpot won"; opens to the winners, amount and source. */
export function JackpotBadge({ jackpot, id, size = 'md' }: BadgeProps) {
  return (
    <details className={`jp${size === 'sm' ? ' jp-sm' : ''}`}>
      <summary className="jp-badge" aria-describedby={id}>
        <TrophyIcon size={size === 'sm' ? 12 : 14} />
        Jackpot won
      </summary>
      <span id={id} className="jp-tip">
        {jackpotDetailText(jackpot)}
      </span>
    </details>
  )
}

/** Shown only when an NLB prize row proves it (superPrizeWinners = 0): the jackpot rolls over. */
export function RolloverNote({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={`jp-roll${size === 'sm' ? ' jp-sm' : ''}`}>
      <span aria-hidden="true">↻</span> Jackpot not won - it rolls over
    </span>
  )
}

/**
 * True while the "current" NLB jackpot is the amount that was just won: the newest prize row is the one of the latest
 * draw and that draw is a jackpot draw, so the amount has been paid out and the next jackpot is not published yet.
 * Shared by the home card and the "Jackpot wins" section so both stop calling it "Jackpot now".
 */
export function jackpotJustWon(status: Pick<JackpotStatus, 'current' | 'latestDraw' | 'lastWin'> | null | undefined): boolean {
  const c = status?.current
  if (!c || c.kind !== 'last-draw') return false
  const latest = status?.latestDraw
  return (latest?.outcome === 'won' && latest.drawNo === c.drawNo) || status?.lastWin?.drawNo === c.drawNo
}

interface LatestProps {
  draw: { drawNo: number; jackpot?: DrawJackpot }
  latest: JackpotStatus['latestDraw'] | null | undefined
  id: string
  size?: 'sm' | 'md'
}

/**
 * The latest-draw rule of spec 7.1: the badge when the draw is a jackpot draw, "Jackpot not won - it rolls over" only
 * when the status says so for this very draw, and nothing at all while the outcome is unknown.
 */
export function LatestDrawJackpot({ draw, latest, id, size }: LatestProps) {
  if (draw.jackpot) return <JackpotBadge jackpot={draw.jackpot} id={id} size={size} />
  if (latest && latest.drawNo === draw.drawNo) {
    if (latest.outcome === 'won') return <JackpotBadge jackpot={null} id={id} size={size} />
    if (latest.outcome === 'not-won') return <RolloverNote size={size} />
  }
  return null
}
