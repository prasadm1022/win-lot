// SPDX-License-Identifier: Apache-2.0
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { NavLinks } from '@/components/NavLinks'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { ADSENSE_PUBLISHER_ID } from '@/lib/ads'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'WinLot - Sri Lanka lottery statistics and picks',
    template: '%s - WinLot',
  },
  description:
    'Sri Lankan lottery results, statistics and statistical picks for NLB and DLB draws. For entertainment only; draws are random.',
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
            <nav className="site-nav" aria-label="Primary">
              <NavLinks />
              <ThemeToggle />
            </nav>
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
                <p>Results are sourced from nlb.lk and dlb.lk. WinLot is independent and not affiliated with either board.</p>
              </div>
              <ul className="footer-links">
                <li>
                  <Link href="/">All lotteries</Link>
                </li>
                <li>
                  <Link href="/about">How it works</Link>
                </li>
                <li>
                  <Link href="/privacy">Privacy</Link>
                </li>
              </ul>
            </div>
            <div className="footer-bottom">
              <span>Draws are random. Play responsibly.</span>
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
