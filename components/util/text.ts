// SPDX-License-Identifier: Apache-2.0
// Small sentence helpers for the guide pages (plain module: safe in server and client components).
import { fmtInt } from './format'

/** "a", "a and b", "a, b and c". */
export function listText(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** 0..10 as a word ("three"), larger counts as digits ("1,911"). */
export function countWord(n: number): string {
  return n >= 0 && n < WORDS.length && Number.isInteger(n) ? WORDS[n] : fmtInt(n)
}

/** "1 draw", "216 draws". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`
}

/** "48.2%" from a share (one decimal). */
export function pct1(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}
