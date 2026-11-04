// SPDX-License-Identifier: Apache-2.0
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  // "Home" hides on narrow phones (CSS .nav-home): the logo beside it already links home
  { href: '/', label: 'Home', className: 'nav-home' },
  { href: '/about', label: 'How it works' },
  { href: '/about-us', label: 'About us' },
  { href: '/contact', label: 'Contact' },
  { href: '/privacy', label: 'Privacy' },
]

/** Primary nav links with aria-current for the active route. */
export function NavLinks() {
  const pathname = usePathname()
  return (
    <>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={l.className}
          aria-current={pathname === l.href ? 'page' : undefined}
        >
          {l.label}
        </Link>
      ))}
    </>
  )
}
