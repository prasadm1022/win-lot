// SPDX-License-Identifier: Apache-2.0
import { Link } from 'react-router-dom'
import { EmptyState } from '../components/Notices'

export function NotFound() {
  return (
    <div className="card">
      <EmptyState title="Page not found" hint="That link does not go anywhere we know." />
      <p style={{ textAlign: 'center' }}>
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </p>
    </div>
  )
}
