// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { Disclaimer } from '@/components/Notices'
import { JsonLd } from '@/components/JsonLd'
import { LOTTERIES } from '@/lib/lotteries'
import { BOARD_SOURCE, CONTACT, pageJsonLd, pageMetadata } from '@/lib/seo'

const DESCRIPTION =
  'Who runs WinLot and why: a free HadesVault.com project from Colombo showing NLB and DLB lottery results, statistics and picks for fun, refreshed daily.'

export const metadata: Metadata = pageMetadata({ title: 'About WinLot', description: DESCRIPTION, path: '/about-us' })

const NLB = BOARD_SOURCE.NLB
const DLB = BOARD_SOURCE.DLB

/**
 * Who runs WinLot, what it offers, where the results come from and what it is not. Lives in the `(site)` group, so it
 * carries the same ad frame as every other content page. "How it works" (`/about`) stays the method page.
 * Static copy only: nothing here can go stale (no counts, no dates; the refresh cadence is a policy, not a timestamp).
 */
export default function AboutUsPage() {
  return (
    <div className="stack">
      <header className="policy-head">
        <p className="eyebrow">About us</p>
        <h1>About WinLot</h1>
        <p className="muted">
          WinLot is a free website about Sri Lanka&apos;s lotteries. This page says who runs it, what it offers and what it does
          not do.
        </p>
      </header>

      <div className="policy-grid">
        <section className="card prose" aria-labelledby="au-who">
          <h2 id="au-who">Who runs WinLot</h2>
          <p>
            WinLot is a project by <a href="https://hadesvault.com">{CONTACT.operator}</a>, a software studio in{' '}
            {CONTACT.location}. {CONTACT.operator} builds and hosts it at winlot.hadesvault.com and is responsible for
            everything on it.
          </p>
          <p>
            Questions, corrections and privacy requests go through the <Link href="/contact">Contact</Link> page.
          </p>
        </section>

        <section className="card prose" aria-labelledby="au-what">
          <h2 id="au-what">What WinLot offers</h2>
          <p>
            For seven Sri Lankan lotteries WinLot shows the winning numbers of every draw, marks the draws whose jackpot was won,
            works out statistics such as how often each number has appeared, and suggests picks for the next draw, for fun.
          </p>
          <ul>
            {LOTTERIES.map((l) => (
              <li key={l.id}>
                <Link href={`/l/${l.id}`}>{l.name}</Link> ({l.board})
              </li>
            ))}
          </ul>
          <p>
            How the picks are worked out, and how well that has gone in the past, is explained on{' '}
            <Link href="/about">How it works</Link>.
          </p>
        </section>

        <section className="card prose" aria-labelledby="au-sources">
          <h2 id="au-sources">Where the results come from</h2>
          <p>
            Every result is published first by the{' '}
            <a href={NLB.url} rel="noopener noreferrer">
              {NLB.name} ({NLB.host})
            </a>{' '}
            or the{' '}
            <a href={DLB.url} rel="noopener noreferrer">
              {DLB.name} ({DLB.host})
            </a>
            . WinLot reads those official pages and only does the maths on them. The results belong to the boards.
          </p>
          <p>
            WinLot is not affiliated with, endorsed by or connected to the {NLB.name} or the {DLB.name}. If a number on WinLot and
            a number on the official site ever differ, the official site is right.
          </p>
        </section>

        <section className="card prose" aria-labelledby="au-not">
          <h2 id="au-not">What WinLot is not</h2>
          <p>WinLot sells no tickets, takes no bets and handles no payments. There is nothing to sign up for and nothing to pay.</p>
          <p>
            The picks are a statistical curiosity for entertainment only. Lottery draws are random, so no pick can change your
            chance of winning.
          </p>
          <p>Lotteries are for adults. WinLot is written for visitors aged 18 and over.</p>
        </section>

        <section className="card prose" aria-labelledby="au-fresh">
          <h2 id="au-fresh">How fresh the data is</h2>
          <p>
            The results are refreshed once a day, after the evening draws, straight from {NLB.host} and {DLB.host}. The home page
            says when the newest data is older than expected.
          </p>
          <p>
            See <Link href="/about">How it works</Link> for the method and the data status, or{' '}
            <Link href="/contact">contact us</Link> if something looks wrong.
          </p>
        </section>
      </div>

      <Disclaimer />
      <JsonLd data={pageJsonLd('AboutPage', '/about-us', 'About WinLot', DESCRIPTION)} />
    </div>
  )
}
