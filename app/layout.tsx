// SPDX-License-Identifier: Apache-2.0
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { NavLinks } from '@/components/NavLinks'
import { ThemeToggle } from '@/components/ThemeToggle'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'WinLot — Sri Lanka lottery statistics and picks',
    template: '%s — WinLot',
  },
  description:
    'Sri Lankan lottery results, statistics and statistical picks for NLB and DLB draws. For entertainment only; draws are random.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark light',
  themeColor: '#0b0a14',
}

// Runs before first paint: apply the saved theme (or the system preference) to <html>
// so neither the page nor the toggle icon flashes the wrong theme.
const THEME_SCRIPT = `try{var t=localStorage.getItem('winlot-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t;if(t==='light'){var m=document.querySelector('meta[name="theme-color"]');m&&m.setAttribute('content','#f7f3ea')}}catch(e){}`

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
              <span className="brand-mark" aria-hidden="true">
                W
              </span>
              WinLot
              <span className="brand-tag">Sri Lanka</span>
            </Link>
            <nav className="site-nav" aria-label="Primary">
              <NavLinks />
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container">
            <span>Results are sourced from nlb.lk and dlb.lk. WinLot is independent and not affiliated with either board.</span>
            <span>Draws are random. Play responsibly.</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
