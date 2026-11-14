// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getJackpotStatus, getLotteries, getPrizeRows } from '@/lib/data'
import { ARTICLE_BY_SLUG, articlePath } from '@/lib/articles'
import { jackpotHistory, restartAmounts, winsByYear, type JackpotHistoryInput } from '@/lib/insights'
import { pageMetadata } from '@/lib/seo'
import { ArticleLayout, newestDrawDate } from '@/components/ArticleLayout'
import { fmtDate, fmtInt, fmtRupees } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'
import { countWord, listText, plural } from '@/components/util/text'

const META = ARTICLE_BY_SLUG['jackpot-wins-history']

export const metadata: Metadata = pageMetadata({ title: META.title, description: META.description, path: articlePath(META.slug) })

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())

export default function JackpotWinsHistoryPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const inputs: JackpotHistoryInput[] = lotteries.map((l) => ({
    id: l.id,
    name: l.name,
    board: l.board,
    status: getJackpotStatus(l.id),
    rows: getPrizeRows(l.id),
  }))
  const rows = jackpotHistory(inputs)
  const byYear = winsByYear(inputs)
  const total = rows.reduce((s, r) => s + r.wins, 0)
  const src = (k: keyof (typeof rows)[number]['bySource']) => rows.reduce((s, r) => s + r.bySource[k], 0)
  const fromTables = src('nlb-prize-table')
  const fromCards = src('nlb-winners-directory')
  const inferred = src('dlb-jackpot-reset')
  const undated = rows.reduce((s, r) => s + r.undated, 0)
  const withNumbers = rows.reduce((s, r) => s + r.withNumbers, 0)
  const paid = rows
    .flatMap((r) => r.paid.map((p) => ({ ...p, name: r.name, id: r.id })))
    .sort((a, b) => b.amount - a.amount || b.drawNo - a.drawNo)
  const paidTotal = paid.reduce((s, p) => s + p.amount, 0)
  const nlb = rows.filter((r) => r.board === 'NLB')
  const dlb = rows.filter((r) => r.board === 'DLB')
  const checkedDraws = nlb.reduce((s, r) => s + (r.checked?.draws ?? 0), 0)
  const checkedWins = nlb.reduce((s, r) => s + (r.checked?.wins ?? 0), 0)
  const dlbCurrent = dlb.filter((r) => r.current).sort((a, b) => b.current!.amount - a.current!.amount)
  const restarts = nlb.map((r) => ({ r, list: restartAmounts(getPrizeRows(r.id)) })).filter((x) => x.list.length > 0)
  const firstYear = byYear[0]?.year
  const dataTo = newestDrawDate(lotteries, META.published)

  return (
    <ArticleLayout
      meta={META}
      dataTo={dataTo}
      lede="The jackpot, which the boards call the Super Prize, is the prize most players think about first, yet a clear record of when it was won is hard to find. This article pulls together every jackpot win WinLot knows of for the seven lotteries, says where each record comes from, and is honest about the gaps."
    >
      <h2>Where the record comes from</h2>
      <p>
        WinLot holds {plural(total, 'jackpot win')} across the {countWord(lotteries.length)} lotteries. They come from three sources of very different
        quality, and every win on the site is labelled with its source:
      </p>
      <ul>
        <li>
          <strong>NLB prize tables ({fmtInt(fromTables)} {fromTables === 1 ? 'win' : 'wins'}).</strong> For each draw the National
          Lotteries Board publishes a prize table with the jackpot amount and the number of jackpot winners. This is the exact
          record, but the board only keeps the tables of its most recent draws online, so it covers{' '}
          {plural(checkedDraws, 'NLB draw')} from the start of WinLot&apos;s archive.
        </li>
        <li>
          <strong>NLB winners page ({fmtInt(fromCards)} {fromCards === 1 ? 'win' : 'wins'}).</strong> The board&apos;s winners page
          shows publicity cards for past jackpot winners, going back years. A card gives the lottery and the draw number but no
          amount and no winning numbers, and it only exists for winners who came forward, so this part of the record is
          incomplete. {undated > 0 ? `${cap(countWord(undated))} of these wins have no known date at all.` : ''}
        </li>
        <li>
          <strong>DLB jackpot drops ({fmtInt(inferred)} {inferred === 1 ? 'win' : 'wins'}).</strong> The Development Lotteries
          Board publishes no winners list in text. WinLot records the jackpot it advertises for the next draw every day and infers
          a win when that figure drops and is still lower one draw later. A win found this way shows up two draws late and
          without a winners count.
        </li>
      </ul>
      <p>
        Only {plural(withNumbers, 'win')} of the {fmtInt(total)} come with their winning numbers, because the older draws are no
        longer published in full. Winner names and towns are never stored or shown.
      </p>

      <h2>The record, lottery by lottery</h2>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Known jackpot wins per lottery</caption>
          <thead>
            <tr>
              <th scope="col">Lottery</th>
              <th scope="col">Board</th>
              <th scope="col">Wins on record</th>
              <th scope="col">Dated wins</th>
              <th scope="col">Checked draw by draw</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/l/${r.id}`}>{r.name}</Link>
                </td>
                <td>{r.board}</td>
                <td className="num">{fmtInt(r.wins)}</td>
                <td>{r.dated ? `${fmtInt(r.dated)}, ${fmtDate(r.earliest)} to ${fmtDate(r.latest)}` : '-'}</td>
                <td>
                  {r.checked && r.checked.draws > 0
                    ? `won in ${fmtInt(r.checked.wins)} of ${fmtInt(r.checked.draws)} draws`
                    : r.board === 'DLB'
                      ? 'not possible (no winners list)'
                      : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        The NLB columns are the only place where a lottery can be compared with itself draw by draw. Over the{' '}
        {plural(checkedDraws, 'NLB draw')} WinLot could check, the jackpot was won {plural(checkedWins, 'time')}:{' '}
        {listText(nlb.map((r) => `${r.name} ${fmtInt(r.checked?.wins ?? 0)}`))}. These are counts of what happened, not a
        forecast: whether a jackpot is won depends on which tickets were sold for that draw, which no result can show.
      </p>

      <h2>Wins by year</h2>
      {byYear.length ? (
        <>
          <p>
            Counting only the wins with a known date, the record runs from {firstYear} to {byYear[byYear.length - 1].year}:
          </p>
          <ul className="year-list">
            {byYear.map((y) => (
              <li key={y.year}>
                <strong>{y.year}</strong>: {plural(y.wins, 'win')}
              </li>
            ))}
          </ul>
          <p>
            Read this with care. The recent count is higher partly because the exact NLB prize tables cover only the latest
            months, while the earlier years rest on publicity cards alone. A year with few wins on record may simply be a year
            with few cards.
          </p>
        </>
      ) : (
        <p>No dated jackpot win is on record yet.</p>
      )}

      <h2>What was paid</h2>
      {paid.length ? (
        <>
          <p>
            The prize tables give the jackpot amount for {plural(paid.length, 'win')}, together {fmtRupees(paidTotal)}. From the
            largest:
          </p>
          <ol>
            {paid.map((p) => (
              <li key={`${p.id}-${p.drawNo}`}>
                {p.name} draw {p.drawNo}
                {p.date ? ` (${fmtDate(p.date)})` : ''}: {fmtRupees(p.amount)}
                {p.winners !== null ? `, ${plural(p.winners, 'winner')}` : ''}
              </li>
            ))}
          </ol>
          <p>
            The amount is the jackpot as the board published it for that draw. When more than one ticket wins, the prize table
            gives the number of winners; how the board divides the prize between them is its own rule.
          </p>
        </>
      ) : (
        <p>None of the wins on record comes with a published amount yet.</p>
      )}

      <h2>How long a jackpot runs</h2>
      <p>
        When nobody wins, the jackpot rolls over to the next draw and grows. The NLB prize tables show how far each NLB jackpot
        has climbed since it was last won:
      </p>
      <ul>
        {nlb.map((r) =>
          r.run ? (
            <li key={r.id}>
              <strong>{r.name}</strong>:{' '}
              {r.run.sinceChecksBegan
                ? `not won in any of the ${plural(r.run.draws, 'draw')} checked since ${fmtDate(r.run.from.date)}`
                : `${plural(r.run.draws, 'draw')} since its last checked win, from draw ${r.run.from.drawNo} (${fmtDate(r.run.from.date)})`}
              ; the jackpot went from {fmtRupees(r.run.from.amount)} to {fmtRupees(r.run.to.amount)} at draw {r.run.to.drawNo}.
            </li>
          ) : (
            <li key={r.id}>
              <strong>{r.name}</strong>: no prize table checked yet.
            </li>
          ),
        )}
      </ul>
      {restarts.length ? (
        <p>
          After a win the jackpot starts again from a base amount. In the checked tables, the draw after each win started at{' '}
          {listText(
            restarts.map(
              ({ r, list }) =>
                `${listText([...new Set(list.map((x) => fmtRupees(x.amount)))])} for ${r.name} (${plural(list.length, 'win')})`,
            ),
          )}
          .
        </p>
      ) : null}

      <h2>The DLB lotteries</h2>
      <p>
        {dlb.every((r) => r.wins === 0)
          ? `No DLB jackpot win has been inferred yet from the advertised jackpots WinLot has recorded so far; a win can only be found once the figure drops.`
          : `${listText(dlb.filter((r) => r.wins > 0).map((r) => `${r.name} ${plural(r.wins, 'inferred win')}`))} so far.`}{' '}
        {dlbCurrent.length
          ? `The newest advertised jackpots are ${listText(dlbCurrent.map((r) => `${fmtRupees(r.current!.amount)} for ${r.name} (draw ${r.current!.drawNo})`))}.`
          : ''}{' '}
        These are the boards&apos; own figures for the jackpot at stake; they say nothing about whether the next draw will be won.
      </p>

      <h2>Reading the record honestly</h2>
      <p>
        A jackpot is won when somebody holds a ticket that matches the whole result, so the record of wins says as much about
        how many tickets were sold, and which, as about the draws. Every combination of letter and numbers is equally likely in
        every draw; a lottery that has gone a long time without a win is not about to produce one, and one that was won last
        week is not less likely to be won again. WinLot&apos;s picks use the jackpot wins only as a pattern of past winning
        tickets, as explained in <Link href="/guides/how-winlot-makes-its-picks">how WinLot builds its picks</Link>, and never
        as a sign of when the next win will come.
      </p>
      <p>
        Each lottery page lists its own wins with their sources, and the results archives mark every draw whose jackpot was won:{' '}
        {lotteries.map((l, i) => (
          <span key={l.id}>
            {i > 0 ? (i === lotteries.length - 1 ? ' and ' : ', ') : ''}
            <Link href={`/l/${l.id}/results`}>{l.name}</Link>
          </span>
        ))}
        .
      </p>
    </ArticleLayout>
  )
}
