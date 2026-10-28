// SPDX-License-Identifier: Apache-2.0
'use client'
import { useCallback, useEffect, useState } from 'react'

export type Theme = 'dark' | 'light'
export const THEME_KEY = 'winlot-theme'
const THEME_COLOR: Record<Theme, string> = { dark: '#0b0a14', light: '#f7f3ea' }

/**
 * Light/dark switch. The initial theme is applied to <html data-theme> by an inline
 * script in the layout before first paint; this component only reads it after mount
 * (so server and client markup agree) and flips it on click. Which icon is visible is
 * decided by CSS from the same attribute, so there is never a wrong-icon flash.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    const t = document.documentElement.dataset.theme
    setTheme(t === 'light' ? 'light' : 'dark')
  }, [])

  const toggle = useCallback(() => {
    const current = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
    const next: Theme = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[next])
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
    setTheme(next)
  }, [])

  const label = theme ? `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode` : 'Switch colour theme'
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={label} title={label}>
      <svg className="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg className="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  )
}
