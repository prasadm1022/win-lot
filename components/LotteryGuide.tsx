// SPDX-License-Identifier: Apache-2.0
// Server component: the "<lottery> at a glance" guide on each lottery page. Reference facts only, each one read from
// the committed data (lib/insights.ts) or from the project's own docs (the source URLs, the Mega Power Power Super Prize
// tier, the DLB prize image): who runs the lottery, when it is drawn, what a result looks like, how the jackpot data
// works and where the official information lives. No ticket prices, claim rules or deadlines: those are the boards'.
import Link from 'next/link'
import type { PrizeRow } from '@/lib/jackpots'
import { bonusSummary, drawSchedule, letterSummary, liveNumbers, longestBreak, numbersAscending, RETIRED_AFTER, type Schedule } from '@/lib/insights'
import { LOTTERY_BY_ID } from '@/lib/lotteries'
import { BOARD_SOURCE, ticketText } from '@/lib/seo'
import type { DrawSummary, JackpotStatus, Lottery } from '@/lib/types'
import { fmtDate, fmtInt, fmtRupees } from './util/format'
import { listText, plural } from './util/text'

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** When the lottery was drawn over the window of `s`, with its breaks. Every figure is a field of `s`. */
export function scheduleText(name: string, s: Schedule): string {
  const days = s.weekdays.map((count, day) => ({ count, day })).filter((x) => x.count > 0)
  const counts = days.map((x) => x.count)
  const lo = Math.min(...counts)
  const hi = Math.max(...counts)
  const perDay = lo === hi ? `${plural(lo, 'draw')} on each of them` : `between ${fmtInt(lo)} and ${fmtInt(hi)} draws on each`
  const which =
    days.length === 7
      ? `every day of the week (${perDay})`
      : `${listText(days.map((x) => `${DAY_NAMES[x.day]}s`))} (${perDay})`
  const head = `In the ${fmtInt(s.days)} days from ${fmtDate(s.from)} to ${fmtDate(s.to)}, ${name} was drawn on ${fmtInt(s.draws)} of them: on ${which}.`
  if (s.daysWithout === 0) return `${head} There was a draw on every one of those days.`
  const longest = longestBreak(s.breaks)
  const run =
    longest && longest.days > 1
      ? `; the longest break was ${fmtInt(longest.days)} days in a row, from ${fmtDate(longest.from)} to ${fmtDate(longest.to)}`
      : ''
  return `${head} There was no draw on ${plural(s.daysWithout, 'day')}${run}.`
}

/** The jackpot tier names NLB prints in its prize tables for this lottery (e.g. "Super Prize"). */
export function tierNames(rows: readonly PrizeRow[]): string[] {
  return [...new Set(rows.map((r) => r.tier).filter((t): t is string => !!t && t !== 'none' && t !== 'advertised'))].sort()
}

interface Props {
  lottery: Lottery
  draws: DrawSummary[]
  rows: PrizeRow[]
  status: JackpotStatus
}

