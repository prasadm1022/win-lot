// SPDX-License-Identifier: Apache-2.0
import type { CSSProperties } from 'react'
import { ZODIAC_GLYPH } from '../lib/lotteryMeta'
import { bonusText } from '../lib/format'

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
  reveal?: boolean
  /** Used as the aria description for the whole group */
  caption?: string
}

export function BallRow({ letter, numbers, bonus, bonusLabel, size = 'md', reveal = false, caption }: BallRowProps) {
  const b = bonusText(bonus)
  let i = 0
  const parts: string[] = []
  if (letter) parts.push(`letter ${letter}`)
  parts.push(`numbers ${numbers.join(', ')}`)
  if (b) parts.push(`${bonusLabel ?? 'bonus'} ${b}`)
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
          <Ball value={b} kind="bonus" size={size} index={i++} label={`${bonusLabel ?? 'Bonus'} ${b}`} />
        </>
      ) : null}
    </span>
  )
}
