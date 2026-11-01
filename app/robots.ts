// SPDX-License-Identifier: Apache-2.0
import type { MetadataRoute } from 'next'
import { absUrl } from '@/lib/seo'

/** Required by the static export: emitted once as out/robots.txt. */
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: absUrl('/sitemap.xml'),
  }
}
