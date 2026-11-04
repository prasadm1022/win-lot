// SPDX-License-Identifier: Apache-2.0
// The visitor-copy rules every render and built-page test checks (docs/MODEL-V2.md section 7.5 "Never use", plus the
// odds language the review findings banned). One list, imported everywhere; never copied into a test file.

/** Phrases that must not appear in any visitor-facing text (case-insensitive). */
export const FORBIDDEN: readonly RegExp[] = [
  /more likely/i,
  /better odds/i,
  /better chance/i,
  /\bbeats?\b/i,
  /lucky day/i,
  /\bdue\b/i,
  /overdue/i,
  /\bhot\b/i,
  /guarantee/i,
  /accuracy/i,
  /affinity/i,
  /jackpot-likeness/i,
];

/** The FORBIDDEN rules that `s` breaks, as their sources, for a readable assertion message. */
export const forbiddenHits = (s: string): string[] => FORBIDDEN.filter((re) => re.test(s)).map((re) => re.source);
