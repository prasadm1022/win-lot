// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import { LOTTERY_IDS, getLotteries, getPrediction, getStatus } from '@/lib/data'
import type { BacktestDetail, Board } from '@/lib/types'
import { fmtDateTime, fmtMonthYear } from '@/components/util/format'
import { Disclaimer, EmptyState } from '@/components/Notices'
import { pooledHeadline } from '@/components/charts/Backtest'

/**
 * The pooled backtest result and its Holm family (attached to every lottery's payload by predictAllV2), from the first
 * payload that carries them; null while no lottery has a backtest. The About page prints it instead of a fixed claim.
 */
function pooledResult(): { pooled: NonNullable<BacktestDetail['pooled']>; holmAll: BacktestDetail['holmAll'] } | null {
  for (const id of LOTTERY_IDS) {
    try {
      const d = getPrediction(id).backtestDetail
      if (d?.pooled) return { pooled: d.pooled, holmAll: d.holmAll }
    } catch {
      // a lottery without draws has no prediction yet
    }
  }
  return null
}

export const metadata: Metadata = {
  title: 'Method & status',
  description:
    'How WinLot marks the jackpot-winning days it knows of and weighs jackpot-winning numbers, jackpot dates and daily draws into its picks, how honest the backtest is, and when the data was last refreshed.',
}

