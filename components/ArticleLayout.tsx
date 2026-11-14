// SPDX-License-Identifier: Apache-2.0
// Server component: the frame of every /guides article - breadcrumb, heading with the publication date and the date the
// figures run to, the article body, links to the other guides, the disclaimer and the Article JSON-LD. Static markup only.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ARTICLES, articlePath, type ArticleMeta } from '@/lib/articles'
import { articleJsonLd } from '@/lib/seo'
import { JsonLd } from './JsonLd'
import { Disclaimer } from './Notices'
import { fmtDate } from './util/format'

interface Props {
  meta: ArticleMeta
  /** The h1 when it differs from meta.heading (e.g. with the year). */
  heading?: string
  /** One plain paragraph under the heading. */
  lede: string
  /** The newest draw date the figures were computed from (YYYY-MM-DD). */
  dataTo: string
  children: ReactNode
}

export function ArticleLayout({ meta, heading, lede, dataTo, children }: Props) {
  const path = articlePath(meta.slug)
  const others = ARTICLES.filter((a) => a.slug !== meta.slug)
  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link href="/">All lotteries</Link> <span className="muted">/</span> <Link href="/guides">Guides</Link>{' '}
        <span className="muted">/</span> {meta.heading}
      </nav>

      <article className="card prose article" aria-labelledby="article-title">
        <header className="article-head">
          <p className="eyebrow">Guide</p>
          <h1 id="article-title">{heading ?? meta.heading}</h1>
          <p className="article-meta small muted">
            Published <time dateTime={meta.published}>{fmtDate(meta.published)}</time> by HadesVault.com · figures computed
            from the official results up to <time dateTime={dataTo}>{fmtDate(dataTo)}</time>
          </p>
          <p className="article-lede">{lede}</p>
        </header>
        {children}
      </article>

      <nav className="card related" aria-labelledby="more-guides-title">
        <h2 id="more-guides-title">More guides</h2>
        <ul className="related-list">
          {others.map((a) => (
            <li key={a.slug}>
              <Link href={articlePath(a.slug)}>{a.heading}</Link>
            </li>
          ))}
          <li>
            <Link href="/guides">All guides and results archives</Link>
          </li>
        </ul>
      </nav>

      <Disclaimer />
      <JsonLd
        data={articleJsonLd({
          path,
          headline: meta.heading,
          description: meta.description,
          datePublished: meta.published,
          dateModified: dataTo,
        })}
      />
    </div>
  )
}

/** The newest draw date over all lotteries (YYYY-MM-DD), or the fallback when no lottery has draws. */
export function newestDrawDate(lotteries: { lastDraw: { date: string } | null }[], fallback: string): string {
  return lotteries.reduce((acc, l) => (l.lastDraw && l.lastDraw.date > acc ? l.lastDraw.date : acc), '') || fallback
}
