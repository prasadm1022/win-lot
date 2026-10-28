// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react'

export const DISCLAIMER_TEXT =
  'Lottery draws are random. These picks are statistical patterns from past results, offered for entertainment only, and do not improve your odds. Please play responsibly.'

export function Disclaimer({ text, compact = false }: { text?: string; compact?: boolean }) {
  return (
    <div className={`notice notice-disclaimer${compact ? ' notice-compact' : ''}`} role="note">
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>
        <strong>For entertainment only.</strong> {text ?? DISCLAIMER_TEXT}
      </span>
    </div>
  )
}

export function ErrorNotice({
  message,
  onRetry,
  children,
}: {
  message: string
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <div className="notice notice-error" role="alert">
      <span className="notice-icon" aria-hidden="true">
        ×
      </span>
      <span style={{ flex: 1 }}>
        <strong>Could not load this section.</strong> {message}
        {children}
      </span>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state-empty">
      <div className="big" aria-hidden="true">
        ◌
      </div>
      <p style={{ margin: 0, color: 'var(--ink-2)', fontWeight: 600 }}>{title}</p>
      {hint ? <p className="small" style={{ margin: '4px 0 0' }}>{hint}</p> : null}
    </div>
  )
}
