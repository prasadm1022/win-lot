// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LOTTERY_IDS, getDraws, getJackpotStatus, getLottery, getPrizeRows } from '@/lib/data'
import { groupByYear, outcomeCounts, resultRows, type JackpotOutcome, type ResultRow } from '@/lib/insights'
import { LOTTERY_BY_ID } from '@/lib/lotteries'
import { BOARD_SOURCE, pageMetadata, trailPageJsonLd } from '@/lib/seo'
import type { Lottery } from '@/lib/types'
import { JsonLd } from '@/components/JsonLd'
import { Disclaimer } from '@/components/Notices'
import { bonusText, fmtDate, fmtInt, fmtMonthYear, fmtRupees } from '@/components/util/format'

type Params = { id: string }

export const dynamicParams = false

export function generateStaticParams(): Params[] {
  return LOTTERY_IDS.map((id) => ({ id }))
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const weekday = (iso: string) => WEEKDAY[new Date(`${iso}T00:00:00Z`).getUTCDay()]

function description(lottery: Lottery): string {
  const host = BOARD_SOURCE[lottery.board]?.host ?? lottery.board
  return lottery.drawCount > 0
    ? `All ${fmtInt(lottery.drawCount)} ${lottery.name} results since ${fmtDate(lottery.firstDate)}, newest first and grouped by year: draw number, date, letter and numbers from ${host}.`
    : `Every ${lottery.name} result, newest first and grouped by year, from the official ${host} results.`
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { id } = await params
  const lottery = getLottery(id)
  if (!lottery) return { title: 'Lottery not found' }
  const since = lottery.drawCount > 0 ? ` Since ${fmtMonthYear(lottery.firstDate)}` : ''
  return pageMetadata({
    title: `${lottery.name} Results Archive: Every Draw${since} (${lottery.board})`,
    description: description(lottery),
    path: `/l/${id}/results`,
  })
}

/** The jackpot cell: what the data knows, never "not won" without a prize row of 0 winners. */
function jackpotCell(j: JackpotOutcome): string {
  const amount = j.amount !== null ? ` · ${fmtRupees(j.amount)}` : ''
  if (j.kind === 'won') {
    if (j.inferred) return 'Won (inferred from the jackpot drop)'
    const winners = j.winners !== null ? ` · ${fmtInt(j.winners)} winner${j.winners === 1 ? '' : 's'}` : ''
    return `Won${winners}${amount}`
  }
  if (j.kind === 'not-won') return `Not won, rolls over${amount}`
  return j.amount !== null ? `Winners not known${amount}` : '-'
}

function YearTable({ lottery, year, rows, showJackpot }: { lottery: Lottery; year: number; rows: ResultRow[]; showJackpot: boolean }) {
  const won = rows.filter((r) => r.jackpot.kind === 'won').length
  return (
    <section className="card results-year" aria-labelledby={`y${year}`}>
      <div className="card-head">
        <h2 id={`y${year}`}>
          {lottery.name} results {year}
        </h2>
        <p className="card-sub">
          {fmtInt(rows.length)} draw{rows.length === 1 ? '' : 's'}
          {won ? ` · jackpot won on ${fmtInt(won)}` : ''}
        </p>
      </div>
      <div className="table-wrap">
        <table className="results-table">
          <caption className="sr-only">
            {lottery.name} results in {year}, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col">Draw</th>
              <th scope="col">Date</th>
              {lottery.letterKind !== 'none' ? <th scope="col">Letter</th> : null}
              <th scope="col">Numbers</th>
              {lottery.hasBonus ? <th scope="col">{lottery.bonusLabel ?? 'Bonus'}</th> : null}
              {showJackpot ? <th scope="col">Jackpot</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.drawNo} className={r.jackpot.kind === 'won' ? 'row-won' : undefined}>
                <td className="num">{r.drawNo}</td>
                <td className="num">
                  <time dateTime={r.date}>
                    {weekday(r.date)} {fmtDate(r.date)}
                  </time>
                </td>
                {lottery.letterKind !== 'none' ? <td className="res-letter">{r.letter ?? '-'}</td> : null}
                <td className="num res-numbers">{r.numbers.map((n) => String(n).padStart(2, '0')).join(' ')}</td>
                {lottery.hasBonus ? <td className="num">{bonusText(r.bonus) ?? '-'}</td> : null}
                {showJackpot ? <td>{jackpotCell(r.jackpot)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default async function ResultsArchivePage({ params }: { params: Promise<Params> }) {
  const { id } = await params
  const lottery = getLottery(id)
  if (!lottery) notFound()
  const rows = resultRows(lottery.board, getDraws(id), getPrizeRows(id))
  const years = groupByYear(rows)
  const counts = outcomeCounts(rows)
  const status = getJackpotStatus(id)
  const source = BOARD_SOURCE[lottery.board] ?? { name: lottery.board, url: '/', host: lottery.board }
  const isNlb = lottery.board === 'NLB'
  // DLB publishes no winners list: a column of dashes would say nothing, so DLB shows the column only for marked wins.
  const showJackpot = isNlb || counts.won > 0
  const path = `/l/${id}/results`
  const desc = description(lottery)

  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link href="/">All lotteries</Link> <span className="muted">/</span> <Link href={`/l/${id}`}>{lottery.name}</Link>{' '}
        <span className="muted">/</span> Results archive
      </nav>

      <header className="page-head">
        <div>
          <p className="eyebrow">
            <span className={`badge badge-${lottery.board.toLowerCase()}`}>{lottery.board}</span> Results archive
          </p>
          <h1>{lottery.name} results archive</h1>
          <p className="page-intro">
            {rows.length > 0
              ? `Every ${lottery.name} draw in WinLot's archive: ${fmtInt(rows.length)} official results from ${fmtDate(rows[rows.length - 1].date)} to ${fmtDate(rows[0].date)}, newest first and grouped by year. `
              : `No ${lottery.name} draws have been recorded yet. `}
            The results are published by the {source.name} on <a href={LOTTERY_BY_ID[id]?.source_url ?? source.url}>{source.host}</a>;
            WinLot copies them once a day and does not change them. If a number here and a number on {source.host} ever differ,
            the official site is right.
          </p>
        </div>
      </header>

      {rows.length > 0 ? (
        <section className="card prose results-notes" aria-labelledby="notes-title">
          <h2 id="notes-title">How to read this archive</h2>
          <p>
            Each row is one draw: the draw number (the board counts its draws one by one, so it identifies a result exactly),
            the date and weekday it was held,
            {lottery.letterKind !== 'none' ? ' the letter,' : ''} the {lottery.mainCount} winning numbers
            {lottery.hasBonus ? ` and the ${lottery.bonusLabel ?? 'bonus'}` : ''}. Numbers are shown with two digits, as on
            the official results.
          </p>
          {isNlb ? (
            <p>
              The jackpot column comes from the prize table the {source.name} publishes for each draw. &quot;Won&quot; means the
              table shows at least one jackpot winner ({fmtInt(counts.won)} draw{counts.won === 1 ? '' : 's'} in this archive);
              &quot;Not won, rolls over&quot; means it shows none ({fmtInt(counts.notWon)} draw{counts.notWon === 1 ? '' : 's'}),
              so the jackpot is carried to the next draw. The amount is the jackpot as published for that draw.
              {counts.unknown > 0
                ? ` For ${fmtInt(counts.unknown)} draw${counts.unknown === 1 ? '' : 's'} the table was not available when WinLot read it, so the outcome is left open rather than guessed.`
                : ''}
            </p>
          ) : (
            <p>
              The {source.name} does not publish a winners list in text, so this archive does not say whether each jackpot was
              won. {counts.won > 0
                ? `${fmtInt(counts.won)} draw${counts.won === 1 ? ' is' : 's are'} marked as won, inferred from the advertised jackpot dropping and staying lower one draw later.`
                : 'WinLot infers a win when the advertised jackpot drops and stays lower one draw later; no draw in this archive has been marked that way yet.'}
            </p>
          )}
          <p>
            {status.wins.length > 0
              ? `All ${fmtInt(status.wins.length)} known ${lottery.name} jackpot wins, including older ones from before this archive, are listed on the `
              : 'Known jackpot wins, the statistics and the picks for the next draw are on the '}
            <Link href={`/l/${id}`}>{lottery.name} page</Link>. New to these results? Read{' '}
            <Link href="/guides/how-to-read-lottery-results">how to read a Sri Lankan lottery result</Link>.
          </p>
          <nav aria-label="Years" className="year-jump">
            <span className="small muted">Jump to year:</span>{' '}
            {years.map((y, i) => (
              <span key={y.year}>
                {i > 0 ? ' · ' : ''}
                <a href={`#y${y.year}`}>{y.year}</a>
              </span>
            ))}
          </nav>
        </section>
      ) : null}

      {years.map((y) => (
        <YearTable key={y.year} lottery={lottery} year={y.year} rows={y.rows} showJackpot={showJackpot} />
      ))}

      <Disclaimer />
      <JsonLd
        data={trailPageJsonLd(
          'CollectionPage',
          [
            { name: lottery.name, path: `/l/${id}` },
            { name: `${lottery.name} results archive`, path },
          ],
          desc,
        )}
      />
    </div>
  )
}
