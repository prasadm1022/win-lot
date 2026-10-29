// SPDX-License-Identifier: Apache-2.0
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DrawSummary } from '@/lib/types'
import { fmtDate, fmtInt } from './util/format'
import { BallRow } from './Ball'
import { JackpotBadge } from './JackpotBadge'
import { EmptyState, ErrorNotice } from './Notices'

import { HISTORY_PAGE as PAGE } from './util/constants'

interface Props {
  id: string
  /** First page, rendered into the static HTML. */
  initial: DrawSummary[]
  total: number
  bonusLabel: string | null
}

type Loaded = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; draws: DrawSummary[] }

/**
 * Draw history with client-side pagination. Page 1 is static; older pages come from the
 * open-data file `/data/<id>/draws.json` (DrawSummary[], newest first) emitted by the
 * prebuild step, fetched once on first use so the page HTML stays small.
 */
export function HistoryTable({ id, initial, total, bonusLabel }: Props) {
  const [page, setPage] = useState(0)
  const [all, setAll] = useState<Loaded>({ state: 'idle' })
  const totalPages = Math.max(1, Math.ceil(total / PAGE))
  const liveRef = useRef<HTMLSpanElement>(null)

  const load = useCallback(async () => {
    setAll({ state: 'loading' })
    try {
      const res = await fetch(`/data/${encodeURIComponent(id)}/draws.json`, { headers: { accept: 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { draws?: DrawSummary[] } | DrawSummary[]
      const draws = Array.isArray(body) ? body : body.draws
      if (!Array.isArray(draws)) throw new Error('Unexpected file format')
      setAll({ state: 'ok', draws })
    } catch (err) {
      setAll({ state: 'error', message: err instanceof Error ? err.message : 'Network error' })
    }
  }, [id])

  useEffect(() => {
    if (page > 0 && all.state === 'idle') void load()
  }, [page, all.state, load])

  const rows = page === 0 ? initial : all.state === 'ok' ? all.draws.slice(page * PAGE, page * PAGE + PAGE) : null
  const loading = page > 0 && (all.state === 'loading' || all.state === 'idle')

  if (total === 0 || initial.length === 0) {
    return <EmptyState title="No draws yet" hint="History will appear after the first daily refresh." />
  }

  return (
    <>
      <div className="table-wrap" aria-busy={loading}>
        {page > 0 && all.state === 'error' ? (
          <ErrorNotice message={`Older draws could not be fetched (${all.message}).`} onRetry={() => void load()} />
        ) : (
          <table className="history">
            <caption className="sr-only">Draw history, newest first. Draws with a known jackpot win carry a &quot;Jackpot won&quot; badge.</caption>
            <thead>
              <tr>
                <th scope="col">Draw</th>
                <th scope="col">Date</th>
                <th scope="col">Result</th>
                <th scope="col">Sum</th>
              </tr>
            </thead>
            <tbody>
              {(rows ?? initial).map((d) => (
                <tr key={d.drawNo} className={d.jackpot ? 'jp-row' : undefined} style={loading ? { opacity: 0.45 } : undefined}>
                  <td className="num">
                    #{d.drawNo}
                    {d.jackpot ? (
                      <div className="jp-cell">
                        <JackpotBadge jackpot={d.jackpot} id={`jp-${id}-${d.drawNo}`} size="sm" />
                      </div>
                    ) : null}
                  </td>
                  <td>{fmtDate(d.date)}</td>
                  <td>
                    <BallRow letter={d.letter} numbers={d.numbers} bonus={d.bonus} bonusLabel={bonusLabel} size="sm" />
                  </td>
                  <td className="num">{d.numbers.reduce((a, b) => a + b, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="pager">
        <span ref={liveRef} aria-live="polite">
          Page {page + 1} of {totalPages} · {fmtInt(total)} draws
        </span>
        <div className="btns">
          <button type="button" className="btn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}>
            ← Newer
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1 || loading}
          >
            Older →
          </button>
        </div>
      </div>
    </>
  )
}
