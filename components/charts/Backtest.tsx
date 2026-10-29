// SPDX-License-Identifier: Apache-2.0
// Server component: the honest walk-forward backtest (docs/MODEL-V2.md 5.4 and 7.4). The pooled result is the headline;
// every figure comes with its 95% range; the verdict, power, Holm and copy-tilt texts are the model's own. No lottery is
// ever coloured as "winning", and nothing is sorted by performance. Nothing here claims "not won" without data (7.1).
import type { BacktestDetail, Board, EvidenceSource, HitStat, JackpotStatus, Prediction } from '@/lib/types'
import { holmFirstCut } from '@/lib/model-v2/backtest'
import { Z95 } from '@/lib/model-v2/explain'
import { fmtDate, fmtFixed, fmtInt, fmtPct, fmtSigned } from '../util/format'
import { SOURCE_NAME } from '../Picks'

interface Props {
  detail: BacktestDetail
  previous: Prediction['previousModel'] | null
  /** Balls in use (prediction.liveBalls.count), for the v1 baseline annotation. */
  liveCount: number | null
  mainCount: number
  mainMin: number
  board: Board
  /** NLB prize rows with a winners count (JackpotStatus.checked): the draws whose jackpot outcome is a fact. */
  checked?: JackpotStatus['checked'] | null
}

type Tone = 'v2' | 'random' | 'v1'

/**
 * The pooled headline clause (spec 5.4, 8.1 item 8), judged like the payload's own verdicts: "the same as random"
 * exactly while |pooled z| <= 1.96 (the cut of the 95% ranges shown next to it). Beyond that the result is outside the
 * usual range of luck for one check; it stays unusual after allowing for the number of checks only if the pooled z
 * itself passes the first Holm cut over the headline family (holmAll.tests checks, the family power.pooledMdeShare
 * uses). holmAll.anySignificant is not used: it says whether one lottery's own check survives, not the pooled one. A
 * survivor is worded as the payload words one (most likely a rare fluke or a fault, never a way to win). Never
 * "better", "beats" or "edge", and never a promise of a follow-up.
 */
export function pooledVerdict(pooled: { z: number }, holmAll: BacktestDetail['holmAll']): string {
  if (Math.abs(pooled.z) <= Z95) return 'That is the same as random; the difference is luck.'
  if (holmAll && Math.abs(pooled.z) > holmFirstCut(holmAll.tests)) {
    return (
      `That stays outside the usual range of luck even after allowing for the ${holmAll.tests} checks made across the lotteries. ` +
      'Lottery draws are random, so it is most likely a rare fluke or a fault in the data or the method, not a way to win.'
    )
  }
  if (holmAll) {
    return (
      `That is outside the usual range of luck for one check, but ${holmAll.tests} checks are made across the lotteries, and a result ` +
      'like this turns up by luck now and then; allowing for that, it is within luck.'
    )
  }
  return 'That is outside the usual range of luck for one check, but lottery draws are random, so it is still most likely luck.'
}

/**
 * The pooled result in one plain sentence plus its verdict, e.g. "Across all 7 lotteries (1,334 draws) the Top pick
 * matched 0.2016 numbers per draw; a random ticket matches 0.2029. That is the same as random; the difference is luck."
 * Computed from the payload, so the About page and this panel never carry a hard-coded claim about the result.
 */
export function pooledHeadline(pooled: NonNullable<BacktestDetail['pooled']>, holmAll: BacktestDetail['holmAll']): string {
  return (
    `Across all ${pooled.lotteries} lotteries (${fmtInt(pooled.draws)} draws) the Top pick matched ${fmtFixed(pooled.v2.avgHits, 4)} numbers ` +
    `per draw; a random ticket matches ${fmtFixed(pooled.random.avgHits, 4)}. ${pooledVerdict(pooled, holmAll)}`
  )
}

/** True when the checked NLB prize rows cover the whole test window, so "no jackpot was won in it" is a fact. */
export function windowChecked(checked: JackpotStatus['checked'] | null | undefined, from: string | null, to: string | null): boolean {
  return !!(checked && checked.draws > 0 && checked.from && checked.to && from && to && checked.from <= from && checked.to >= to)
}

/** The v1 baseline annotation (7.4), worded as a correction only when the two values differ. */
export function v1BaselineNote(previous: NonNullable<Prediction['previousModel']>, range: string): string {
  const v1 = fmtFixed(previous.backtest.randomBaseline, 4)
  const honest = fmtFixed(previous.honestRandomBaseline, 4)
  return v1 !== honest
    ? `v1 used a baseline of ${v1}; the honest value for ${range} is ${honest}.`
    : `v1 used a baseline of ${v1}, which is also the honest value for ${range}.`
}

