// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getLotteries, getPrediction } from '@/lib/data'
import { ARTICLE_BY_SLUG, articlePath } from '@/lib/articles'
import { wholePercents } from '@/lib/model-v2/explain'
import { pageMetadata } from '@/lib/seo'
import type { Lottery, Prediction } from '@/lib/types'
import { ArticleLayout, newestDrawDate } from '@/components/ArticleLayout'
import { pooledHeadline } from '@/components/charts/Backtest'
import { fmtDate, fmtFixed, fmtInt, fmtSigned } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'
import { countWord, listText, plural } from '@/components/util/text'

const META = ARTICLE_BY_SLUG['how-winlot-makes-its-picks']

export const metadata: Metadata = pageMetadata({ title: META.title, description: META.description, path: articlePath(META.slug) })

function safePrediction(id: string): Prediction | null {
  try {
    return getPrediction(id)
  } catch {
    return null
  }
}

/** "the same as random" exactly when the 95% range of the difference contains 0 (the cut of the verdicts, lesson L11). */
function rangeVerdict(ci95: [number, number]): string {
  return ci95[0] <= 0 && ci95[1] >= 0 ? 'the same as random' : 'outside the usual range of luck for one check'
}

const STATUS_TEXT: Record<string, string> = {
  combinations: 'jackpot combinations, jackpot dates and daily draws',
  'dates-only': 'jackpot dates and daily draws',
  none: 'daily draws only',
}

export default function HowWinLotMakesPicksPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id))
  const items = lotteries
    .map((l) => ({ l, p: safePrediction(l.id) }))
    .filter((x): x is { l: Lottery; p: Prediction } => x.p !== null && x.p.backtestDetail !== undefined)
  const first = items[0]?.p
  const w = first?.weights
  const pooled = items.map((x) => x.p.backtestDetail!).find((d) => d.pooled)
  const guard = first?.evidence?.guard
  const maxExcluded = Math.max(0, ...items.map((x) => x.p.evidence?.guard.excludedShare ?? 0))
  const byStatus = (s: string) => items.filter((x) => x.p.evidence?.status === s).map((x) => x.l.name)
  const retired = items.filter((x) => (x.p.liveBalls?.excluded.length ?? 0) > 0)
  const labels = first?.sets.map((s) => s.label) ?? []
  const inside = items.filter((x) => rangeVerdict(x.p.backtestDetail!.ci95) === 'the same as random').length
  const dataTo = newestDrawDate(lotteries, META.published)

  return (
    <ArticleLayout
      meta={META}
      dataTo={dataTo}
      lede="WinLot publishes five picks for the next draw of every lottery. They are for fun: no method can foresee a random draw. This article explains, step by step, what goes into the picks, which rules they must follow, and how WinLot checks them against a random ticket in the open, with the figures from the latest build."
    >
      <h2>Step 1: start from fair balls</h2>
      <p>
        Every pick starts from the assumption that each ball in the machine is equally likely to come out. Only balls that are
        actually in use count: a ball that has not come out for about 270 draws is treated as no longer in the machine.
        {retired.length
          ? ` Today that leaves out ${listText(retired.map((x) => `${listText(x.p.liveBalls!.excluded.map(String))} in ${x.l.name}`))}.`
          : ' Today every printed number of every lottery is in use.'}{' '}
        Everything that follows can only lean a little away from this fair start; it can never move far from it.
      </p>

      <h2>Step 2: three kinds of evidence, in a fixed order</h2>
      {w ? (
        <p>
          The picks weigh three kinds of history, and the owner of WinLot fixed their order in advance: a combination that won a
          jackpot counts like {fmtInt(w.jackpotCombination)} ordinary draws, the date of a jackpot win counts like{' '}
          {fmtInt(w.jackpotDate)}, and an ordinary daily draw counts as {fmtInt(w.dailyDraw)}. The order is enforced in the
          result, not only in the weights: a lower kind of evidence may never pull more than{' '}
          {fmtFixed(w.orderRatio * 100, 0)}% as hard as the one above it, and if a higher kind is missing, the lower ones are held
          back too.
        </p>
      ) : null}
      <ul>
        <li>
          <strong>Jackpot combinations</strong> are not treated as lucky numbers; a handful of wins is far too few for that.
          The picks learn only what they have in common: which tens their numbers fall in, how many are odd, how spread out they
          are, and their letter{w ? `, with ${countWord(w.jackpotPrior)} imaginary average jackpots counted alongside so that one win cannot swing the pattern` : ''}.
        </li>
        <li>
          <strong>Jackpot dates</strong> are checked for bunching on the calendar: moon phase, day of the month and weekday.
          Where the dates bunch up, draws held on similar days count a little more; where they do not, that feature switches
          itself off.
        </li>
        <li>
          <strong>Daily draws</strong> add the recent history, turned down so they never outweigh the jackpot evidence.
        </li>
      </ul>
      <p>
        Not every lottery has every kind of evidence. A jackpot is usable only once it was public before the draw being picked,
        and only the lottery&apos;s own jackpots count. Today the picks use{' '}
        {listText(
          (['combinations', 'dates-only', 'none'] as const)
            .filter((s) => byStatus(s).length > 0)
            .map((s) => `${STATUS_TEXT[s]} for ${listText(byStatus(s))}`),
        )}
        .
      </p>
      <ul>
        {items.map(({ l, p }) => {
          const split = p.influence ? wholePercents(p.influence.numbers) : null
          return split ? (
            <li key={l.id}>
              {l.name}: jackpot combinations {split.jackpotCombinations}%, jackpot dates {split.jackpotDates}%, daily draws{' '}
              {split.dailyDraws}% of the pull on the numbers
            </li>
          ) : null
        })}
      </ul>

      <h2>Step 3: rules every pick must follow</h2>
      <p>
        {guard
          ? `No pick copies a past jackpot: today a pick may share at most ${countWord(guard.perCombination)} number${guard.perCombination === 1 ? '' : 's'} with any one past jackpot of its lottery and at most ${countWord(guard.union)} with all of them together. `
          : ''}
        The limit is set so that it never rules out more than 5% of all possible tickets
        {items.length ? `; today it rules out at most ${fmtFixed(maxExcluded * 100, 1)}%` : ''}. A pick must also look like an
        ordinary draw (a usual mix of odd and even numbers and a usual spread) and may not repeat a past result.
      </p>
      <p>
        {labels.length
          ? `Each lottery gets ${countWord(labels.length)} cards: ${listText(labels)}.`
          : 'Each lottery gets five cards.'}{' '}
        The Top pick uses all the evidence; the next three each follow one kind of evidence, or, while that kind cannot move the
        picks, give a clearly different balanced pick; the last is a random ticket that follows the same rules, shown on purpose
        as a fair comparison. Apart from that last card, the picks are deterministic: the same history always gives the same
        picks.
      </p>

      <h2>Step 4: the check</h2>
      <p>
        A method like this is easy to fool yourself with, so WinLot tests it in the open with a walk-forward backtest. It goes
        back to an earlier draw, makes the Top pick using only what was known before that draw, compares it with the actual
        result, and moves forward one draw at a time. The number that matters is how many main numbers the Top pick matched per
        draw, next to what a random ticket matches on average. Each figure comes with its 95% range, the band in which luck alone
        puts it 95 times in 100.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Walk-forward backtest of the Top pick per lottery</caption>
          <thead>
            <tr>
              <th scope="col">Lottery</th>
              <th scope="col">Draws tested</th>
              <th scope="col">Top pick</th>
              <th scope="col">Random ticket</th>
              <th scope="col">95% range of the difference</th>
              <th scope="col">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {items.map(({ l, p }) => {
              const d = p.backtestDetail!
              return (
                <tr key={l.id}>
                  <td>
                    <Link href={`/l/${l.id}`}>{l.name}</Link>
                  </td>
                  <td className="num">
                    {fmtInt(d.draws)}
                    {d.from && d.to ? ` (${fmtDate(d.from)} to ${fmtDate(d.to)})` : ''}
                  </td>
                  <td className="num">{fmtFixed(d.v2.avgHits, 3)}</td>
                  <td className="num">{fmtFixed(d.random.avgHits, 3)}</td>
                  <td className="num">
                    {fmtSigned(d.ci95[0], 3)} to {fmtSigned(d.ci95[1], 3)}
                  </td>
                  <td>{rangeVerdict(d.ci95)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p>
        {inside === items.length
          ? `For all ${countWord(items.length)} lotteries the 95% range of the difference includes zero, so each result is the same as random.`
          : `For ${countWord(inside)} of the ${countWord(items.length)} lotteries the 95% range of the difference includes zero. With ${countWord(items.length)} lotteries checked, one or two landing outside their range by luck is to be expected; the lottery pages say how each one stands once that is allowed for.`}{' '}
        Single lotteries swing both ways, which is why the headline is never the best single lottery but the pooled result over
        all of them:
      </p>
      {pooled?.pooled ? <p className="article-callout">{pooledHeadline(pooled.pooled, pooled.holmAll)}</p> : null}
      {pooled?.power.pooledMdeShare !== null && pooled?.power.pooledMdeShare !== undefined ? (
        <p>
          How sensitive is this check? Over {plural(pooled.pooled?.draws ?? 0, 'draw')} it would notice a real gain of about{' '}
          {fmtFixed(pooled.power.pooledMdeShare * 100, 0)}% over a random ticket in 4 cases out of 5. A smaller gain could hide in
          the noise, so the honest reading is that the picks show no sign of doing anything a random ticket does not.
        </p>
      ) : null}

      <h2>What this means for you</h2>
      <p>
        The result is what probability says it should be. Draws are random, every combination of letter and numbers has the
        same chance in every draw, and leaning toward the patterns of past winning tickets cannot change that. It may even mean
        sharing a prize with other players who lean the same way. WinLot shows the picks because turning the history into a
        ticket is an interesting puzzle, and it shows the check so that nobody mistakes the puzzle for a forecast. The full
        method, with the data status and every rule, is on <Link href="/about">How it works</Link>; each lottery page shows its
        own picks, evidence and backtest. For why counting past numbers does not help either, read{' '}
        <Link href="/guides/number-frequency-and-gaps">number frequency and long gaps</Link>.
      </p>
    </ArticleLayout>
  )
}