export default function AboutPage() {
  const status = getStatus()
  const runs = status.runs ?? []
  const lotteries = getLotteries()
  /** Start of the draw archive per board (the earliest first draw date). */
  const archiveFrom = (board: Board): string | null =>
    lotteries.filter((l) => l.board === board && l.drawCount > 0).reduce<string | null>((acc, l) => (!acc || l.firstDate < acc ? l.firstDate : acc), null)
  const dlbFrom = archiveFrom('DLB')
  const nlbFrom = archiveFrom('NLB')
  const pooled = pooledResult()
  const imported =
    dlbFrom || nlbFrom
      ? ` The history was imported once: ${[dlbFrom ? `DLB draws from ${fmtMonthYear(dlbFrom)}` : '', nlbFrom ? `NLB draws from ${fmtMonthYear(nlbFrom)}` : '']
          .filter(Boolean)
          .join(', ')}.`
      : ''

  return (
    <div className="stack">
      <header>
        <p className="eyebrow">About</p>
        <h1>How WinLot works</h1>
      </header>

      <Disclaimer />

      <div className="grid grid-2">
        <section className="card prose" aria-labelledby="method-title">
          <h2 id="method-title">The method, in plain words</h2>
          <ol>
            <li>
              <strong>Collect.</strong> Once a day, after the evening draws, a scheduled job reads the newest results from nlb.lk and
              dlb.lk, adds them to the archive and rebuilds this site.{imported}
            </li>
            <li>
              <strong>Mark the jackpot days.</strong> Every draw whose jackpot (Super Prize) win we know of is marked &quot;Jackpot
              won&quot; in the history, and each lottery lists all of its known wins: the NLB prize tables (which we can check draw by
              draw only from the start of our archive), the NLB winners page, and for DLB, which publishes no winners list, a win
              inferred when the advertised jackpot falls and is still below its old amount one draw later, so DLB wins appear two
              draws late, without a winners count, and can only be marked from now on.
            </li>
            <li>
              <strong>Start fair.</strong> Every ball that is actually in the machine is treated as equally likely. A ball that has not
              come out for about 270 draws is treated as no longer in use.
            </li>
            <li>
              <strong>Weigh the evidence, strongest first.</strong> A jackpot-winning combination counts like 12 draws, a jackpot-winning
              date like 4, and an ordinary daily draw like 1. The order is kept in the result, not only in the weights: jackpot dates may
              never pull more than three quarters as hard as the combinations, and daily draws never more than three quarters as hard as
              the dates. With only a few jackpots known, the daily draws are turned down rather than the few jackpots blown up. Each page
              shows the actual split.
            </li>
            <li>
              <strong>What each source does.</strong> Jackpot combinations are not treated as lucky numbers; a few jackpots are far too
              few for that. The model learns only what they have in common: which tens their numbers fall in, how many are odd, how
              spread out they are, and their letter, with two imaginary &quot;perfectly average&quot; jackpots counted alongside so that one
              win cannot swing the pattern. Jackpot dates are checked for bunching on the calendar (moon phase, day of the month,
              weekday); where they bunch up, draws held on similar days count a little more, and where they do not, that feature is
              switched off. Daily draws add the recent history, turned down so they never outweigh the jackpot evidence.
            </li>
            <li>
              <strong>The copy guard.</strong> No card repeats a past result or copies a past jackpot: today a card shares at most one
              number with any one past jackpot and at most two with all of them together. The limit loosens a little as more jackpots
              become known, but never rules out more than 5% of all tickets; each lottery page shows the rule in force. Within those
              limits the picks do lean toward the tens where jackpot numbers fell; where jackpot combinations are known, the lottery
              page shows how many past-jackpot numbers the Top pick held on average, next to a random ticket&apos;s.
            </li>
            <li>
              <strong>Five cards.</strong> Top pick (all the evidence known for that lottery, jackpot evidence first), Jackpot pattern,
              Jackpot days and Daily draws (each follows its own source; while that source cannot move the picks, the card is a balanced
              pick from all the evidence that differs clearly from the cards before it, and its note says why), and Lucky dip: a random
              ticket that follows the same pick rules, shown on purpose. It has exactly the same chance as every other card.
            </li>
            <li>
              <strong>Check honestly.</strong> A walk-forward backtest replays the last 200 draws of every lottery (fewer where the archive
              is shorter), each time using only what was known before that draw, and compares the Top pick with a random ticket and with
              the previous model, each with its 95% range. The headline is the pooled result over all the lotteries, never the best
              single one. It says &quot;the same as random&quot; only while the pooled result sits inside the 95% range of luck; beyond
              that it says the result is outside the usual range for one check and whether, allowing for the number of checks run, it is
              still within luck. A result that stayed outside that range even after the allowance would be called most likely a rare
              fluke or a fault in the data or the method, never a way to win.
              {pooled ? ` At the last build: ${pooledHeadline(pooled.pooled, pooled.holmAll)}` : ''}
            </li>
          </ol>
          <p>
            <strong>What this is not.</strong> No method can foresee a random draw: every combination is equally likely, and the
            picks do not change that. Jackpot data describes the players, not the machine. Whether a jackpot is won depends on which
            tickets were sold, not on which balls fall, so jackpot combinations and dates tell us about the players. Leaning toward the
            patterns of past winning tickets cannot raise your odds and may mean sharing a prize with players who lean the same way.
            Treat the picks as a fun, data-driven way to choose numbers you would otherwise pick at random.
          </p>
          <h3 id="v1-title">Previous model (v1)</h3>
          <p className="small">
            The previous model scored each number from its long-run frequency, its recent frequency and the gap since it was last
            drawn, and sampled sets from those scores. It appears on each lottery page only for comparison, in the backtest and under
            &quot;Previous model (v1)&quot;. Its backtest assumed every ball of the full printed range is in use (1-80, or 1-82 for Dhana
            Nidhanaya), even where fewer balls are in use; the pages show the honest value next to it.
          </p>
        </section>

        <section className="card" aria-labelledby="status-title">
          <div className="card-head">
            <div>
              <p className="eyebrow">Data freshness</p>
              <h2 id="status-title">Recent fetch runs</h2>
            </div>
            <p className="card-sub">Last run {fmtDateTime(status.lastRun)}</p>
          </div>
          <p className="small muted">
            Data refreshes once a day via a scheduled job; every run is logged here. Times are Sri Lanka time.
          </p>
          {runs.length === 0 ? (
            <EmptyState title="No fetch runs recorded" hint="The daily job has not run yet." />
          ) : (
            <ul className="runs" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {runs.map((r) => (
                <li key={r.id} className={`run${r.status === 'ok' ? '' : ' error'}`}>
                  <span className="dot" aria-hidden="true" />
                  <span>
                    <b>{r.lottery_id}</b>{' '}
                    <span className="muted">
                      · {r.status === 'ok' ? 'ok' : 'failed'} · {r.inserted} new
                    </span>
                    <span className="sr-only">{r.status === 'ok' ? '' : ' (this run failed)'}</span>
                    {r.message ? <div className="msg">{r.message}</div> : null}
                  </span>
                  <span className="muted small" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDateTime(r.run_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card prose" aria-labelledby="resp-title">
        <h2 id="resp-title">Play responsibly</h2>
        <p>
          Set a budget before you buy and stick to it. Lotteries are a form of entertainment, not an income plan. If playing
          stops being fun, take a break. WinLot never sells tickets and never asks for payment details.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Results are the property of the National Lotteries Board and the Development Lotteries Board of Sri Lanka. Always
          confirm winning numbers with the official source before claiming a prize.
        </p>
      </section>
    </div>
  )
}
