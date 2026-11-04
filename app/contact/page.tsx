// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import { JsonLd } from '@/components/JsonLd'
import { BOARD_SOURCE, CONTACT, pageJsonLd, pageMetadata } from '@/lib/seo'

const DESCRIPTION =
  'How to reach HadesVault.com, the studio in Colombo, Sri Lanka that runs WinLot: one email address for corrections, privacy questions and ad concerns.'

export const metadata: Metadata = pageMetadata({ title: 'Contact WinLot', description: DESCRIPTION, path: '/contact' })

const NLB = BOARD_SOURCE.NLB
const DLB = BOARD_SOURCE.DLB

/**
 * Lives outside the `(site)` route group, like the 404 page, so it renders its own `<main id="main">` (skip-link target)
 * and carries no ads and no Google code. No form and no inputs: the static site has no server, so the one contact
 * method is the `mailto:` link to CONTACT.email (lib/seo.ts, WinLot's copy of the hadesvault.com details).
 */
export default function ContactPage() {
  return (
    <main id="main" tabIndex={-1}>
      <div className="container">
        <div className="stack">
          <header className="policy-head">
            <p className="eyebrow">Contact</p>
            <h1>Contact WinLot</h1>
            <p className="muted">
              WinLot is run by {CONTACT.operator}. There is no form here and nothing to sign up for: one email address reaches
              the people who run the site.
            </p>
          </header>

          <div className="policy-grid">
            <section className="card prose" aria-labelledby="ct-write">
              <h2 id="ct-write">Write to us</h2>
              <p>
                Operator: <a href="https://hadesvault.com">{CONTACT.operator}</a>
              </p>
              <p>Location: {CONTACT.location}</p>
              <p>
                Email: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              </p>
              <p className="small muted">The link opens your mail app. If nothing opens, copy the address instead.</p>
              <p>
                These are the same details as on the{' '}
                <a href={CONTACT.url} rel="noopener noreferrer">
                  HadesVault.com contact page
                </a>
                .
              </p>
            </section>

            <section className="card prose" aria-labelledby="ct-topics">
              <h2 id="ct-topics">What to write about</h2>
              <p>Anything is welcome. The usual reasons are:</p>
              <ul>
                <li>A wrong result or jackpot mark: tell us the lottery, the draw number and the date.</li>
                <li>A privacy question about this site or the ads on it.</li>
                <li>An advertising or policy concern.</li>
                <li>Anything else: a broken page, an idea, a thank-you.</li>
              </ul>
            </section>

            <section className="card prose" aria-labelledby="ct-before">
              <h2 id="ct-before">Before you write</h2>
              <p>
                WinLot does not sell tickets or pay prizes. Always confirm a prize with the board that ran the draw:{' '}
                <a href={NLB.url} rel="noopener noreferrer">
                  {NLB.host}
                </a>{' '}
                for NLB lotteries or{' '}
                <a href={DLB.url} rel="noopener noreferrer">
                  {DLB.host}
                </a>{' '}
                for DLB lotteries.
              </p>
              <p>We cannot look up a ticket, a winner or a prize payment. Those questions go to the boards.</p>
            </section>
          </div>
          <JsonLd data={pageJsonLd('ContactPage', '/contact', 'Contact WinLot', DESCRIPTION)} />
        </div>
      </div>
    </main>
  )
}
