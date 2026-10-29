// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react'

/**
 * The one disclaimer of the site, word for word the DISCLAIMER of lib/model.ts (the payload's `prediction.disclaimer`),
 * so the picks panel, the page bottoms, the home page and the about page all show the same sentence. It is mirrored
 * here instead of imported because this file is part of the client bundle (HistoryTable) and must not pull in model
 * code; test/ui.test.ts checks the two strings are identical.
 */
export const DISCLAIMER_TEXT =
  'Lottery draws are random and every combination is equally likely. These picks are a statistical curiosity for entertainment only; they do not improve your odds. Please play responsibly.'

export function Disclaimer({ text, compact = false, id }: { text?: string; compact?: boolean; id?: string }) {
  return (
    <div className={`notice notice-disclaimer${compact ? ' notice-compact' : ''}`} role="note" id={id}>
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>
        <strong>For entertainment only.</strong> {text ?? DISCLAIMER_TEXT}
      </span>
    </div>
  )
}

export function WarnNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice-warn" role="status">
      <span className="notice-icon" aria-hidden="true">
        !
      </span>
      <span>{children}</span>
    </div>
  )
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice-error" role="alert">
      <span className="notice-icon" aria-hidden="true">
        ×
      </span>
      <span style={{ flex: 1 }}>
        <strong>Could not load this section.</strong> {message}
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
      {hint ? (
        <p className="small" style={{ margin: '4px 0 0' }}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
