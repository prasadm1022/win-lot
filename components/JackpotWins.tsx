// SPDX-License-Identifier: Apache-2.0
// Server component: the "Jackpot wins" section of /l/[id] (docs/MODEL-V2.md 7.2), from getJackpotStatus.
// Facts and counts only: never a chance per draw, never "due". Winner names and towns are not in the data.
import type { JackpotStatus, JackpotWin, Lottery } from '@/lib/types'
import { fmtDate, fmtInt, fmtMillions, fmtMonth, fmtRupees } from './util/format'
import { BallRow } from './Ball'
import { SOURCE_LABEL, TrophyIcon, jackpotJustWon } from './JackpotBadge'
import { EmptyState } from './Notices'

interface Props {
  status: JackpotStatus
  lottery: Pick<Lottery, 'name' | 'board' | 'bonusLabel' | 'firstDate'>
}

/** "Used by the picks" cell (spec 7.2). */
function usedByPicks(w: JackpotWin): string {
  if (w.usedAs.includes('combination')) return 'combination + date'
  if (w.usedAs.includes('date')) return 'date only'
  if (w.date === null) return 'no (no date)'
  if (w.knownFrom) return `not yet (from ${fmtDate(w.knownFrom)})`
  // A DLB inference needs two more draws before it counts.
  return `not yet (once draw #${w.drawNo + 2} is published)`
}

function dateCell(w: JackpotWin): string {
  if (w.date) return fmtDate(w.date)
  const listed = w.listedIn?.[0]
  return listed ? `date unknown (card listed ${fmtMonth(listed)})` : 'date unknown'
}

function winnersCell(w: JackpotWin): string {
  if (w.winners !== null) return fmtInt(w.winners)
  return w.source === 'dlb-jackpot-reset' ? 'not published' : 'not listed'
}

function summaryText(status: JackpotStatus): string | null {
  const c = status.checked
  if (!c || c.draws === 0) return null
  const head =
    c.wins === 0
      ? `Not won in the ${fmtInt(c.draws)} draws we could check`
      : `Won ${c.wins === 1 ? 'once' : `${c.wins} times`} in the ${fmtInt(c.draws)} draws we could check`
  const span = c.from && c.to ? ` (${fmtDate(c.from)} to ${fmtDate(c.to)})` : ''
  return `${head}${span}.`
}

export function JackpotWins({ status, lottery }: Props) {
  const { wins, current, lastWin, notes } = status
  const withNumbers = wins.filter((w) => w.numbers !== null).length
  const summary = summaryText(status)
  const plural = (n: number, one: string, many = `${one}s`) => `${fmtInt(n)} ${n === 1 ? one : many}`
  // On the day the jackpot was won on the newest draw, the newest published amount is the one just paid out (eng-3).
  const justWon = jackpotJustWon(status)
  // Draws before this date carry no winners count, so a win before our archive is only the last one we know of.
  const checkedFrom = status.checked?.from ?? lottery.firstDate

  return (
    <section className="card" aria-labelledby="jw-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">Super Prize</p>
          <h2 id="jw-title">Jackpot wins</h2>
        </div>
        <p className="card-sub">
          {wins.length === 0 ? 'No known win yet' : `${plural(wins.length, 'known win')} · ${withNumbers} with winning numbers`}
        </p>
      </div>

      {summary ? <p className="jw-summary">{summary}</p> : null}

      <div className="stat-row jw-stats">
        <div className="stat">
          <p className="label">
            {current?.kind === 'advertised-next' ? 'Advertised jackpot' : justWon && current ? `Won at draw #${current.drawNo}` : 'Jackpot now'}
          </p>
          <p className="value">{current ? fmtMillions(current.amount) : '-'}</p>
          <p className="small muted" style={{ margin: 0 }}>
            {current
              ? current.kind === 'advertised-next'
                ? `for draw #${current.drawNo}`
                : justWon
                  ? `paid out${current.date ? ` on ${fmtDate(current.date)}` : ''}; the next jackpot is not published yet`
                  : `at draw #${current.drawNo}${current.date ? ` (${fmtDate(current.date)})` : ''}`
              : 'not published'}
          </p>
        </div>
        <div className="stat">
          <p className="label">Since the last known win</p>
          {lastWin ? (
            <>
              <p className="value">
                {status.daysSinceLastWin !== null
                  ? `${fmtInt(status.daysSinceLastWin)} days`
                  : status.drawsSinceLastWin !== null
                    ? `${fmtInt(status.drawsSinceLastWin)} draws`
                    : '-'}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {status.daysSinceLastWin !== null && status.drawsSinceLastWin !== null ? `${fmtInt(status.drawsSinceLastWin)} draws · ` : ''}
                #{lastWin.drawNo}
                {lastWin.date ? ` · ${fmtDate(lastWin.date)}` : ''}
                {lastWin.inArchive ? '' : ` · before our archive; not every draw before ${fmtDate(checkedFrom)} could be checked`}
              </p>
            </>
          ) : (
            <p className="value" style={{ fontSize: '1rem' }}>
              No jackpot win recorded yet
            </p>
          )}
        </div>
        <div className="stat">
          <p className="label">Known wins</p>
          <p className="value">{fmtInt(wins.length)}</p>
          <p className="small muted" style={{ margin: 0 }}>
            {wins.length === 0 ? 'in the available sources' : `${withNumbers} with winning numbers in our archive`}
          </p>
        </div>
      </div>

      {wins.length === 0 ? (
        <EmptyState title="No jackpot win found in the available sources yet." />
      ) : (
        <div className="table-wrap">
          <table className="jw-table">
            <caption className="sr-only">
              Known jackpot wins of {lottery.name}, newest first: date, draw, winning letter and numbers, winners, jackpot, source and
              whether the picks use it
            </caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Draw</th>
                <th scope="col">Winning letter + numbers</th>
                <th scope="col">Winners</th>
                <th scope="col">Jackpot</th>
                <th scope="col">Source</th>
                <th scope="col">Used by the picks</th>
              </tr>
            </thead>
            <tbody>
              {wins.map((w) => (
                <tr key={`${w.drawNo}-${w.source}`}>
                  <td className={w.date ? 'nowrap' : undefined}>{dateCell(w)}</td>
                  <td className="num nowrap">#{w.drawNo}</td>
                  <td>
                    {w.numbers ? (
                      <span className="jw-numbers">
                        <TrophyIcon size={12} />
                        <BallRow letter={w.letter} numbers={w.numbers} bonus={w.bonus} bonusLabel={lottery.bonusLabel} size="sm" caption={`Draw ${w.drawNo}`} />
                      </span>
                    ) : (
                      <span className="muted">numbers not in our archive</span>
                    )}
                  </td>
                  <td className="num nowrap">{winnersCell(w)}</td>
                  <td className="num nowrap">{w.amount !== null ? fmtRupees(w.amount) : '-'}</td>
                  <td>{SOURCE_LABEL[w.source]}</td>
                  <td className="nowrap">{usedByPicks(w)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notes.length ? (
        <ul className="notes">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
