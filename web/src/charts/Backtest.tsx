// SPDX-License-Identifier: Apache-2.0
import type { Prediction } from '../api/types'

export function Backtest({ backtest, mainCount }: { backtest: Prediction['backtest']; mainCount: number }) {
  const { draws, avgHits, randomBaseline } = backtest
  const max = Math.max(avgHits, randomBaseline, 0.01) * 1.25
  const delta = avgHits - randomBaseline
  const rel = randomBaseline ? delta / randomBaseline : 0
  const verdict =
    Math.abs(rel) < 0.05
      ? 'About the same as random — exactly what you expect from a fair lottery.'
      : rel > 0
        ? `Slightly above random in this sample (+${(rel * 100).toFixed(0)}%). Small edges like this are usually noise.`
        : `Slightly below random in this sample (${(rel * 100).toFixed(0)}%). Patterns do not persist in random draws.`
  return (
    <div className="backtest">
      <p className="small muted" style={{ margin: 0 }}>
        Walk-forward test over the last {draws} draws: average main-number hits out of {mainCount} per draw.
      </p>
      <div className="bars" role="list" aria-label="Backtest comparison">
        <div className="bar-row" role="listitem">
          <span>Model picks</span>
          <span className="track" aria-hidden="true">
            <span className="fill" style={{ width: `${(avgHits / max) * 100}%` }} />
          </span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{avgHits.toFixed(2)}</b>
        </div>
        <div className="bar-row baseline" role="listitem">
          <span>Random baseline</span>
          <span className="track" aria-hidden="true">
            <span className="fill" style={{ width: `${(randomBaseline / max) * 100}%` }} />
          </span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{randomBaseline.toFixed(2)}</b>
        </div>
      </div>
      <div className="verdict">{verdict}</div>
    </div>
  )
}
