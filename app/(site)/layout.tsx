// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react'
import { AdFrame } from '@/components/AdFrame'
import { getAdsConfig } from '@/lib/ads'

/**
 * Layout of every content page (home, lottery pages, Method, Privacy): `AdFrame` is the single place that wraps content
 * in the skip-link target `<main id="main">` and, when ads are configured at build time, puts the ad spaces around it.
 * The 404 page lives outside this group and renders its own `<main>` (no ads, no loader).
 */
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <AdFrame config={getAdsConfig()}>{children}</AdFrame>
}
