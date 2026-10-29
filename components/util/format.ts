// SPDX-License-Identifier: Apache-2.0
// Formatting helpers shared by server and client components. Dates use a fixed month table (the same spelling as the
// model's payload texts, lib/model-v2/explain.ts: "Sep", never "Sept"), so the static HTML, the hydrated tree and the
// payload agree whatever ICU the build machine or the browser ships.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function parseDate(iso: string): Date {
  // YYYY-MM-DD is treated as UTC midnight (and formatted in UTC) so the build
  // machine's timezone never shifts the calendar day.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00Z`)
  return new Date(iso)
}

const two = (n: number) => String(n).padStart(2, '0')

/** "2026-10-28" -> "28 Oct 2026" (also accepts a full ISO date-time, read in UTC). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = parseDate(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "2026-10-28" -> "28 Oct". */
export function fmtDateShort(iso: string): string {
  const d = parseDate(iso)
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

/** "2026-03-27" -> "March 2026" (used where only the month matters, e.g. the start of an archive). */
export function fmtMonthYear(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = parseDate(iso)
  if (Number.isNaN(d.getTime())) return iso
  const long = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${long[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Date-times are shown in Sri Lanka time (the draws' own timezone): "27 Oct, 20:35". */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Colombo is UTC+5:30 with no DST, so the local wall clock is a fixed offset.
  const local = new Date(d.getTime() + 5.5 * 3_600_000)
  return `${local.getUTCDate()} ${MONTHS[local.getUTCMonth()]}, ${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`
}

export function fmtInt(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n)
}

export function fmtPct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`
}

/** 87804496 -> "Rs. 87,804,496"; 56553566.4 -> "Rs. 56,553,566.40" (locale independent, as published). */
export function fmtRupees(amount: number): string {
  const [whole, cents] = amount.toFixed(2).split('.')
  return `Rs. ${whole.replace(/\B(?=(\d{3})+$)/g, ',')}${cents === '00' ? '' : `.${cents}`}`
}

/** 93874580 -> "Rs. 93.9 M". */
export function fmtMillions(amount: number): string {
  return `Rs. ${(amount / 1e6).toFixed(1)} M`
}

/** "2017-04" -> "Apr 2017" (the month a publicity card was listed). */
export function fmtMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym)
  if (!m) return ym
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : ym
}

/** Fixed decimals without a "-0.00". */
export function fmtFixed(x: number, dp: number): string {
  const s = x.toFixed(dp)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}

/** Fixed decimals with an explicit sign ("+0.24", "-0.02", "0.00"). */
export function fmtSigned(x: number, dp: number): string {
  const s = fmtFixed(x, dp)
  return s.startsWith('-') || Number(s) === 0 ? s : `+${s}`
}

/**
 * The bonus as ball text. A Dhana Nidhanaya Sunday Bonus is stored as `{label: 'Sunday Bonus', digits: [0, 6, 0, 3]}`
 * and shows as its digits ("0603"); its label is spoken by the ball row, never repeated inside the ball.
 */
export function bonusText(bonus: unknown): string | null {
  if (bonus === null || bonus === undefined) return null
  if (typeof bonus === 'number' || typeof bonus === 'string') return String(bonus)
  if (Array.isArray(bonus)) return bonus.map(String).join(' ')
  if (typeof bonus === 'object') {
    const o = bonus as Record<string, unknown>
    if (Array.isArray(o.digits)) return o.digits.map(String).join('')
    return Object.values(o)
      .map(String)
      .join(' ')
  }
  return String(bonus)
}

/** The label of a structured bonus (`{label, digits}`), if it carries one. */
export function bonusLabelOf(bonus: unknown): string | null {
  if (bonus && typeof bonus === 'object' && typeof (bonus as Record<string, unknown>).label === 'string') {
    return (bonus as Record<string, string>).label
  }
  return null
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
