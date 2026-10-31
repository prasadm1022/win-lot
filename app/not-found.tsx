// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState } from '@/components/Notices'

export const metadata: Metadata = { title: 'Page not found' }

/** Lives outside the `(site)` route group, so it renders its own `<main id="main">` (skip-link target) and carries no ads. */
export default function NotFound() {
  return (
    <main id="main" tabIndex={-1}>
      <div className="container">
        <div className="card">
          <EmptyState title="Page not found" hint="That link does not go anywhere we know." />
          <p style={{ textAlign: 'center' }}>
            <Link href="/" className="btn btn-primary">
              Back to home
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
