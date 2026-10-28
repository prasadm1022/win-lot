// SPDX-License-Identifier: Apache-2.0
'use client'
import { useEffect, useState } from 'react'
import { daysSince, fmtDate, fmtDateTime } from './util/format'
import { WarnNotice } from './Notices'

interface Props {
  /** Newest draw date (YYYY-MM-DD) across the lotteries shown on the page. */
  newestDrawDate: string | null
  /** Last fetch-log run (ISO), if any. */
  lastRun: string | null
  /** Days after the newest draw before the note shows. */
  thresholdDays?: number
}

/**
 * Shown when the newest draw is older than the threshold. The check runs in the browser
 * against the visitor's clock (a static page cannot know when it is being read), so the
 * server markup is empty and the note only appears after hydration.
 */
export function StaleNotice({ newestDrawDate, lastRun, thresholdDays = 2 }: Props) {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (!newestDrawDate) return
    setStale(daysSince(newestDrawDate) > thresholdDays)
  }, [newestDrawDate, thresholdDays])
  if (!stale || !newestDrawDate) return null
  return (
    <WarnNotice>
      <strong>Results may be out of date.</strong> The newest draw we have is from {fmtDate(newestDrawDate)}
      {lastRun ? `; the data was last refreshed ${fmtDateTime(lastRun)}` : ''}. The site refreshes once a day after
      the evening draws; check nlb.lk or dlb.lk for the very latest results.
    </WarnNotice>
  )
}
