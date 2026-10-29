// SPDX-License-Identifier: Apache-2.0
// Pure presentational balls; no hooks, so usable from server and client components.
import type { CSSProperties } from 'react'
import { ZODIAC_GLYPH } from './util/lotteryMeta'
import { bonusLabelOf, bonusText } from './util/format'

type Size = 'sm' | 'md' | 'lg' | 'xl'
type Kind = 'number' | 'letter' | 'bonus'

interface BallProps {
  value: string | number
  kind?: Kind
  size?: Size
  index?: number
  label?: string
}

const sizeClass: Record<Size, string> = { sm: 'ball-sm', md: '', lg: 'ball-lg', xl: 'ball-xl' }

export function Ball({ value, kind = 'number', size = 'md', index = 0, label }: BallProps) {
  const text = String(value)
  const glyph = ZODIAC_GLYPH[text]
  const cls = [
    'ball',
    sizeClass[size],
    kind === 'letter' ? 'ball-letter' : '',
    kind === 'bonus' ? 'ball-bonus' : '',
    // A multi-digit bonus (Dhana Nidhanaya Sunday Bonus "0603") is a pill, not a 2-character ball.
    kind === 'bonus' && text.length > 2 ? 'wide' : '',
    glyph ? 'ball-zodiac' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const style = { '--i': index } as CSSProperties
  return (
    <span
      className={cls}
      style={style}
      role="img"
      aria-label={label ?? (kind === 'letter' ? `Letter ${text}` : kind === 'bonus' ? `Bonus ${text}` : `Number ${text}`)}
      title={glyph ? text : undefined}
    >
      <span aria-hidden="true">{glyph ?? text}</span>
    </span>
  )
}

interface BallRowProps {
  letter?: string | null
  numbers: number[]
  bonus?: unknown
  bonusLabel?: string | null
  size?: Size
  /** Roll-in animation (CSS honours prefers-reduced-motion by itself). */
  reveal?: boolean
  /** Used as the aria description for the whole group */
  caption?: string
}

export function BallRow({ letter, numbers, bonus, bonusLabel, size = 'md', reveal = false, caption }: BallRowProps) {
  const b = bonusText(bonus)
  // A structured bonus carries its own label ("Sunday Bonus"); it is spoken once, here, never inside the ball text.
  const bLabel = bonusLabelOf(bonus) ?? bonusLabel
  let i = 0
  const parts: string[] = []
  if (letter) parts.push(`letter ${letter}`)
  parts.push(`numbers ${numbers.join(', ')}`)
  if (b) parts.push(`${bLabel ?? 'bonus'} ${b}`)
  return (
    <span className={`ball-row${reveal ? ' reveal' : ''}`} role="group" aria-label={caption ? `${caption}: ${parts.join('; ')}` : parts.join('; ')}>
      {letter ? <Ball value={letter} kind="letter" size={size} index={i++} /> : null}
      {numbers.map((n, k) => (
        <Ball key={`${n}-${k}`} value={n} size={size} index={i++} />
      ))}
      {b ? (
        <>
          <span className="ball-plus" aria-hidden="true">
            +
          </span>
          <Ball value={b} kind="bonus" size={size} index={i++} label={`${bLabel ?? 'Bonus'} ${b}`} />
        </>
      ) : null}
    </span>
  )
}
