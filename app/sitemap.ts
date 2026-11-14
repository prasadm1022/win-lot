// SPDX-License-Identifier: Apache-2.0
import type { MetadataRoute } from 'next'
import { getLotteries } from '@/lib/data'
import { ARTICLES, articlePath } from '@/lib/articles'
import { absUrl } from '@/lib/seo'
import { orderIndex } from '@/components/util/lotteryMeta'

/** Required by the static export: emitted once as out/sitemap.xml. */
export const dynamic = 'force-static'

/**
 * Every indexable page, in canonical (unslashed) form. A lottery page and its results archive carry the lottery's newest
 * draw date - a true date that changes when the page's content does - and the home page, the Guides page and the
 * articles (whose figures are computed from all the lotteries) take the newest of those. The other static pages carry
 * none rather than a build time that would claim a change on every deploy.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const dates = lotteries.map((l) => l.lastDraw?.date).filter((d): d is string => Boolean(d))
  const newest = dates.sort().at(-1)
  const latest = newest ? { lastModified: newest } : {}
  return [
    { url: absUrl('/'), ...latest },
    ...lotteries.flatMap((l) => {
      const modified = l.lastDraw ? { lastModified: l.lastDraw.date } : {}
      return [
        { url: absUrl(`/l/${l.id}`), ...modified },
        { url: absUrl(`/l/${l.id}/results`), ...modified },
      ]
    }),
    { url: absUrl('/guides'), ...latest },
    ...ARTICLES.map((a) => ({
      url: absUrl(articlePath(a.slug)),
      lastModified: newest && newest > a.published ? newest : a.published,
    })),
    { url: absUrl('/about') },
    { url: absUrl('/about-us') },
    { url: absUrl('/contact') },
    { url: absUrl('/privacy') },
  ]
}