function IntervalRow({ label, stat, max, tone }: { label: string; stat: HitStat; max: number; tone: Tone }) {
  const pos = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`
  return (
    <div
      className={`bt-row bt-${tone}`}
      role="listitem"
      aria-label={`${label}: ${fmtFixed(stat.avgHits, 4)} numbers per draw, 95% range ${fmtFixed(stat.lo, 3)} to ${fmtFixed(stat.hi, 3)}`}
    >
      <span className="bt-label">{label}</span>
      <span className="bt-track" aria-hidden="true">
        <span className="bt-range" style={{ left: pos(stat.lo), width: `calc(${pos(stat.hi)} - ${pos(stat.lo)})` }} />
        <span className="bt-dot" style={{ left: pos(stat.avgHits) }} />
      </span>
      <span className="bt-val" aria-hidden="true">
        <b>{fmtFixed(stat.avgHits, 3)}</b>
        <span className="muted"> {fmtFixed(stat.lo, 2)} to {fmtFixed(stat.hi, 2)}</span>
      </span>
    </div>
  )
}

export function Backtest({ detail, previous, liveCount, mainCount, mainMin, board, checked = null }: Props) {
  const d = detail
  if (d.draws === 0) {
    return <p className="muted small">There are too few draws to replay the picks against past results yet.</p>
  }
  const pooled = d.pooled
  const rows: { label: string; stat: HitStat; tone: Tone }[] = [
    { label: 'This model (v2)', stat: d.v2, tone: 'v2' },
    { label: 'Random ticket', stat: d.random, tone: 'random' },
    { label: 'Previous model (v1)', stat: d.v1, tone: 'v1' },
  ]
  const pooledRows: { label: string; stat: HitStat; tone: Tone }[] | null = pooled
    ? [
        { label: 'This model (v2)', stat: pooled.v2, tone: 'v2' },
        { label: 'Random ticket', stat: pooled.random, tone: 'random' },
        { label: 'Previous model (v1)', stat: pooled.v1, tone: 'v1' },
      ]
    : null
  const max = Math.max(...rows.map((r) => r.stat.hi), ...(pooledRows ?? []).map((r) => r.stat.hi), 0.01) * 1.08
  const range = liveCount !== null ? `${mainMin}-${liveCount}` : 'the balls in use'
  const v1note = previous ? v1BaselineNote(previous, range) : null
  const jackpotLine = d.jackpotDrawHits.length
    ? `Hits on the known jackpot draws inside this window: ${d.jackpotDrawHits
        .map((h) => `#${h.drawNo} (${fmtDate(h.date)}): ${h.hits} ${h.hits === 1 ? 'hit' : 'hits'}`)
        .join(' · ')}. Descriptive only.`
    : windowChecked(checked, d.from, d.to)
      ? 'No jackpot was won inside this test window.'
      : board === 'DLB'
        ? 'No jackpot win inside this test window is known (DLB publishes no winners list).'
        : 'No jackpot win inside this test window is known (not every draw in it could be checked).'

  return (
    <div className="backtest">
      {pooled && pooledRows ? (
        <div className="bt-block bt-pooled">
          <p className="bt-headline">
            Across all {pooled.lotteries} lotteries ({fmtInt(pooled.draws)} draws) the Top pick matched <b>{fmtFixed(pooled.v2.avgHits, 4)}</b> numbers
            per draw; a random ticket matches <b>{fmtFixed(pooled.random.avgHits, 4)}</b>. {pooledVerdict(pooled, d.holmAll)}
          </p>
          <div className="bt-rows" role="list" aria-label="All lotteries pooled: mean main-number hits per draw with 95% ranges">
            {pooledRows.map((r) => (
              <IntervalRow key={r.label} label={r.label} stat={r.stat} max={max} tone={r.tone} />
            ))}
          </div>
        </div>
      ) : null}

      <div className="bt-block">
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          This lottery: the last {d.draws} draws ({fmtDate(d.from)} to {fmtDate(d.to)}) replayed one by one, each time using only what was known
          before that draw. Mean main-number hits out of {mainCount} per draw. Each bar is the 95% range around that average; the Random
          ticket bar is where luck alone lands.
        </p>
        <div className="bt-rows" role="list" aria-label="This lottery: mean main-number hits per draw with 95% ranges">
          {rows.map((r) => (
            <IntervalRow key={r.label} label={r.label} stat={r.stat} max={max} tone={r.tone} />
          ))}
        </div>
        <div className="bt-axis" aria-hidden="true">
          <span>0</span>
          <span>{fmtFixed(max, 2)} hits per draw</span>
        </div>
      </div>

      <div className="verdict">{d.text.verdict}</div>
      <ul className="notes">
        <li>{d.text.power}</li>
        {d.text.holm ? <li>{d.text.holm}</li> : null}
        {d.text.copyTilt ? <li>{d.text.copyTilt}</li> : null}
        <li>{jackpotLine}</li>
        {v1note ? <li>{v1note}</li> : null}
      </ul>

      <details className="maths">
        <summary>Show the maths</summary>
        <dl className="kv">
          <dt>v2 vs random</dt>
          <dd>
            z = {fmtSigned(d.z, 2)}; difference {fmtSigned(d.v2.avgHits - d.random.avgHits, 4)} (95% range {fmtSigned(d.ci95[0], 3)} to{' '}
            {fmtSigned(d.ci95[1], 3)})
          </dd>
          <dt>v2 vs v1 (paired, same draws)</dt>
          <dd>
            difference {fmtSigned(d.v1.pairedDiff, 4)}; z = {fmtSigned(d.v1.pairedZ, 2)}
          </dd>
          <dt>Position of the drawn numbers in the pattern ranking</dt>
          <dd>
            mean position {fmtFixed(d.rank.pct, 3)} (0 = top of the ranking, 1 = bottom; chance 0.500); z = {fmtSigned(d.rank.z, 2)} (below 0 =
            the drawn numbers sat higher in the ranking than chance)
          </dd>
          <dt>Ball log-score vs uniform</dt>
          <dd>{fmtSigned(d.logScoreNats, 4)} nats (at most 0 is expected under fair draws)</dd>
          {d.letter ? (
            <>
              <dt>Letter hit rate</dt>
              <dd>
                {fmtPct(d.letter.hitRate, 1)} vs chance {fmtPct(d.letter.chance, 1)}
              </dd>
            </>
          ) : null}
          {d.bonus ? (
            <>
              <dt>Bonus hit rate</dt>
              <dd>
                {fmtPct(d.bonus.hitRate, 1)} vs chance {fmtPct(d.bonus.chance, 1)}
              </dd>
            </>
          ) : null}
          <dt>Lifts</dt>
          <dd>
            past jackpot numbers{' '}
            {d.lifts.jackpotNumbersZ !== null
              ? `z = ${fmtSigned(d.lifts.jackpotNumbersZ, 2)}`
              : d.copyTilt
                ? 'too few draws to judge yet' // combinations were used, but the check is not formed yet (spec 5.2)
                : 'n/a'}
            {Object.entries(d.lifts.sourceZ).length
              ? `; per source ${Object.entries(d.lifts.sourceZ)
                  .map(([k, v]) => `${SOURCE_NAME[k as EvidenceSource] ?? k} z = ${fmtSigned(v as number, 2)}`)
                  .join(', ')}`
              : ''}
          </dd>
          {d.copyTilt ? (
            <>
              <dt>Copy tilt</dt>
              <dd>
                {d.copyTilt.steps} steps; Top pick held {fmtFixed(d.copyTilt.avgPastJackpotNumbers, 3)} past-jackpot numbers on average vs{' '}
                {fmtFixed(d.copyTilt.random, 3)} for a random ticket; at most {d.copyTilt.maxSharedWithOne} with one jackpot and{' '}
                {d.copyTilt.maxFromUnion} from all of them
              </dd>
            </>
          ) : null}
          <dt>Order of the sources in the Top pick</dt>
          <dd>
            held in {d.orderHeld.held} of {d.orderHeld.steps} steps; the order filter changed the pick {d.orderHeld.filterChanged} times
          </dd>
          <dt>Out of domain</dt>
          <dd>{d.outOfDomain} test draws contained a number outside the balls in use</dd>
          <dt>Multiple checks (Holm)</dt>
          <dd>
            this lottery: {d.holm.tests} tests, smallest p {fmtFixed(d.holm.minP, 3)}, {d.holm.anySignificant ? 'one survives' : 'none survives'}
            {d.holmAll
              ? `; the 7 headline tests: smallest p ${fmtFixed(d.holmAll.minP, 3)}, ${d.holmAll.anySignificant ? 'one survives' : 'none survives'}`
              : ''}
          </dd>
          <dt>Power</dt>
          <dd>
            {/* The payload's own figures under their own name; what they mean is the payload's power sentence in the notes above */}
            minimum detectable effect: about +{Math.round(d.power.mdeShare * 100)}% of the baseline
            {d.power.pooledMdeShare !== null ? ` here, about +${Math.round(d.power.pooledMdeShare * 100)}% pooled` : ''}
          </dd>
          {pooled ? (
            <>
              <dt>Pooled</dt>
              <dd>
                z = {fmtSigned(pooled.z, 2)} vs random; paired z vs v1 = {fmtSigned(pooled.pairedZ, 2)}; rank z = {fmtSigned(pooled.rankZ, 2)}
              </dd>
            </>
          ) : null}
        </dl>
      </details>
    </div>
  )
}
