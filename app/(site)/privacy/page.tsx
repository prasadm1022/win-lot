// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import { fmtDate } from '@/components/util/format'

/** Date of the latest version of this policy (ISO); shown as "Last updated ..." at the end of the page. */
export const PRIVACY_UPDATED = '2026-11-01'

export const metadata: Metadata = {
  title: 'Privacy',
  description:
    'What WinLot stores on your device, who runs it, how Google ads use cookies across hadesvault.com, and how to change your choices.',
}

export default function PrivacyPage() {
  return (
    <div className="stack">
      <header>
        <p className="eyebrow">Privacy</p>
        <h1>Privacy policy</h1>
        <p className="muted">
          WinLot is a free site that shows lottery results, statistics and picks for fun. This page explains the little it stores
          and what Google&apos;s ads do when they are on.
        </p>
      </header>

      <section className="card prose" aria-labelledby="pp-who">
        <h2 id="pp-who">Who runs WinLot</h2>
        <p>
          WinLot is run by Hades Vault, a software studio in Sri Lanka, and lives at winlot.hadesvault.com. It is one of the sites
          Hades Vault hosts under hadesvault.com, and all of them follow the same rules for ads and cookies. The{' '}
          <a href="https://hadesvault.com/privacy">Hades Vault privacy policy</a> covers the rest of hadesvault.com.
        </p>
        <p>
          For questions about this policy, use the <a href="https://hadesvault.com/contact">Hades Vault contact page</a>.
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
        <h2 id="pp-ads">Ads by Google</h2>
        <p>
          WinLot may show clearly labelled advertisements served by Google AdSense. When ads are on, Google and its partners use
          cookies or similar identifiers to show and measure ads. The ads you see may be personalised from your visits to this and
          other websites.
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
          WinLot. To change your choice later, use &quot;Privacy and cookie settings&quot; on any page.
        </p>
      </section>

      <section className="card prose" aria-labelledby="pp-changes">
        <h2 id="pp-changes">Changes to this policy</h2>
        <p>This page changes when WinLot&apos;s or Hades Vault&apos;s use of ads or storage changes. The date below shows the latest version.</p>
      </section>

      <p className="small muted">Last updated {fmtDate(PRIVACY_UPDATED)}.</p>
    </div>
  )
}
