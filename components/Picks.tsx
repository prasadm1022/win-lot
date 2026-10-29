// SPDX-License-Identifier: Apache-2.0
// Server components for the v2 picks panel (docs/MODEL-V2.md 7.3): the five cards, the shared parts bar, the odds line
// and the disclaimer. No score number and no score bar: a score would read as a rating, and every ticket has the same
// chance. Card titles and one-line reasons come from the payload (set.label, set.note) and are rendered as they are.
// Server only: wholePercents (model code) never enters the client bundle.
import type { EvidenceSource, Lottery, Prediction, SourceSplit } from '@/lib/types'
import { wholePercents } from '@/lib/model-v2/explain'
import { BallRow } from './Ball'
import { Disclaimer } from './Notices'
import { fmtInt, fmtSigned } from './util/format'

export const SOURCE_ORDER: EvidenceSource[] = ['jackpotCombinations', 'jackpotDates', 'dailyDraws']
export const SOURCE_NAME: Record<EvidenceSource, string> = {
  jackpotCombinations: 'Jackpot combinations',
  jackpotDates: 'Jackpot dates',
  dailyDraws: 'Daily draws',
}

/** The longest pull fills this much of a points bar, so no card bar ever reads as "100%" (shares do fill the track). */
const POINTS_FILL = 90

/** Sum of the positive parts (the pull a card actually shows as width). */
export function positivePull(parts: SourceSplit): number {
  return SOURCE_ORDER.reduce((acc, s) => acc + Math.max(0, parts[s]), 0)
}

interface BarProps {
  parts: SourceSplit
  /** 'share': values are shares that sum to 1 (widths add up to 100%). 'points': pattern points, scaled to `scale`. */
  kind: 'share' | 'points'
  scale?: number
  /** Prefix for the accessible label, e.g. "Top pick". */
  label?: string
}

/**
 * Three-segment bar "Jackpot combinations / Jackpot dates / Daily draws". Values are always shown as text next to the
 * bar and in the aria-label; a negative part gets 0 width and keeps its value in the text. Shares are printed in whole
 * percents that add up to 100 (wholePercents, the same numbers as the payload texts); points carry their unit ("pts").
 */
export function PartsBar({ parts, kind, scale = 1, label }: BarProps) {
  const wp = kind === 'share' ? wholePercents(parts) : null
  const text = (s: EvidenceSource) => (wp ? `${wp[s]}%` : `${fmtSigned(parts[s], 2)} pts`)
  const width = (s: EvidenceSource) => (wp ? wp[s] : scale > 0 ? (Math.max(0, parts[s]) / scale) * POINTS_FILL : 0)
  const spoken = SOURCE_ORDER.map((s) =>
    wp ? `${SOURCE_NAME[s]} ${wp[s]} percent` : `${SOURCE_NAME[s]} ${fmtSigned(parts[s], 2)} pattern points`,
  ).join(', ')
  return (
    <div className={`parts parts-${kind}`}>
      <div className="parts-bar" role="img" aria-label={`${label ? `${label}: ` : ''}${spoken}`}>
        {SOURCE_ORDER.map((s) => (
          <span key={s} className={`seg seg-${s}`} style={{ width: `${width(s)}%` }} />
        ))}
      </div>
      <dl className="parts-values" aria-hidden="true">
        {SOURCE_ORDER.map((s) => (
          <div key={s}>
            <dt>
              <i className={`sw sw-${s}`} />
              {SOURCE_NAME[s]}
            </dt>
            <dd>{text(s)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * The odds line when the payload carries no `explanation.odds` (the same shape as lib/model-v2/explain.ts oddsText):
 * it names the balls in use where some are out of use, since the odds are counted on them.
 */
export function oddsFallback(odds: Prediction['odds'], live: Prediction['liveBalls'] | null = null): string | null {
  if (!odds) return null
  const extra = [
    ...(live && live.excluded.length ? [`${live.count} balls in use`] : []),
    ...(odds.numbersAndLetter !== null ? [`1 in ${fmtInt(odds.numbersAndLetter)} with the letter`] : []),
  ]
  return `Every ticket has the same chance: 1 in ${fmtInt(odds.numbers)} for the four numbers${extra.length ? ` (${extra.join('; ')})` : ''}.`
}

interface CardsProps {
  prediction: Prediction
  lottery: Pick<Lottery, 'name' | 'bonusLabel'>
}

/** The five cards in payload order (Top pick, Jackpot pattern, Jackpot days, Daily draws, Lucky dip). */
export function PickCards({ prediction, lottery }: CardsProps) {
  const sets = prediction.sets
  const scale = Math.max(1e-9, ...sets.map((s) => (s.parts ? positivePull(s.parts) : 0)))
  const perCombination = prediction.evidence?.guard.perCombination ?? 1
  const odds = prediction.explanation?.odds ?? oddsFallback(prediction.odds, prediction.liveBalls ?? null)
  const anyParts = sets.some((s) => s.parts)

  return (
    <div className="picks">
      {anyParts ? (
        <p className="picks-legend small muted" id="picks-legend">
          Bars: how far each source pulls that ticket, in pattern points (pts), not chances; a value below 0 pulls away from it.
        </p>
      ) : null}
      <div className="pick-cards" role="list" aria-describedby="picks-disclaimer">
        {sets.map((s, i) => {
          const past = s.pastJackpotNumbers ?? 0
          return (
            <article key={`${s.label}-${i}`} role="listitem" className={`pick-card${i === 0 ? ' lead' : ''}`} aria-labelledby={`pick-${i}`}>
              <div className="pick-head">
                <h3 id={`pick-${i}`} className="pick-title">
                  {i === 0 ? (
                    <span className="pick-star" aria-hidden="true">
                      ★
                    </span>
                  ) : null}
                  {s.label}
                </h3>
                {s.note ? <p className="pick-why">{s.note}</p> : null}
              </div>
              <BallRow letter={s.letter} numbers={s.numbers} bonus={s.bonus} bonusLabel={lottery.bonusLabel} reveal caption={s.label} />
              {s.parts ? <PartsBar parts={s.parts} kind="points" scale={scale} label={s.label} /> : null}
              {past > 0 ? (
                <p className="pick-note small">
                  Contains {past} number{past === 1 ? '' : 's'} from {past === 1 ? 'a past jackpot' : 'past jackpots'}, never {perCombination + 1} from the
                  same one
                </p>
              ) : null}
            </article>
          )
        })}
      </div>
      {odds ? (
        <p className="odds-line" role="note">
          {odds}
        </p>
      ) : null}
      <Disclaimer compact id="picks-disclaimer" text={prediction.disclaimer} />
    </div>
  )
}