export function LotteryGuide({ lottery, draws, rows, status }: Props) {
  const { id, name, board, mainCount, mainMin, mainMax } = lottery
  const source = BOARD_SOURCE[board] ?? { name: board, url: '/', host: board }
  const sourceUrl = LOTTERY_BY_ID[id]?.source_url ?? source.url
  const schedule = drawSchedule(draws.map((d) => d.date))
  const live = liveNumbers(draws, mainMin, mainMax)
  const retired = Array.from({ length: mainMax - mainMin + 1 }, (_, i) => mainMin + i).filter((n) => !live.includes(n))
  const letters = letterSummary(draws)
  const bonus = bonusSummary(draws)
  const latest = draws[0] ?? null
  const tiers = tierNames(rows)
  const checked = status.checked
  const current = status.current
  const isNlb = board === 'NLB'
  const perDraw = isNlb && latest ? `${sourceUrl}/${latest.drawNo}` : null

  return (
    <section className="card prose lottery-guide" id="guide" aria-labelledby="guide-title">
      <p className="eyebrow">Guide</p>
      <h2 id="guide-title">{name} at a glance</h2>

      <h3>Who runs it</h3>
      <p>
        {name} is a lottery of the {source.name} ({board}), which publishes every result at{' '}
        <a href={sourceUrl}>{sourceUrl.replace(/^https:\/\/(www\.)?/, '')}</a>. WinLot is not part of the board: it reads those
        results every evening, at 20:00 and again at 22:00 Sri Lanka time, and does the maths on them.
      </p>

      <h3>When it is drawn</h3>
      <p>
        {schedule
          ? scheduleText(name, schedule)
          : `No ${name} draws have been recorded yet, so WinLot cannot say when it is drawn.`}{' '}
        The schedule is the board&apos;s, so check {source.host} for any change.
      </p>

      <h3>What a result looks like</h3>
      <p>
        {/^[AEIOU]/.test(name) ? 'An' : 'A'} {name} result has{' '}
        {listText([
          'a draw number',
          'the date of the draw',
          ...(lottery.letterKind === 'letter' ? ['one letter'] : lottery.letterKind === 'zodiac' ? ['one zodiac sign'] : []),
          `${mainCount} numbers from ${mainMin} to ${mainMax}`,
          ...(lottery.hasBonus ? [`a ${lottery.bonusLabel ?? 'bonus'}`] : []),
        ])}
        . The draw number goes up by one with every draw, so it is the surest way to match a ticket to its result.
        {letters.draws > 0
          ? ` ${letters.letters.length === 26 ? 'All 26 letters, A to Z,' : `${letters.letters.length} different letters`} have come up in the ${plural(draws.length, 'draw')} WinLot holds.`
          : ''}
        {draws.length > 0 && numbersAscending(draws)
          ? ' In every one of them the numbers are listed from smallest to largest, so their order says nothing about the order the balls came out.'
          : ''}
      </p>
      {retired.length > 0 ? (
        <p>
          Not every printed number is in use: {listText(retired.map(String))} {retired.length === 1 ? 'has' : 'have'} not come out
          in the last {fmtInt(RETIRED_AFTER)} draws, so WinLot treats {retired.length === 1 ? 'it' : 'them'} as no longer in the
          machine and its picks leave {retired.length === 1 ? 'it' : 'them'} out.
        </p>
      ) : null}
      {bonus ? (
        <p>
          {bonus.digits !== null
            ? `The ${lottery.bonusLabel ?? 'bonus'} is a separate row of ${bonus.digits} single digits. It appears on ${plural(bonus.draws, 'draw')} in the archive, ${bonus.weekdays.length === 1 ? `all of them on a ${DAY_NAMES[bonus.weekdays[0]]}` : `on ${listText(bonus.weekdays.map((d) => `${DAY_NAMES[d]}s`))}`}, from ${fmtDate(bonus.first)} to ${fmtDate(bonus.last)}.`
            : `The ${lottery.bonusLabel ?? 'bonus'} is one more number${bonus.min !== null && bonus.max !== null ? `, from ${bonus.min} to ${bonus.max} in the archive` : ''}, drawn separately from the main numbers. It appears on ${plural(bonus.draws, 'draw')}, from ${fmtDate(bonus.first)} to ${fmtDate(bonus.last)}${bonus.draws < draws.length ? `; the ${plural(draws.length - bonus.draws, 'older draw')} in the archive have none` : ''}.`}
        </p>
      ) : null}
      {latest ? (
        <p>
          For example, the latest result in the archive, draw {latest.drawNo} on {fmtDate(latest.date)}, reads{' '}
          <strong>{ticketText(latest)}</strong>
          {lottery.hasBonus && bonus?.digits === null && typeof latest.bonus === 'number' ? `, the last number being the ${lottery.bonusLabel}` : ''}.
        </p>
      ) : null}

      <h3>The jackpot and the other prizes</h3>
      {isNlb ? (
        <p>
          The top prize is the {tiers.length ? listText(tiers) : 'Super Prize'}. For every draw the board publishes a prize table
          with the jackpot amount and the number of jackpot winners; when nobody wins, the jackpot rolls over to the next draw.
          {checked && checked.draws > 0
            ? ` WinLot has read that table for ${plural(checked.draws, 'draw')} (${fmtDate(checked.from)} to ${fmtDate(checked.to)}): the jackpot was won in ${fmtInt(checked.wins)} of them.`
            : ''}
          {current ? ` At draw ${current.drawNo} it stood at ${fmtRupees(current.amount)}.` : ''}
          {id === 'mega-power'
            ? ' The board also lists a Power Super Prize, a fixed Rs. 10 million tier that is separate from the jackpot; WinLot does not count it as a jackpot win.'
            : ''}
        </p>
      ) : (
        <p>
          The {source.name} advertises the jackpot at stake in the next draw but publishes no winners list in text: each
          draw&apos;s prize table is an image on its result page.
          {current ? ` The newest advertised jackpot, for draw ${current.drawNo}, is ${fmtRupees(current.amount)}.` : ''} WinLot
          records that figure every day and infers a win when it drops and stays lower one draw later, so DLB wins show up two
          draws late and without a winners count.
        </p>
      )}
      <p>
        The prizes for matching part of a result
        {lottery.letterKind !== 'none' ? ', such as some of the numbers or the letter,' : ''} are set by the board and listed in the
        prize structure of each official result
        {perDraw ? (
          <>
            {' '}
            (for the latest draw: <a href={perDraw}>{perDraw.replace(/^https:\/\/(www\.)?/, '')}</a>)
          </>
        ) : (
          <> on {source.host}</>
        )}
        . WinLot does not store those smaller tiers.
      </p>

      <h3>Where to check results, prices and prize claims</h3>
      <p>
        Always check a ticket against the official result on <a href={sourceUrl}>{source.host}</a> first. Ticket prices, how and
        where to claim a prize and the time allowed for a claim are set by the {source.name}; WinLot does not publish them, so
        take them from <a href={source.url}>{source.host}</a> or the board itself.
      </p>
      <p>
        On WinLot:{' '}
        <Link href={`/l/${id}/results`}>
          every {name} result{draws.length ? ` since ${fmtDate(draws[draws.length - 1].date)}` : ''}
        </Link>
        , the known jackpot wins further up this page, and the guides on{' '}
        <Link href="/guides/how-to-read-lottery-results">how to read a result</Link> and{' '}
        <Link href="/guides/number-frequency-and-gaps">what number frequency can and cannot tell you</Link>.
      </p>
    </section>
  )
}
