// SPDX-License-Identifier: Apache-2.0
// Formatting helpers shared by server and client components. All formatters are
// locale-fixed (en-GB) so the static HTML and the hydrated tree agree.
const DATE_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const DATE_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const DATETIME_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
})

export function parseDate(iso: string): Date {
  // YYYY-MM-DD is treated as UTC midnight (and formatted in UTC) so the build
  // machine's timezone never shifts the calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00Z`)
  return new Date(iso)
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = parseDate(iso)
  return Number.isNaN(d.getTime()) ? iso : DATE_FMT.format(d)
}

export function fmtDateShort(iso: string): string {
  const d = parseDate(iso)
  return Number.isNaN(d.getTime()) ? iso : DATE_SHORT.format(d)
}

/** Date-times are shown in Sri Lanka time (the draws' own timezone). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : DATETIME_FMT.format(d)
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n)
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`
}

export function bonusText(bonus: unknown): string | null {
  if (bonus === null || bonus === undefined) return null
  if (typeof bonus === 'number' || typeof bonus === 'string') return String(bonus)
  if (Array.isArray(bonus)) return bonus.map(String).join(' ')
  if (typeof bonus === 'object') {
    return Object.values(bonus as Record<string, unknown>)
      .map(String)
      .join(' ')
  }
  return String(bonus)
}

/** Draw time used for the countdown: 20:00 Asia/Colombo on the draw date. */
export function drawInstant(dateIso: string): Date {
  // Colombo is UTC+5:30 with no DST, so 20:00 local == 14:30 UTC.
  return new Date(`${dateIso}T14:30:00Z`)
}

/** Days between a YYYY-MM-DD date and now (fractional). */
export function daysSince(dateIso: string, now = Date.now()): number {
  return (now - parseDate(dateIso).getTime()) / 86_400_000
}
