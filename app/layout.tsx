// SPDX-License-Identifier: Apache-2.0
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ConsentSettingsLink } from '@/components/ConsentSettingsLink'
import { NavLinks } from '@/components/NavLinks'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ADSENSE_PUBLISHER_ID } from '@/lib/ads'
import { SITE_URL } from '@/lib/seo'
import './globals.css'

// Shared defaults, also the 404 page's fallback. Every content page sets its own title, description, canonical URL,
// Open Graph and Twitter card through pageMetadata() (lib/seo.ts); a canonical here would make every page claim to be
// the home page.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'WinLot - Sri Lanka Lottery Predictions, NLB & DLB',
    template: '%s - WinLot',
  },
  description:
    'Lottery prediction tool for Sri Lanka: next-draw predictions for every NLB and DLB lottery, calculated daily from the official results.',
  applicationName: 'WinLot',
  category: 'reference',
  // Draw numbers are not phone numbers: stop iOS turning them into call links.
  formatDetection: { telephone: false },
  icons: { icon: '/favicon.svg', apple: '/apple-icon.png' },
  // WinLot is a project by HadesVault.com
  authors: [{ name: 'HadesVault.com', url: 'https://hadesvault.com' }],
  creator: 'HadesVault.com',
  publisher: 'HadesVault.com',
  // AdSense site verification. Loads nothing; the ad script itself stays behind NEXT_PUBLIC_ADSENSE_CLIENT (AdFrame).
  other: { 'google-adsense-account': ADSENSE_PUBLISHER_ID },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
  themeColor: '#0b1120',
}

// Runs before first paint: apply the saved theme (or the system preference) to <html>
// so neither the page nor the toggle icon flashes the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem('winlot-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t;if(t==='light'){var m=document.querySelector('meta[name="theme-color"]');m&&m.setAttribute('content','#ffffff')}}catch(e){}`

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" aria-label="WinLot home">
              <LogoMark className="brand-mark" size={32} />
              WinLot
              <span className="brand-tag">Sri Lanka</span>
            </Link>
            {/* Links only inside the landmark; the toggle sits beside it so the two-row phone header is brand + toggle / links. */}
            <nav className="site-nav" aria-label="Primary">
              <NavLinks />
            </nav>
            <ThemeToggle />
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <div className="container">
            <div className="footer-top">
              <div className="footer-brand">
                <Link href="/" className="brand" aria-label="WinLot home">
                  <LogoMark className="brand-mark" size={26} />
                  WinLot
                </Link>
                <p>
                  Lottery predictions calculated from the official results of the{' '}
                  <a href="https://www.nlb.lk">National Lotteries Board (nlb.lk)</a> and the{' '}
                  <a href="https://www.dlb.lk">Development Lotteries Board (dlb.lk)</a>. The results are theirs; WinLot only does
                  the maths and is not affiliated with either board.
                </p>
              </div>
              <ul className="footer-links">
                <li>
                  <Link href="/">All lotteries</Link>
                </li>
                <li>
                  <Link href="/guides">Guides</Link>
                </li>
                <li>
                  <Link href="/about">How it works</Link>
                </li>
                <li>
                  <Link href="/about-us">About us</Link>
                </li>
                <li>
                  <Link href="/contact">Contact</Link>
                </li>
                <li>
                  <Link href="/privacy">Privacy</Link>
                </li>
                <li>
                  {/* Rendered only, never imported for a value (lesson L9): it is a client component. */}
                  <ConsentSettingsLink />
                </li>
              </ul>
            </div>
            <div className="footer-bottom">
              <span>
                <strong className="age-badge">18+</strong> Lotteries are for adults only. Draws are random. Play responsibly.
              </span>
              <span>
                A project by <a href="https://hadesvault.com">HadesVault.com</a>
              </span>
            </div>
          </div>
        </footer>
      </body>
    </html>
  )
}
