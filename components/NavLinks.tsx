// SPDX-License-Identifier: Apache-2.0
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/about', label: 'Method' },
]

/** Primary nav links with aria-current for the active route. */
export function NavLinks() {
  const pathname = usePathname()
  return (
    <>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
    </>
  )
}
