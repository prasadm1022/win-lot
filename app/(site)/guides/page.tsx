// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLotteries } from '@/lib/data'
import { ARTICLES, articlePath } from '@/lib/articles'
import { BOARD_NAME, pageMetadata, trailPageJsonLd } from '@/lib/seo'
import { JsonLd } from '@/components/JsonLd'
import { Disclaimer } from '@/components/Notices'
import { fmtDate, fmtInt } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'

const DESCRIPTION =
  'Guides to Sri Lanka lottery results from WinLot: how to read a result, jackpot wins, number frequency, how the picks work and full results archives.'

export const metadata: Metadata = pageMetadata({
  title: 'Sri Lanka Lottery Guides and Results Archives',
  description: DESCRIPTION,
  path: '/guides',
})

export default function GuidesPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const total = lotteries.reduce((s, l) => s + l.drawCount, 0)
  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link href="/">All lotteries</Link> <span className="muted">/</span> Guides
      </nav>

      <header className="policy-head">
        <p className="eyebrow">Guides</p>
        <h1>Guides to Sri Lanka&apos;s lottery results</h1>
        <p className="page-intro">
          Plain-language guides to the results of the seven lotteries of the National Lotteries Board (NLB) and the Development
          Lotteries Board (DLB), written by WinLot from its own archive of {fmtInt(total)} official draws. Every figure in them is
          worked out from that archive each time the site is rebuilt, so the numbers you read are the numbers in the data. They
          explain what a result means, what the record of jackpot wins shows, what counting past numbers can and cannot tell you,
          and how WinLot&apos;s picks are made and checked.
        </p>
      </header>

      <section className="card" aria-labelledby="articles-title">
        <h2 id="articles-title">Articles</h2>
        <ul className="guide-list">
          {ARTICLES.map((a) => (
            <li key={a.slug}>
              <h3>
                <Link href={articlePath(a.slug)}>{a.heading}</Link>
              </h3>
              <p className="muted small">
                Published <time dateTime={a.published}>{fmtDate(a.published)}</time>
              </p>
              <p>{a.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="archives-title">
        <h2 id="archives-title">Results archives and lottery guides</h2>
        <p className="small muted">
          Every result WinLot holds for each lottery, newest first and grouped by year, and a short guide to each lottery: who runs
          it, when it is drawn, what its result looks like and where to find the official information.
        </p>
        {(['NLB', 'DLB'] as const).map((board) => (
          <div key={board} className="archive-board">
            <h3>
              {BOARD_NAME[board]} ({board})
            </h3>
            <ul className="related-list">
              {lotteries
                .filter((l) => l.board === board)
                .map((l) => (
                  <li key={l.id}>
                    <Link href={`/l/${l.id}/results`}>{l.name} results archive</Link>
                    <span className="muted small">
                      {' '}
                      · {fmtInt(l.drawCount)} draws{l.drawCount ? ` since ${fmtDate(l.firstDate)}` : ''} ·{' '}
                    </span>
                    <Link href={`/l/${l.id}#guide`} className="small">
                      guide
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card prose" aria-labelledby="guides-about-title">
        <h2 id="guides-about-title">About these guides</h2>
        <p>
          WinLot is run by HadesVault.com and is not connected to either lottery board. The results belong to the boards: the
          guides only describe what their published results show. Ticket prices, prize claims and claim deadlines are the
          boards&apos; own rules, so for those go to <a href="https://www.nlb.lk">nlb.lk</a> or{' '}
          <a href="https://www.dlb.lk">dlb.lk</a>. How the picks are made is set out in full on{' '}
          <Link href="/about">How it works</Link>.
        </p>
      </section>

      <Disclaimer />
      <JsonLd data={trailPageJsonLd('CollectionPage', [{ name: 'Guides', path: '/guides' }], DESCRIPTION)} />
    </div>
  )
}
