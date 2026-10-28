import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { isMockMode, onMockModeChange } from '../api/client'
import { useTheme } from '../lib/useTheme'

function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  )
}

export function Layout() {
  const [mock, setMock] = useState(isMockMode())
  const { pathname } = useLocation()

  useEffect(() => onMockModeChange(() => setMock(true)), [])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container">
          <NavLink to="/" className="brand" aria-label="WinLot home">
            <span className="brand-mark" aria-hidden="true">
              W
            </span>
            WinLot
            <span className="brand-tag">Sri Lanka</span>
          </NavLink>
          <nav className="site-nav" aria-label="Primary">
            <NavLink to="/" end>
              Home
            </NavLink>
            <NavLink to="/about">Method</NavLink>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      {mock ? (
        <div className="mock-banner" role="status">
          Showing sample data — the live API is not reachable right now.
        </div>
      ) : null}
      <main id="main" tabIndex={-1}>
        <div className="container">
          <Outlet />
        </div>
      </main>
      <footer className="site-footer">
        <div className="container">
          <span>
            Results are sourced from nlb.lk and dlb.lk. WinLot is independent and not affiliated with either board.
          </span>
          <span>Draws are random. Play responsibly.</span>
        </div>
      </footer>
    </>
  )
}
