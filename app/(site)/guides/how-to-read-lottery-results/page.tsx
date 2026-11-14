// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getDraws, getLotteries } from '@/lib/data'
import { ARTICLE_BY_SLUG, articlePath } from '@/lib/articles'
import { ascendingCount, bonusSummary, drawNoSteps, letterSummary } from '@/lib/insights'
import { LOTTERY_BY_ID } from '@/lib/lotteries'
import { BOARD_SOURCE, pageMetadata, ticketText } from '@/lib/seo'
import { ArticleLayout, newestDrawDate } from '@/components/ArticleLayout'
import { DAY_NAMES } from '@/components/LotteryGuide'
import { countWord, listText } from '@/components/util/text'
import { bonusText, fmtDate, fmtInt } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'

const META = ARTICLE_BY_SLUG['how-to-read-lottery-results']

export const metadata: Metadata = pageMetadata({ title: META.title, description: META.description, path: articlePath(META.slug) })


export default function HowToReadResultsPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id)).filter((l) => l.drawCount > 0)
  const all = lotteries.map((l) => ({ l, draws: getDraws(l.id) }))
  const steps = all.reduce(
    (acc, { draws }) => {
      const s = drawNoSteps(draws)
      return { steps: acc.steps + s.steps, byOne: acc.byOne + s.byOne }
    },
    { steps: 0, byOne: 0 },
  )
  const totalDraws = all.reduce((s, x) => s + x.draws.length, 0)
  const allLetters = all.filter(({ draws }) => letterSummary(draws).letters.length === 26).map(({ l }) => l.name)
  const order = all.map(({ l, draws }) => ({ name: l.name, total: draws.length, ascending: ascendingCount(draws) }))
  const sorted = order.filter((o) => o.ascending === o.total)
  const mixed = order.filter((o) => o.ascending < o.total)
  const bonuses = all
    .filter(({ l }) => l.hasBonus)
    .map(({ l, draws }) => ({ l, b: bonusSummary(draws), latest: draws[0] }))
    .filter((x) => x.b !== null)
  const withLetter = lotteries.filter((l) => l.letterKind === 'letter').length
  const fourEach = lotteries.every((l) => l.mainCount === 4)
  const oneTo80 = lotteries.filter((l) => l.mainMin === 1 && l.mainMax === 80)
  const otherRange = lotteries.filter((l) => !(l.mainMin === 1 && l.mainMax === 80))
  const allDistinct = all.every(({ draws }) => draws.every((d) => new Set(d.numbers).size === d.numbers.length))
  const nlb = BOARD_SOURCE.NLB
  const dlb = BOARD_SOURCE.DLB
  const nlbExample = all.find(({ l }) => l.board === 'NLB')
  const dataTo = newestDrawDate(lotteries, META.published)

  return (
    <ArticleLayout
      meta={META}
      dataTo={dataTo}
      lede="A Sri Lankan lottery result is short: a draw number, a date, a letter and four numbers, sometimes with a bonus. Each part has a job, and knowing them makes it quick to match a ticket to the right draw and to spot a mistake. This guide goes through each part, using the latest result of every lottery as a worked example."
    >
      <h2>The latest result of every lottery</h2>
      <p>
        These are the newest results in WinLot&apos;s archive, exactly as the boards published them. The rest of this guide
        explains each column.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Latest result of each lottery</caption>
          <thead>
            <tr>
              <th scope="col">Lottery</th>
              <th scope="col">Board</th>
              <th scope="col">Draw</th>
              <th scope="col">Date</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {lotteries.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/l/${l.id}`}>{l.name}</Link>
                </td>
                <td>{l.board}</td>
                <td className="num">{l.lastDraw!.drawNo}</td>
                <td className="num">{fmtDate(l.lastDraw!.date)}</td>
                <td className="num">{ticketText(l.lastDraw!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>The draw number</h2>
      <p>
        Every lottery counts its own draws, starting from its first one, and the count goes up by one with each draw. That makes
        the draw number the single most useful part of a result: several lotteries are drawn on the same evening, but no two
        draws of one lottery share a number. That is why the first step in checking a ticket is to find the result with the
        same draw number.
      </p>
      <p>
        WinLot&apos;s archive holds {fmtInt(totalDraws)} draws of {countWord(lotteries.length)} lotteries. Going from each draw to the next one of the
        same lottery, the number went up by exactly one in {fmtInt(steps.byOne)} of {fmtInt(steps.steps)} steps
        {steps.byOne < steps.steps
          ? `; in the other ${fmtInt(steps.steps - steps.byOne)} the archive skips at least one draw number, so a result you look for may simply not be in it`
          : ''}
        . Because the numbers differ so much between lotteries, from {fmtInt(Math.min(...lotteries.map((l) => l.lastDraw!.drawNo)))} to{' '}
        {fmtInt(Math.max(...lotteries.map((l) => l.lastDraw!.drawNo)))} in the table above, a draw number also tells you quickly
        if you are looking at the wrong lottery.
      </p>

      <h2>The date</h2>
      <p>
        The date is the day the draw was held. WinLot looks for new results each evening at 20:00 and again at 22:00 Sri Lanka
        time, and the guide on each lottery page shows how many draws it held in the past year and when it took a break. A date
        on its own is not enough to identify a result: on {fmtDate(dataTo)} alone,{' '}
        {countWord(lotteries.filter((l) => l.lastDraw!.date === dataTo).length)} of the lotteries in the table above were drawn,
        which is why the draw number comes first.
      </p>

      <h2>The letter</h2>
      <p>
        {withLetter === lotteries.length
          ? `Each of the ${countWord(lotteries.length)} lotteries draws one letter from A to Z alongside its numbers.`
          : `${countWord(withLetter)} of the lotteries draw one letter from A to Z alongside their numbers.`}{' '}
        It is part of the result like the numbers; what a matching letter is worth is set out in the board&apos;s prize
        structure.{' '}
        {allLetters.length === all.length
          ? `In WinLot's archive all 26 letters have come up in every one of the ${countWord(all.length)} lotteries.`
          : allLetters.length > 0
            ? `In WinLot's archive all 26 letters have come up in ${listText(allLetters)}.`
            : ''}{' '}
        Letters are not numbered and have no order, so &quot;M&quot; is no closer to &quot;N&quot; than to &quot;A&quot;.
      </p>

      <h2>The numbers</h2>
      <p>
        {fourEach ? 'Every lottery draws four main numbers. ' : ''}
        {countWord(oneTo80.length).replace(/^./, (c) => c.toUpperCase())} of them use the numbers 1 to 80
        {otherRange.length ? `; ${otherRange.map((l) => `${l.name} uses ${l.mainMin} to ${l.mainMax}`).join(', ')}` : ''}.
        {allDistinct
          ? ` In all ${fmtInt(totalDraws)} draws in the archive the main numbers of a draw are all different: a number comes up at most once per draw.`
          : ''}{' '}
        WinLot shows them with two digits, so 7 is written 07.
      </p>
      <p>
        {sorted.length === order.length
          ? `In every result WinLot holds, the four numbers are listed from smallest to largest. That order is how the result is printed, not the order the balls came out of the machine.`
          : `${listText(sorted.map((o) => o.name))} list the four numbers from smallest to largest in every result WinLot holds. ${mixed
              .map((o) => `${o.name} lists them in another order in ${fmtInt(o.total - o.ascending)} of ${fmtInt(o.total)} results`)
              .join('; ')}. Either way, a ticket matches the numbers, not their order on the page.`}
      </p>

      <h2>The bonus</h2>
      <p>
        {countWord(bonuses.length).replace(/^./, (c) => c.toUpperCase())} of the lotteries add something extra to the result,
        drawn separately from the main numbers.
      </p>
      <ul>
        {bonuses.map(({ l, b, latest }) => (
          <li key={l.id}>
            <strong>
              {l.name}: {l.bonusLabel}.
            </strong>{' '}
            {b!.digits !== null
              ? `A separate row of ${b!.digits} single digits. In the archive it appears on ${fmtInt(b!.draws)} of ${fmtInt(l.drawCount)} draws, ${b!.weekdays.length === 1 ? `all on a ${DAY_NAMES[b!.weekdays[0]]}` : `on ${listText(b!.weekdays.map((d) => `${DAY_NAMES[d]}s`))}`}, most recently on ${fmtDate(b!.last)}.`
              : `One more number${b!.min !== null && b!.max !== null ? `, between ${b!.min} and ${b!.max} in the archive` : ''}, shown after the main numbers${latest.bonus !== null ? ` (in the latest result, ${bonusText(latest.bonus)})` : ''}. It appears on ${fmtInt(b!.draws)} of ${fmtInt(l.drawCount)} draws, since ${fmtDate(b!.first)}.`}
          </li>
        ))}
      </ul>
      <p>
        On WinLot&apos;s lottery pages the bonus is shown as a separate, labelled ball; a bonus number is also written after a
        plus sign, as in the table above. It is not one of the main numbers, so a ticket number that matches only the bonus is
        not a match for the main numbers, and the other way round.
      </p>

      <h2>Checking a ticket, step by step</h2>
      <ol>
        <li>Find the lottery and the draw number on the ticket, and open the result with the same draw number.</li>
        <li>Check that the date matches as well; if it does not, you have the wrong draw or the wrong lottery.</li>
        <li>Compare the letter, then each of the four numbers, then the bonus if the lottery has one.</li>
        <li>
          Look up what that combination of matches is worth in the prize structure of the official result. WinLot does not
          publish prize tiers, ticket prices or claim rules.
        </li>
        <li>
          Before doing anything with a ticket, confirm the result on the board&apos;s own site: <a href={nlb.url}>{nlb.host}</a>{' '}
          for {listText(lotteries.filter((l) => l.board === 'NLB').map((l) => l.name))}, and <a href={dlb.url}>{dlb.host}</a> for{' '}
          {listText(lotteries.filter((l) => l.board === 'DLB').map((l) => l.name))}.
        </li>
      </ol>
      <p>
        {nlbExample ? (
          <>
            The National Lotteries Board gives every draw its own page with the prize structure, for example{' '}
            <a href={`${LOTTERY_BY_ID[nlbExample.l.id]?.source_url}/${nlbExample.draws[0].drawNo}`}>
              {`${LOTTERY_BY_ID[nlbExample.l.id]?.source_url}/${nlbExample.draws[0].drawNo}`.replace(/^https:\/\/(www\.)?/, '')}
            </a>{' '}
            for the latest {nlbExample.l.name} draw.{' '}
          </>
        ) : null}
        The Development Lotteries Board shows each draw&apos;s prize table as an image on its result page.
      </p>

      <h2>What &quot;Jackpot won&quot; and &quot;rolls over&quot; mean</h2>
      <p>
        The jackpot (the boards call it the Super Prize; Mega Power&apos;s is the Mega Super Prize) is the top prize. When nobody
        wins it, it rolls over: the money is carried to the next draw and the jackpot grows. On WinLot a draw is marked
        &quot;Jackpot won&quot; only when the data says so. For the NLB lotteries that comes from the prize table of each draw,
        which also gives the number of winners. The DLB publishes no winners list in text, so WinLot infers a DLB win when the
        advertised jackpot drops and stays lower one draw later, and never claims a DLB jackpot was not won. The{' '}
        <Link href="/guides/jackpot-wins-history">history of jackpot wins</Link> sets out every win on record.
      </p>

      <h2>Where to go next</h2>
      <p>
        Every lottery has a full results archive, grouped by year:{' '}
        {lotteries.map((l, i) => (
          <span key={l.id}>
            {i > 0 ? (i === lotteries.length - 1 ? ' and ' : ', ') : ''}
            <Link href={`/l/${l.id}/results`}>{l.name}</Link>
          </span>
        ))}
        . If you are curious why counting past numbers does not help with the next draw, read{' '}
        <Link href="/guides/number-frequency-and-gaps">number frequency and long gaps</Link>.
      </p>
    </ArticleLayout>
  )
}
