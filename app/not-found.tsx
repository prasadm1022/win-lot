// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { EmptyState } from '@/components/Notices'

export const metadata: Metadata = { title: 'Page not found' }

export default function NotFound() {
  return (
    <div className="card">
      <EmptyState title="Page not found" hint="That link does not go anywhere we know." />
      <p style={{ textAlign: 'center' }}>
        <Link href="/" className="btn btn-primary">
          Back to home
        </Link>
      </p>
    </div>
  )
}
