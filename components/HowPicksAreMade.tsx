// SPDX-License-Identifier: Apache-2.0
// Server component: "How these picks are made" (docs/MODEL-V2.md 7.3): the headline split, the per-item rule, the
// damping sentence, status and notes, the pattern lean, and a collapsed "Show the maths" view. The previous model (v1)
// appears only inside its own collapsed details, under the heading "Previous model (v1)" (spec 7.5, decision D6).
// Payload texts (explanation, notes) are rendered as produced by the model; every split is printed through
// wholePercents, so the three numbers always add up to 100 and match the payload texts. Server only: model code never
// enters the client bundle.
import type { EvidenceSource, Lottery, Prediction, SourceSplit } from '@/lib/types'
import { wholePercents } from '@/lib/model-v2/explain'
import { BallRow } from './Ball'
import { SOURCE_LABEL } from './JackpotBadge'
import { v1BaselineNote } from './charts/Backtest'
import { LeanBars } from './charts/LeanBars'
import { PartsBar, SOURCE_NAME, SOURCE_ORDER } from './Picks'
import { fmtDate, fmtFixed, fmtInt, fmtPct } from './util/format'

const FEATURE_NAME: Record<'moonPhase' | 'dayOfMonth' | 'weekday', string> = {
  moonPhase: 'Moon phase (Poya)',
  dayOfMonth: 'Day of month',
  weekday: 'Weekday',
}

/** How a source stands in the number channel (spec 2.15): it moves the picks, or it is absent, silent or held back. */
type SourceState = 'active' | 'absent' | 'silent' | 'held'

/** [76, 77, 78, 79, 80, 5] -> "5, 76-80". */
function numberRanges(ns: readonly number[]): string {
  const s = [...ns].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < s.length; ) {
    let j = i
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++
    out.push(j > i ? `${s[i]}-${s[j]}` : `${s[i]}`)
    i = j + 1
  }
  return out.join(', ')
}

