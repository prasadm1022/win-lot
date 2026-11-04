// SPDX-License-Identifier: Apache-2.0
import type { MetadataRoute } from 'next'
import { getLotteries } from '@/lib/data'
import { absUrl } from '@/lib/seo'
import { orderIndex } from '@/components/util/lotteryMeta'

/** Required by the static export: emitted once as out/sitemap.xml. */
export const dynamic = 'force-static'

/**
 * Every indexable page, in canonical (unslashed) form. A lottery page's lastModified is its newest draw date - a true
 * date that changes when the page's content does - and the home page takes the newest of those. The static pages carry
 * none rather than a build time that would claim a change on every deploy.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const dates = lotteries.map((l) => l.lastDraw?.date).filter((d): d is string => Boolean(d))
  const newest = dates.sort().at(-1)
  return [
    { url: absUrl('/'), ...(newest ? { lastModified: newest } : {}) },
    ...lotteries.map((l) => ({
      url: absUrl(`/l/${l.id}`),
      ...(l.lastDraw ? { lastModified: l.lastDraw.date } : {}),
    })),
    { url: absUrl('/about') },
    { url: absUrl('/about-us') },
    { url: absUrl('/contact') },
    { url: absUrl('/privacy') },
  ]
}
