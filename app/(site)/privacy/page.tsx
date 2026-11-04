// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { fmtDate } from '@/components/util/format'
import { JsonLd } from '@/components/JsonLd'
import { pageJsonLd, pageMetadata } from '@/lib/seo'

/** Date of the latest version of this policy (ISO); shown as "Last updated ..." at the end of the page. */
export const PRIVACY_UPDATED = '2026-11-04'

const DESCRIPTION =
  'What WinLot stores on your device, who runs it, how Google ads use cookies across hadesvault.com, and how to change your choices.'

export const metadata: Metadata = pageMetadata({ title: 'Privacy Policy', description: DESCRIPTION, path: '/privacy' })

export default function PrivacyPage() {
  return (
    <div className="stack">
      <header className="policy-head">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="muted">
          WinLot is a free site that shows lottery results, statistics and picks for fun. This page explains the little it stores
          and what Google&apos;s ads do when they are on.
        </p>
        <p className="small muted policy-date">Last updated {fmtDate(PRIVACY_UPDATED)}.</p>
      </header>

      {/* Two balanced columns on wide screens (CSS columns, so short and long sections pack without gaps); one on phones. */}
      <div className="policy-grid">
        <section className="card prose" aria-labelledby="pp-who">
          <h2 id="pp-who">Who runs WinLot</h2>
          <p>
            WinLot is a project by <a href="https://hadesvault.com">HadesVault.com</a>, a software studio in Sri Lanka, and lives
            at winlot.hadesvault.com. It is one of the sites HadesVault.com hosts under its domain, and all of them follow the
            same rules for ads and cookies. The <a href="https://hadesvault.com/privacy">HadesVault.com privacy policy</a> covers
            the rest of hadesvault.com.
          </p>
          <p>
            For questions about this policy, use the <Link href="/contact">WinLot contact page</Link>.
          </p>
        </section>

        <section className="card prose" aria-labelledby="pp-what">
          <h2 id="pp-what">What WinLot stores</h2>
          <p>
            WinLot has no accounts, no sign-up and no forms. It does not ask for your name, email address or any other personal
            details, and it keeps no record of your visits.
          </p>
          <p>The only thing WinLot saves is your light or dark theme choice, in this browser only. Clearing your browser data removes it.</p>
        </section>

        <section className="card prose" aria-labelledby="pp-ads">
          <h2 id="pp-ads">Google advertising</h2>
          <p>
            WinLot may show clearly labelled advertisements served by Google AdSense. When ads are on, Google and its partners use
            cookies or similar identifiers to show and measure ads. Third-party vendors, including Google, use cookies to serve ads
            based on your earlier visits to this or other websites.
          </p>
          <p>
            Every site on hadesvault.com uses the same Google AdSense account. Google may keep its ad cookies for the whole
            hadesvault.com domain, so a cookie or ad choice set on one of these sites can also apply on the others.
          </p>
          <p>
            When ads are off, no ad code loads and none of this applies. Every ad space is marked &quot;Advertisement&quot; so you can
            tell it apart from WinLot&apos;s own results, statistics and picks.
          </p>
        </section>

        <section className="card prose" aria-labelledby="pp-choices">
          <h2 id="pp-choices">Your choices</h2>
          <p>
            You can turn off personalised ads in your{' '}
            <a href="https://adssettings.google.com" rel="noopener noreferrer">
              Google ad settings
            </a>
            .
          </p>
          <p>
            Google explains what it collects and why in{' '}
            <a href="https://policies.google.com/technologies/partner-sites" rel="noopener noreferrer">
              How Google uses information from sites that use its services
            </a>
            .
          </p>
          <p>Browser settings and ad-blocking tools also limit or block ad cookies; WinLot works the same either way.</p>
        </section>

        <section className="card prose" aria-labelledby="pp-eea">
          <h2 id="pp-eea">Visitors in the EEA, the UK and Switzerland</h2>
          <p>
            If you visit from the European Economic Area, the United Kingdom or Switzerland, a consent message from a Google-certified
            consent platform asks for your choice before any personalised ad is shown. You can decline and still read everything on
            WinLot. To change your choice later, use &quot;Privacy and cookie settings&quot; at the bottom of any page.
          </p>
        </section>

        <section className="card prose" aria-labelledby="pp-changes">
          <h2 id="pp-changes">Changes to this policy</h2>
          <p>
            This page changes when WinLot&apos;s or HadesVault.com&apos;s use of ads or storage changes. The date at the top shows the
            latest version.
          </p>
        </section>
      </div>
      <JsonLd data={pageJsonLd('WebPage', '/privacy', 'Privacy policy', DESCRIPTION)} />
    </div>
  )
}
