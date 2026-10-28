// SPDX-License-Identifier: Apache-2.0
import { useEffect } from 'react'
import { api } from '../api/client'
import { useQuery } from '../lib/useQuery'
import { fmtDateTime } from '../lib/format'
import { Disclaimer, EmptyState, ErrorNotice } from '../components/Notices'
import { Skeleton } from '../components/Skeleton'

export function About() {
  const status = useQuery(() => api.status(), [])
  useEffect(() => {
    document.title = 'Method & status — WinLot'
  }, [])

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
              <strong>Collect.</strong> Every evening after the draws, a scheduled job reads the newest results from nlb.lk
              and dlb.lk and stores them. The full history was imported once.
            </li>
            <li>
              <strong>Score.</strong> Each number gets a score from 0 to 1: a weighted blend of its long-run frequency, its
              recent frequency (last 30 and 100 draws, with more weight on recent ones) and how overdue it is compared with
              its expected gap.
            </li>
            <li>
              <strong>Build sets.</strong> Three to five sets are sampled from those scores, keeping odd/even balance and the
              sum inside the historic middle range. The letter or zodiac sign follows its recent frequency.
            </li>
            <li>
              <strong>Check honestly.</strong> A walk-forward backtest replays the last 200 draws and compares the model's
              average hits against the random baseline. We show that number even when it says "no better than chance".
            </li>
          </ol>
          <p>
            <strong>What this is not.</strong> A lottery draw has no memory. Hot, cold and overdue numbers describe the
            past; they do not change the odds of the next draw. Treat the picks as a fun, data-driven way to choose
            numbers you would otherwise pick at random.
          </p>
        </section>

        <section className="card" aria-labelledby="status-title">
          <div className="card-head">
            <div>
              <p className="eyebrow">Data freshness</p>
              <h2 id="status-title">Recent fetch runs</h2>
            </div>
            {status.data ? <p className="card-sub">Last run {fmtDateTime(status.data.lastRun)}</p> : null}
          </div>
          {status.error ? (
            <ErrorNotice message={status.error} onRetry={status.refetch} />
          ) : status.loading ? (
            <div className="runs" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} h={42} />
              ))}
            </div>
          ) : !status.data || status.data.runs.length === 0 ? (
            <EmptyState title="No fetch runs recorded" hint="The nightly job has not run yet." />
          ) : (
            <ul className="runs" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {status.data.runs.map((r) => (
                <li key={r.id} className={`run${r.status === 'ok' ? '' : ' error'}`}>
                  <span className="dot" aria-hidden="true" />
                  <span>
                    <b>{r.lottery_id}</b>{' '}
                    <span className="muted">
                      · {r.status === 'ok' ? 'ok' : 'failed'} · {r.inserted} new
                    </span>
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
          Set a budget before you buy and stick to it. Lotteries are a form of entertainment, not an income plan. If
          playing stops being fun, take a break. WinLot never sells tickets and never asks for payment details.
        </p>
        <p className="small muted" style={{ margin: 0 }}>
          Results are the property of the National Lotteries Board and the Development Lotteries Board of Sri Lanka.
          Always confirm winning numbers with the official source before claiming a prize.
        </p>
      </section>
    </div>
  )
}
