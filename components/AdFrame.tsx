// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react'
import { adsLoaderSrc, RAIL_MIN_WIDTH, type AdsConfig } from '@/lib/ads'
import { AdSlot } from '@/components/AdSlot'

/**
 * Frame of every content page: the Google loader once (whenever the client is valid, even with no slots, for site
 * verification), the top and bottom banners and the side rails around `<main id="main">`, never inside it. With no
 * client it renders exactly today's `<main>` markup: no script, no ad space, no gap.
 * Not `next/script`: it adds `data-nscript`, which AdSense flags. React hoists the async script into `<head>`.
 */
export function AdFrame({ config, children }: { config: AdsConfig; children: ReactNode }) {
  const main = (
    <main id="main" tabIndex={-1}>
      <div className="container">{children}</div>
    </main>
  )
  const { client, slots } = config
  if (!client) return main
  const hasRails = Boolean(slots.left || slots.right)
  return (
    <>
      <script async src={adsLoaderSrc(client)} crossOrigin="anonymous" />
      {slots.top ? <AdSlot client={client} slot={slots.top} position="top" /> : null}
      <div className={hasRails ? 'site-shell has-rails' : 'site-shell'}>
        {slots.left ? <AdSlot client={client} slot={slots.left} position="left" minWidth={RAIL_MIN_WIDTH} /> : null}
        {main}
        {slots.right ? <AdSlot client={client} slot={slots.right} position="right" minWidth={RAIL_MIN_WIDTH} /> : null}
      </div>
      {slots.bottom ? <AdSlot client={client} slot={slots.bottom} position="bottom" /> : null}
    </>
  )
}
