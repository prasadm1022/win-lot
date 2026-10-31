// SPDX-License-Identifier: Apache-2.0
'use client'
import { useEffect, useRef, useState } from 'react'
import { requestAdOnce, type AdPosition } from '@/lib/ads'

declare global {
  interface Window {
    adsbygoogle?: object[]
  }
}

/**
 * One labelled ad space: a box reserved at its final size by CSS (no layout shift) around Google's `<ins>`.
 * Banners (no `minWidth`) carry the `<ins>` in the server markup. Rails mount it only once the viewport is at least
 * `minWidth` px wide and never unmount it: `adsbygoogle.push({})` fills the first unprocessed `<ins>` in the
 * document, so a hidden rail earlier in the DOM would swallow a banner's push. Each `<ins>` is pushed exactly once.
 * An unfilled, blocked or unreachable ad leaves the quiet labelled box and nothing else.
 */
export function AdSlot({ client, slot, position, minWidth }: { client: string; slot: string; position: AdPosition; minWidth?: number }) {
  const ref = useRef<HTMLModElement>(null)
  const [show, setShow] = useState(minWidth === undefined)

  useEffect(() => {
    if (minWidth === undefined) return
    const mql = window.matchMedia(`(min-width: ${minWidth}px)`)
    const on = () => {
      if (mql.matches) setShow(true)
    }
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [minWidth])

  useEffect(() => {
    const ins = ref.current
    if (!show || !ins) return
    try {
      requestAdOnce(ins, (window.adsbygoogle ||= []))
    } catch {
      /* blocked or failed loader: content is unaffected */
    }
  }, [show])

  const kind = minWidth === undefined ? 'ad-banner' : 'ad-rail'
  const labelId = `ad-${position}-label`
  return (
    <aside className={`ad ad-${position} ${kind}`} aria-labelledby={labelId}>
      <span id={labelId} className="ad-label">
        Advertisement
      </span>
      <div className="ad-box">
        {show ? (
          <ins
            ref={ref}
            className="adsbygoogle"
            style={{ display: 'block', width: '100%', height: '100%' }}
            data-ad-client={client}
            data-ad-slot={slot}
            data-full-width-responsive="false"
          />
        ) : null}
      </div>
    </aside>
  )
}
