// SPDX-License-Identifier: Apache-2.0
import { ADSENSE_PUBLISHER_ID, adsTxtContent, getAdsConfig } from '@/lib/ads'

// Emitted once as out/ads.txt by `next build` itself, so it ships whatever build command the host runs. (It used to be
// written into public/ by the prebuild, which a host running `next build` directly skips.)
export const dynamic = 'force-static'

/** The AdSense authorised-sellers line: the configured client, else the owner's publisher ID. */
export function GET() {
  return new Response(adsTxtContent(getAdsConfig().client ?? ADSENSE_PUBLISHER_ID), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