function SplitTable({ rows, caption, unit }: { rows: { name: string; split: SourceSplit | null }[]; caption: string; unit: 'share' | 'factor' }) {
  const present = rows.filter((r): r is { name: string; split: SourceSplit } => r.split !== null)
  if (!present.length) return null
  return (
    <div className="table-wrap">
      <table className="kv-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Channel</th>
            {SOURCE_ORDER.map((s) => (
              <th scope="col" key={s}>
                {SOURCE_NAME[s]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {present.map((r) => {
            const wp = unit === 'share' ? wholePercents(r.split) : null
            return (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                {SOURCE_ORDER.map((s) => (
                  <td key={s} className="num">
                    {wp ? `${wp[s]}%` : fmtFixed(r.split[s], 2)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface Props {
  prediction: Prediction
  lottery: Pick<Lottery, 'name' | 'letterKind' | 'bonusLabel' | 'mainMin'>
}

export function HowPicksAreMade({ prediction, lottery }: Props) {
  const p = prediction
  const ev = p.evidence
  const inf = p.influence
  const damp = p.damping
  const w = p.weights
  if (!ev || !inf || !damp || !w) {
    return (
      <section className="card" aria-labelledby="how-title">
        <h2 id="how-title">How these picks are made</h2>
        <p className="muted small">{p.method}</p>
      </section>
    )
  }

  const shares = inf.numbers
  const wp = wholePercents(shares)
  const c = ev.counts
  const dn = damp.numbers
  const letterWord = lottery.letterKind === 'zodiac' ? 'Zodiac sign' : 'Letter'
  // Own jackpot items in the data, usable yet or not (the jackpot list next to this panel shows them all).
  const winsKnown = c.jackpotDates.known + c.jackpotDates.undated

  const used: Record<EvidenceSource, number> = {
    jackpotCombinations: c.jackpotCombinations.used,
    jackpotDates: c.jackpotDates.used,
    dailyDraws: c.dailyDraws.used,
  }
  const stateOfSource = (s: EvidenceSource): SourceState => {
    if (used[s] === 0) return 'absent'
    if (dn[s] === 0) return 'held'
    return shares[s] > 0 ? 'active' : 'silent'
  }
  const sJ = stateOfSource('jackpotCombinations')
  const sT = stateOfSource('jackpotDates')
  const sD = stateOfSource('dailyDraws')

  // Per-source state: an absent source shows "0% - none known yet" (or "none can be used yet" while the jackpot list
  // next to it shows a win that is not usable yet: published too recently, or undated); its share is never redistributed.
  const stateOf = (s: EvidenceSource): { pct: string; why: string | null } => {
    const share = `${wp[s]}%`
    if (s === 'jackpotCombinations') {
      if (sJ === 'absent') return { pct: '0%', why: c.jackpotCombinations.known > 0 ? 'none can be used yet' : 'none known yet' }
      return sJ === 'active' ? { pct: share, why: null } : { pct: '0%', why: 'no pattern yet' }
    }
    if (s === 'jackpotDates') {
      if (sT === 'absent') return { pct: '0%', why: c.jackpotDates.known > 0 ? 'none can be used yet' : 'none known yet' }
      if (sT === 'held') return { pct: '0%', why: 'held back while the jackpot numbers show no pattern' }
      return sT === 'active' ? { pct: share, why: null } : { pct: '0%', why: 'no calendar pattern yet' }
    }
    if (sD === 'absent') return { pct: '0%', why: 'none yet' }
    // The payload's card note (lib/model-v2/explain.ts whyNot): the dates alone are silent, or the sources above are too.
    if (sD === 'held') {
      return { pct: '0%', why: sT === 'silent' ? 'held back while the dates show no pattern' : 'held back while the sources above them show no pattern' }
    }
    return sD === 'active' ? { pct: share, why: null } : { pct: '0%', why: 'no pattern yet' }
  }
  const describe: Record<EvidenceSource, string | undefined> = {
    jackpotCombinations: p.explanation?.combinations,
    jackpotDates: p.explanation?.dates,
    dailyDraws: p.explanation?.daily,
  }

  const headline = SOURCE_ORDER.map((s) => `${SOURCE_NAME[s]} ${wp[s]}%`).join(' · ')
  const rule = `Each jackpot combination counts like ${w.jackpotCombination} draws, each jackpot date like ${w.jackpotDate}, each daily draw like ${w.dailyDraw}.`

  // The order sentence mirrors the payload's `explanation.weights` (lib/model-v2/explain.ts), with the damping factor
  // added where a source is turned down; a held-back source uses the payload's own words.
  const damping: string[] = []
  if (sT === 'active' && dn.jackpotDates < 1) {
    damping.push(`Jackpot dates are turned down to ${Math.round(dn.jackpotDates * 100)}% of their pull so they never outweigh the combinations.`)
  }
  if (sT === 'held') damping.push('Jackpot dates are held back while the jackpot numbers show no pattern.')
  if (sD === 'active' && dn.dailyDraws < 1) {
    damping.push(
      `Daily draws are turned down to ${Math.round(dn.dailyDraws * 100)}% of their pull so they never outweigh the ${sT === 'absent' ? 'combinations' : 'dates'}.`,
    )
  }
  if (sD === 'held') {
    damping.push(
      sT === 'silent'
        ? 'Daily draws are held back while the dates show no pattern.'
        : 'Daily draws are held back while the sources above them show no pattern.',
    )
  }
  if (!damping.length) {
    damping.push(
      ev.status === 'none'
        ? `${winsKnown > 0 ? 'No jackpot win can be used yet' : 'No jackpot win is known yet'}, so there is nothing to keep in order: the daily draws are the only source.`
        : 'Nothing is turned down today.',
    )
  }

  const status = `Evidence known before ${fmtDate(ev.asOf)}: ${fmtInt(c.jackpotCombinations.used)} jackpot ${
    c.jackpotCombinations.used === 1 ? 'combination' : 'combinations'
  }, ${fmtInt(c.jackpotDates.used)} jackpot ${c.jackpotDates.used === 1 ? 'date' : 'dates'} and ${fmtInt(c.dailyDraws.used)} daily draws.`

  const guard = ev.guard
  const live = p.liveBalls
  const prev = p.previousModel
  const calendar = ev.calendar && ev.calendar.length ? ev.calendar : null
  const anyClear = calendar ? calendar.some((f) => f.holmP < 0.05) : false
  const splitRows = [
    { name: 'Numbers', split: inf.numbers },
    { name: `${letterWord}s`, split: inf.letters },
    { name: lottery.bonusLabel ?? 'Bonus', split: inf.bonus },
    { name: 'Odd count', split: inf.odd },
    { name: 'Spread', split: inf.spread },
  ]
  const dampRows = [
    { name: 'Numbers', split: damp.numbers },
    { name: `${letterWord}s`, split: damp.letters },
    { name: lottery.bonusLabel ?? 'Bonus', split: damp.bonus },
  ]

  return (
    <section className="card" aria-labelledby="how-title">
      <div className="card-head">
        <div>
          <p className="eyebrow">Method</p>
          <h2 id="how-title">How these picks are made</h2>
        </div>
        <p className="card-sub">Jackpot numbers first, then jackpot dates, then the daily draws</p>
      </div>

      <div className="how-grid">
        <div className="how-main">
          <p className="how-headline">{headline}</p>
          <PartsBar parts={shares} kind="share" label="Share of the pull on the numbers" />
          <ul className="src-list">
            {SOURCE_ORDER.map((s) => {
              const st = stateOf(s)
              return (
                <li key={s} className={`src src-${s}`}>
                  <div className="src-head">
                    <span className="src-name">
                      <i className={`sw sw-${s}`} aria-hidden="true" />
                      {SOURCE_NAME[s]}
                    </span>
                    <span className="src-pct">
                      {st.pct}
                      {st.why ? <span className="muted"> - {st.why}</span> : null}
                    </span>
                  </div>
                  {describe[s] ? <p className="src-why">{describe[s]}</p> : null}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="how-side">
          <p>
            <strong>The rule.</strong> {rule}
          </p>
          <p>
            <strong>Keeping the order.</strong> {damping.join(' ')}
          </p>
          <p>
            <strong>Today.</strong> {status}
          </p>
          {p.patternLean !== undefined ? (
            <p>
              <strong>Pattern lean:</strong> {fmtFixed(p.patternLean, 1)} out of 100 (0 = all numbers equal). This is not an advantage.
            </p>
          ) : null}
          {p.notes?.length ? (
            <ul className="notes">
              {p.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {p.explanation?.limits ? <p className="small muted">{p.explanation.limits}</p> : null}
        </div>
      </div>

      <details className="maths">
        <summary>Show the maths</summary>
        <div className="maths-body">
          <h3>Splits and damping</h3>
          <p className="small muted">
            Share of the pull per channel, and the damping factor each source gets (1 = not turned down). A lower source may pull at most{' '}
            {Math.round(w.orderRatio * 100)}% as hard as the one above it.
          </p>
          <div className="grid grid-2">
            <SplitTable rows={splitRows} caption="Share of the pull by channel" unit="share" />
            <SplitTable rows={dampRows} caption="Damping factor by channel" unit="factor" />
          </div>

          <h3>Calendar fit of the jackpot dates</h3>
          {calendar ? (
            <>
              <div className="table-wrap">
                <table className="kv-table">
                  <caption>
                    Calendar features fitted on this lottery&apos;s own {fmtInt(c.jackpotDates.used)} jackpot dates in {c.jackpotDates.clusters}{' '}
                    {c.jackpotDates.clusters === 1 ? 'group' : 'groups'} (dates within a week count as one)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Feature</th>
                      <th scope="col">Strength</th>
                      <th scope="col">Peak</th>
                      <th scope="col">Raw p</th>
                      <th scope="col">Holm p</th>
                    </tr>
                  </thead>
                  <tbody>
                    {calendar.map((f) => (
                      <tr key={f.feature}>
                        <th scope="row">{FEATURE_NAME[f.feature]}</th>
                        <td className="num">{f.strength === 0 ? 'off' : fmtFixed(f.strength, 2)}</td>
                        <td>{f.peak}</td>
                        <td className="num">{fmtFixed(f.rayleighP, 3)}</td>
                        <td className="num">{fmtFixed(f.holmP, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Where the dates bunch up, draws held on similar days count a little more; where they do not, the feature is switched off.{' '}
                {anyClear
                  ? 'This is most likely a ticket-sales effect: when more tickets are sold, a winning ticket is more often in someone’s hands.'
                  : `None of these is clear after allowing for ${calendar.length} checks (no Holm p below 0.05); if real, it would most likely be a ticket-sales effect: when more tickets are sold, a winning ticket is more often in someone’s hands.`}{' '}
                The balls do not know the date.
                {ev.calendarEss !== null ? ` Ordinary days compared against: ${fmtFixed(ev.calendarEss, 0)} (effective).` : ''}
              </p>
            </>
          ) : (
            <p className="small muted">
              {c.jackpotDates.known > 0
                ? `No jackpot date of ${lottery.name} can be used yet, so there is no calendar fit.`
                : `No jackpot dates are known for ${lottery.name}, so there is no calendar fit.`}
            </p>
          )}

          <h3>Pattern score per number</h3>
          {p.numberLean?.length ? (
            <LeanBars
              items={p.numberLean.map((x) => ({ key: String(x.n), lean: x.lean, j: x.j, t: x.t, d: x.d }))}
              noun="Number"
              title="Numbers"
              labelEvery={5}
              min={2 - w.maxLean}
              max={w.maxLean}
            />
          ) : (
            <p className="muted small">No number leans in this payload.</p>
          )}
          {p.letterLean?.length ? (
            <>
              <h3>Pattern score per {letterWord.toLowerCase()}</h3>
              <LeanBars
                items={p.letterLean.map((x) => ({ key: x.letter, lean: x.lean, j: x.j, t: x.t, d: x.d }))}
                noun={letterWord}
                title={`${letterWord}s`}
                labelEvery={1}
                min={2 - w.maxLean}
                max={w.maxLean}
              />
            </>
          ) : null}
          {p.bonusLean?.length ? (
            <>
              <h3>Pattern score per {lottery.bonusLabel ?? 'bonus'}</h3>
              <LeanBars
                items={p.bonusLean.map((x) => ({ key: String(x.n), lean: x.lean, j: x.j, t: x.t, d: x.d }))}
                noun={lottery.bonusLabel ?? 'Bonus'}
                title={lottery.bonusLabel ?? 'Bonus'}
                labelEvery={p.bonusLean.length > 30 ? 5 : 1}
                min={2 - w.maxLean}
                max={w.maxLean}
              />
            </>
          ) : null}
          {p.shapeLean?.length ? (
            <div className="grid grid-2">
              {p.shapeLean.map((f) => (
                <table className="kv-table" key={f.feature}>
                  <caption>{f.feature === 'odd' ? 'Odd count of a ticket' : 'Spread of a ticket (highest minus lowest)'}: pattern score</caption>
                  <thead>
                    <tr>
                      <th scope="col">Bin</th>
                      <th scope="col">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.bins.map((b) => (
                      <tr key={b.label}>
                        <th scope="row">{b.label}</th>
                        <td className="num">{fmtFixed(b.lean, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ))}
            </div>
          ) : null}

          <h3>Evidence used and pending</h3>
          {ev.used.length ? (
            <div className="table-wrap">
              <table className="kv-table">
                <caption>Jackpot evidence used for draw #{p.nextDrawNo} (known strictly before {fmtDate(ev.asOf)})</caption>
                <thead>
                  <tr>
                    <th scope="col">Draw</th>
                    <th scope="col">Date</th>
                    <th scope="col">Used as</th>
                    <th scope="col">Source</th>
                    <th scope="col">Known from</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.used.map((u) => (
                    <tr key={`${u.drawNo}-${u.kind}`}>
                      <td className="num">#{u.drawNo}</td>
                      <td>{u.date ? fmtDate(u.date) : 'date unknown'}</td>
                      <td>{u.kind === 'combination' ? 'combination + date' : 'date only'}</td>
                      <td>{SOURCE_LABEL[u.source]}</td>
                      <td>{fmtDate(u.knownFrom)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="small muted">
              {winsKnown > 0
                ? 'No jackpot evidence can be used yet: the picks rest on the daily draws.'
                : 'No jackpot evidence is used yet: the picks rest on the daily draws.'}
            </p>
          )}
          {ev.pending.length ? (
            <ul className="notes">
              {ev.pending.map((q) => (
                <li key={q.drawNo}>
                  Jackpot at draw #{q.drawNo}
                  {q.date ? ` (${fmtDate(q.date)})` : ''}:{' '}
                  {q.knownFrom ? `counts from ${fmtDate(q.knownFrom)}` : `counts once draw #${q.drawNo + 2} is published`}.
                </li>
              ))}
            </ul>
          ) : null}
          <p className="small muted">
            Daily draws used: {fmtInt(c.dailyDraws.used)} of {fmtInt(c.dailyDraws.total)} since {fmtDate(c.dailyDraws.since)}
            {c.dailyDraws.excludedAsJackpot ? ` (the ${c.dailyDraws.excludedAsJackpot} jackpot draws count as combinations, not as daily draws)` : ''}.
            Pseudo-draws spent before damping: combinations {fmtInt(ev.mass.jackpotCombinations)}, dates {fmtInt(ev.mass.jackpotDates)}, daily{' '}
            {fmtInt(ev.mass.dailyDraws)}.
          </p>

          <h3>Copy guard and balls in use</h3>
          <p className="small muted">
            Guard rung ({guard.perCombination}, {guard.union}): a card shares at most {guard.perCombination} number
            {guard.perCombination === 1 ? '' : 's'} with any one past jackpot and at most {guard.union} with all of them together
            {c.jackpotCombinations.used > 0
              ? `, which rules out at most ${fmtPct(guard.excludedShare, 1)} of all tickets (never more than 5%)`
              : '; it applies once jackpot combinations are known'}
            . No card repeats a past result.
            {live
              ? ` Balls in use: ${live.count}, judged on the draws since ${fmtDate(live.since)}${
                  live.excluded.length ? `; not in use: ${numberRanges(live.excluded)} (not drawn since then)` : ''
                }.`
              : ''}
          </p>

          <h3>Constants</h3>
          <p className="small muted">
            Model {p.modelVersion}. Weights: combination {w.jackpotCombination}, date {w.jackpotDate}, daily draw {w.dailyDraw}. Order ratio{' '}
            {w.orderRatio}. Lean bound {fmtFixed(2 - w.maxLean, 2)} to {fmtFixed(w.maxLean, 2)}. Average pseudo-jackpots added: {w.jackpotPrior}.
          </p>
          <p className="small muted">{p.method}</p>
        </div>
      </details>

      {prev ? (
        <details className="maths">
          <summary>Previous model (v1)</summary>
          <div className="maths-body">
            <p className="small muted">
              The previous model, {prev.modelVersion}, scored each number from its long-run frequency, its recent frequency and the gap since
              it was last drawn, then sampled sets from those scores. It is kept only for comparison; these are its picks for the same draw.
            </p>
            <div className="prev-sets">
              {prev.sets.map((s, i) => (
                <div key={i} className="prev-set">
                  <span className="prev-label">Set {i + 1}</span>
                  <BallRow letter={s.letter} numbers={s.numbers} bonus={s.bonus} bonusLabel={lottery.bonusLabel} size="sm" caption={`Previous model set ${i + 1}`} />
                </div>
              ))}
            </div>
            <p className="small muted">
              Over the same {fmtInt(prev.backtest.draws)} replayed draws v1 matched {fmtFixed(prev.backtest.avgHits, 4)} numbers per draw.{' '}
              {v1BaselineNote(prev, `${lottery.mainMin}-${live?.count ?? '?'}`)}
            </p>
          </div>
        </details>
      ) : null}
    </section>
  )
}
