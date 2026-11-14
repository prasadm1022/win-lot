// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getDraws, getJackpotStatus, getLotteries, getPrizeRows } from '@/lib/data'
import { ARTICLE_BY_SLUG, articlePath } from '@/lib/articles'
import { articleYear, frequencySpread, liveNumbers, yearRow } from '@/lib/insights'
import { pageMetadata } from '@/lib/seo'
import { ArticleLayout, newestDrawDate } from '@/components/ArticleLayout'
import { fmtDate, fmtFixed, fmtInt, fmtRupees } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'
import { countWord, listText, pct1, plural } from '@/components/util/text'

const META = ARTICLE_BY_SLUG['year-in-numbers']

export const metadata: Metadata = pageMetadata({ title: META.title, description: META.description, path: articlePath(META.slug) })

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())

export default function YearInNumbersPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id)).filter((l) => l.drawCount > 0)
  const dataTo = newestDrawDate(lotteries, META.published)
  const year = articleYear(dataTo)
  const per = lotteries
    .map((l) => {
      const all = getDraws(l.id)
      const live = liveNumbers(all, l.mainMin, l.mainMax)
      const inYear = all.filter((d) => d.date.startsWith(`${year}-`))
      const status = getJackpotStatus(l.id)
      const wins = status.wins.filter((w) => w.date?.startsWith(`${year}-`))
      const checked = getPrizeRows(l.id).filter((r) => r.date?.startsWith(`${year}-`) && r.superPrizeWinners !== null && r.tier !== 'advertised')
      return {
        l,
        row: yearRow(all, live, year),
        spread: frequencySpread(inYear, live),
        wins,
        checked: { draws: checked.length, wins: checked.filter((r) => r.superPrizeWinners! > 0).length },
        startsInYear: all.length > 0 && all[all.length - 1].date.startsWith(`${year}-`),
      }
    })
    .filter((x) => x.row.draws > 0)
  const totalDraws = per.reduce((s, x) => s + x.row.draws, 0)
  const totalWins = per.reduce((s, x) => s + x.wins.length, 0)
  const paid = per.flatMap((x) => x.wins.filter((w) => w.amount !== null).map((w) => ({ name: x.l.name, ...w })))
  const paidTotal = paid.reduce((s, w) => s + w.amount!, 0)
  const largest = [...paid].sort((a, b) => b.amount! - a.amount!)[0]
  const repeatDraws = per.reduce((s, x) => s + x.row.repeat.draws, 0)
  const repeated = per.reduce((s, x) => s + x.row.repeat.repeated, 0)
  const repeatExpected = per.reduce((s, x) => s + x.row.repeat.draws * x.row.repeatChance, 0)
  const repeatVariance = per.reduce((s, x) => s + x.row.repeat.draws * x.row.repeatChance * (1 - x.row.repeatChance), 0)
  const repeatInRange = Math.abs(repeated - repeatExpected) <= 1.96 * Math.sqrt(repeatVariance)
  const numbersDrawn = per.reduce((s, x) => s + x.row.draws * x.l.mainCount, 0)
  const lastDay = per.map((x) => x.row.last!).sort().at(-1)!
  const fullYear = lastDay >= `${year}-12-31`
  const partial = per.filter((x) => x.startsInYear)
  const breaks = per.filter((x) => x.row.longestBreak !== null)
  const inRange = per.filter((x) => x.spread !== null)
  const inRangeNumbers = inRange.reduce((s, x) => s + x.spread!.inRange, 0)
  const inRangeLive = inRange.reduce((s, x) => s + x.spread!.live, 0)

  return (
    <ArticleLayout
      meta={META}
      heading={`${META.heading}: ${year}`}
      dataTo={dataTo}
      lede={`What did ${year} look like across Sri Lanka's seven lotteries? This article sums up the year${fullYear ? '' : ' so far'} from WinLot's archive: how many draws were held and when the machines rested, the jackpots that were won, the numbers and letters that came up most and least, and how often a number repeated from one draw to the next.`}
    >
      <h2>Draws held</h2>
      <p>
        From 1 January to {fmtDate(lastDay)}, WinLot recorded {plural(totalDraws, 'draw')} across the{' '}
        {countWord(per.length)} lotteries
        {partial.length
          ? `. The archive of ${listText(partial.map((x) => x.l.name))} starts during the year, on ${fmtDate(partial[0].row.first)}, so ${partial.length === 1 ? 'its' : 'their'} counts begin there`
          : ''}
        .
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Draws per lottery in {year}</caption>
          <thead>
            <tr>
              <th scope="col">Lottery</th>
              <th scope="col">Draws</th>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Days without a draw</th>
              <th scope="col">Longest break</th>
            </tr>
          </thead>
          <tbody>
            {per.map(({ l, row }) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/l/${l.id}/results`}>{l.name}</Link>
                </td>
                <td className="num">{fmtInt(row.draws)}</td>
                <td className="num">{fmtDate(row.first)}</td>
                <td className="num">{fmtDate(row.last)}</td>
                <td className="num">{fmtInt(row.daysWithout)}</td>
                <td>
                  {row.longestBreak
                    ? `${plural(row.longestBreak.days, 'day')} (${fmtDate(row.longestBreak.from)} to ${fmtDate(row.longestBreak.to)})`
                    : 'none'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        {breaks.length
          ? `${new Set(breaks.map((x) => x.row.longestBreak!.from)).size === 1 ? `For every lottery with a break, the longest one ran from ${fmtDate(breaks[0].row.longestBreak!.from)} to ${fmtDate(breaks[0].row.longestBreak!.to)}` : `The longest breaks ran ${listText([...new Set(breaks.map((x) => `from ${fmtDate(x.row.longestBreak!.from)} to ${fmtDate(x.row.longestBreak!.to)}`))])}`}. The days without a draw in the table count every such day, short breaks included; the guide on each lottery page shows its schedule over the past year.`
          : `No lottery had a day without a draw in ${year}.`}
      </p>

      <h2>Jackpots</h2>
      <p>
        {totalWins
          ? `WinLot knows of ${plural(totalWins, 'jackpot win')} dated in ${year}: ${listText(per.filter((x) => x.wins.length).map((x) => `${x.l.name} ${fmtInt(x.wins.length)}`))}.`
          : `WinLot knows of no jackpot win dated in ${year}.`}{' '}
        {paid.length
          ? `The prize tables give the amount for ${plural(paid.length, 'of them', 'of them')}: together ${fmtRupees(paidTotal)}, the largest being ${fmtRupees(largest.amount!)} in ${largest.name} draw ${largest.drawNo}${largest.date ? ` on ${fmtDate(largest.date)}` : ''}.`
          : ''}
      </p>
      <ul>
        {per
          .filter((x) => x.l.board === 'NLB' && x.checked.draws > 0)
          .map((x) => (
            <li key={x.l.id}>
              {x.l.name}: won in {fmtInt(x.checked.wins)} of the {plural(x.checked.draws, 'draw')} whose prize table WinLot read
              this year
              {x.wins
                .filter((w) => w.amount !== null)
                .map((w) => ` · draw ${w.drawNo}, ${fmtRupees(w.amount!)}`)
                .join('')}
            </li>
          ))}
      </ul>
      <p>
        The DLB lotteries publish no winners list, so their wins can only be inferred from the advertised jackpot dropping, and
        only for the draws since WinLot began recording that figure. The{' '}
        <Link href="/guides/jackpot-wins-history">jackpot history</Link> explains each source.
      </p>

      <h2>The most and least drawn numbers</h2>
      <p>
        Every year some numbers come up more than others. The question is whether the difference is bigger than luck makes it.
      </p>
      <ul>
        {per.map(({ l, row }) =>
          row.most && row.least ? (
            <li key={l.id}>
              <strong>{l.name}</strong>: most drawn {listText(row.most.numbers.map(String))} ({plural(row.most.count, 'time')}),
              least drawn {listText(row.least.numbers.map(String))} ({plural(row.least.count, 'time')}), against an even share of{' '}
              {fmtFixed(row.expected, 1)}
            </li>
          ) : null,
        )}
      </ul>
      <p>
        Across the {countWord(inRange.length)} lotteries, {fmtInt(inRangeNumbers)} of {fmtInt(inRangeLive)} numbers in use (
        {pct1(inRangeNumbers / Math.max(1, inRangeLive))}) landed within the range fair draws give 95 times in 100 (1.96 standard
        deviations either side of the even share); fair draws put about 95% of numbers there and a few just outside. A year&apos;s
        most drawn numbers are a summary of that year, not a hint for the next draw, as the{' '}
        <Link href="/guides/number-frequency-and-gaps">frequency guide</Link> shows with the whole archive.
      </p>

      <h2>Letters</h2>
      <ul>
        {per.map(({ l, row }) =>
          row.topLetter ? (
            <li key={l.id}>
              {l.name}: {listText(row.topLetter.letters)} came up most, {plural(row.topLetter.count, 'time')}, against an even
              share of {fmtFixed(row.draws / 26, 1)} for each of the 26 letters
            </li>
          ) : null,
        )}
      </ul>

      <h2>Repeats from one draw to the next</h2>
      <p>
        It is tempting to skip a number that came up in the last draw, as if it had been used up. It has not. With four numbers
        from about 80, a draw shares at least one number with the draw before it about{' '}
        {pct1(repeatExpected / Math.max(1, repeatDraws))} of the time on average for fair draws. In {year},{' '}
        {fmtInt(repeated)} of {fmtInt(repeatDraws)} draws ({pct1(repeated / Math.max(1, repeatDraws))}) repeated at least one
        number from the draw before, which is{' '}
        {repeatInRange ? 'inside' : 'outside'} the range fair draws give 95 times in 100 ({fmtFixed(repeatExpected - 1.96 * Math.sqrt(repeatVariance), 0)} to{' '}
        {fmtFixed(repeatExpected + 1.96 * Math.sqrt(repeatVariance), 0)} draws).
      </p>
      <ul>
        {per.map(({ l, row }) => (
          <li key={l.id}>
            {l.name}: {fmtInt(row.repeat.repeated)} of {fmtInt(row.repeat.draws)} draws ({pct1(row.repeat.repeated / Math.max(1, row.repeat.draws))}), fair
            draws {pct1(row.repeatChance)}
          </li>
        ))}
      </ul>

      <h2>What the year tells us</h2>
      <p>
        {cap(countWord(per.length))} lotteries, {plural(totalDraws, 'draw')} and{' '}
        {plural(numbersDrawn, 'main number')} drawn in {year}
        {totalWins ? `, and ${plural(totalWins, 'jackpot')} won that WinLot knows of` : ''}. The counts above summarise what
        happened; none of them carries over into the next draw, which starts from the same balls as every other. For every
        individual result of the year, see the results archives of{' '}
        {per.map((x, i) => (
          <span key={x.l.id}>
            {i > 0 ? (i === per.length - 1 ? ' and ' : ', ') : ''}
            <Link href={`/l/${x.l.id}/results#y${year}`}>{x.l.name}</Link>
          </span>
        ))}
        .
      </p>
    </ArticleLayout>
  )
}
