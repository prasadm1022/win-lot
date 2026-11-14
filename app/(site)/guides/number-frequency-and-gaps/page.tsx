// SPDX-License-Identifier: Apache-2.0
import type { Metadata } from 'next'
import Link from 'next/link'
import { getDraws, getLotteries } from '@/lib/data'
import { ARTICLE_BY_SLUG, articlePath } from '@/lib/articles'
import {
  GAP_BUCKETS,
  frequencySpread,
  gapCheck,
  gapInRange,
  liveNumbers,
  longestGap,
  overlapInRange,
  RETIRED_AFTER,
  stableWindow,
  topOverlap,
} from '@/lib/insights'
import { pageMetadata } from '@/lib/seo'
import { ArticleLayout, newestDrawDate } from '@/components/ArticleLayout'
import { fmtDate, fmtFixed, fmtInt } from '@/components/util/format'
import { orderIndex } from '@/components/util/lotteryMeta'
import { countWord, listText, pct1, plural } from '@/components/util/text'

const META = ARTICLE_BY_SLUG['number-frequency-and-gaps']

export const metadata: Metadata = pageMetadata({ title: META.title, description: META.description, path: articlePath(META.slug) })

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())

export default function NumberFrequencyPage() {
  const lotteries = [...getLotteries()].sort((a, b) => orderIndex(a.id) - orderIndex(b.id)).filter((l) => l.drawCount > 0)
  const per = lotteries.map((l) => {
    const all = getDraws(l.id)
    const live = liveNumbers(all, l.mainMin, l.mainMax)
    const window = stableWindow(all, live)
    const range = l.mainMax - l.mainMin + 1
    return {
      l,
      all,
      live,
      window,
      retired: Array.from({ length: range }, (_, i) => l.mainMin + i).filter((n) => !live.includes(n)),
      spread: frequencySpread(window.draws, live),
      overlap: topOverlap(window.draws, live),
      gap: longestGap(window.draws, live),
    }
  })
  const withSpread = per.filter((p) => p.spread !== null)
  // The worked example: the lottery with the most draws counted.
  const example = [...withSpread].sort((a, b) => b.spread!.draws - a.spread!.draws)[0]
  const gaps = gapCheck(per.map((p) => ({ draws: p.window.draws, live: p.live })))
  const groupsIn = gaps.filter(gapInRange).length
  const groupsUsed = gaps.filter((g) => g.trials > 0).length
  const totalTrials = gaps.reduce((s, g) => s + g.trials, 0)
  const counted = per.reduce((s, p) => s + p.window.draws.length, 0)
  const overlaps = per.filter((p) => p.overlap !== null)
  const shared = overlaps.reduce((s, p) => s + p.overlap!.shared, 0)
  const chance = overlaps.reduce((s, p) => s + p.overlap!.chance, 0)
  const overlapVariance = overlaps.reduce((s, p) => s + p.overlap!.variance, 0)
  const longest = per.filter((p) => p.gap !== null).sort((a, b) => b.gap!.draws - a.gap!.draws)[0]
  const changed = per.filter((p) => p.window.change !== null)
  const withRetired = per.filter((p) => p.retired.length > 0)
  const rates = gaps.filter((g) => g.trials > 0).map((g) => g.hits / g.trials)
  const climbs = rates.length > 1 && rates.every((r, i) => i === 0 || r > rates[i - 1])
  const atLeastOneOut = 1 - Math.pow(0.95, groupsUsed)
  const dataTo = newestDrawDate(lotteries, META.published)

  return (
    <ArticleLayout
      meta={META}
      dataTo={dataTo}
      lede="Every lottery site, WinLot included, shows how often each number has come up. It is natural to read those counts as a clue: back the numbers that keep appearing, or the ones that have been missing for a long time. This article tests both ideas on WinLot's own archive of Sri Lankan draws and explains why neither changes the next draw."
    >
      <h2>What a frequency count is</h2>
      <p>
        A frequency count is simply how many times each number has been drawn over a stretch of draws. With four numbers drawn
        each time from about 80 balls, every number comes out in roughly one draw in twenty on average, so over a long stretch
        each count should sit near the same value. The question is how near.
      </p>
      {example ? (
        <p>
          Take {example.l.name}. Over the {plural(example.spread!.draws, 'draw')} counted here, each of its{' '}
          {fmtInt(example.spread!.live)} numbers in use would come out {fmtFixed(example.spread!.expected, 1)} times on an even
          share. The least drawn number ({listText(example.spread!.min.numbers.map(String))}) came out{' '}
          {fmtInt(example.spread!.min.count)} times and the most drawn ({listText(example.spread!.max.numbers.map(String))}){' '}
          {fmtInt(example.spread!.max.count)} times. That gap looks large, but it is what fair draws produce. For fair draws a
          single number&apos;s count has a typical spread (standard deviation) of {fmtFixed(example.spread!.sd, 1)}, and about 95
          numbers in 100 should land within 1.96 of those spreads of the even share, here between{' '}
          {fmtFixed(example.spread!.expected - 1.96 * example.spread!.sd, 1)} and{' '}
          {fmtFixed(example.spread!.expected + 1.96 * example.spread!.sd, 1)}. In fact {fmtInt(example.spread!.inRange)} of the{' '}
          {fmtInt(example.spread!.live)} numbers ({pct1(example.spread!.inRange / example.spread!.live)}) did.
        </p>
      ) : null}
      <p>The same check for every lottery:</p>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Spread of number counts per lottery</caption>
          <thead>
            <tr>
              <th scope="col">Lottery</th>
              <th scope="col">Draws counted</th>
              <th scope="col">Even share</th>
              <th scope="col">Least / most drawn</th>
              <th scope="col">Within the usual range</th>
            </tr>
          </thead>
          <tbody>
            {withSpread.map(({ l, spread }) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/l/${l.id}`}>{l.name}</Link>
                </td>
                <td className="num">{fmtInt(spread!.draws)}</td>
                <td className="num">{fmtFixed(spread!.expected, 1)}</td>
                <td className="num">
                  {fmtInt(spread!.min.count)} / {fmtInt(spread!.max.count)}
                </td>
                <td className="num">
                  {fmtInt(spread!.inRange)} of {fmtInt(spread!.live)} ({pct1(spread!.inRange / spread!.live)})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Fair draws put about 95% of numbers inside the usual range and the rest just outside it, so a handful of numbers that
        look unusually frequent or rare is exactly what to expect. A number standing out in a table like this is not a sign that
        the machine prefers it.
      </p>

      <h2>Why only some draws are counted</h2>
      <p>
        A fair comparison needs every number to have been in the machine for every draw counted.
        {withRetired.length
          ? ` Some numbers no longer come out at all: ${listText(withRetired.map((p) => `${listText(p.retired.map(String))} in ${p.l.name}`))} have not been drawn in the last ${fmtInt(RETIRED_AFTER)} draws, so they are treated as out of use and left out.`
          : ''}
        {changed.length
          ? ` In ${listText(changed.map((p) => p.l.name))} the opposite happened: ${listText(changed.map((p) => `number ${p.window.change!.number} came back on ${fmtDate(p.window.change!.date)} after ${fmtInt(p.window.change!.missed)} draws away`))}, so for ${changed.length === 1 ? 'that lottery' : 'those lotteries'} only the draws since then are counted.`
          : ''}{' '}
        A ball that was out of the machine for a year would otherwise look like the rarest number of all, which would be a
        fact about the machine&apos;s set of balls, not about luck. In all, this article counts {plural(counted, 'draw')}.
      </p>

      <h2>Do frequent numbers stay frequent?</h2>
      <p>
        If some numbers really came up more often, the most frequent numbers of one period would tend to be the most frequent of
        the next. Splitting each lottery&apos;s counted draws into an older and a newer half and comparing the ten most frequent
        numbers of each half tests that directly. Two random sets of ten numbers from the balls in use share between{' '}
        {fmtFixed(Math.min(...overlaps.map((p) => p.overlap!.chance)), 2)} and {fmtFixed(Math.max(...overlaps.map((p) => p.overlap!.chance)), 2)}{' '}
        numbers on average, depending on how many balls are in use.
      </p>
      <ul>
        {overlaps.map(({ l, overlap }) => (
          <li key={l.id}>
            {l.name}: {plural(overlap!.shared, 'number')} shared between the two top tens ({fmtInt(overlap!.older)} and{' '}
            {fmtInt(overlap!.newer)} draws; random sets share {fmtFixed(overlap!.chance, 2)} on average)
          </li>
        ))}
      </ul>
      <p>
        Over the {countWord(overlaps.length)} lotteries the two top tens share {plural(shared, 'number')} in all, against{' '}
        {fmtFixed(chance, 1)} for random sets.{' '}
        {shared <= chance
          ? 'That is no more than two random sets would share: the numbers that led one half of the archive did not go on to lead the other, and the top ten is reshuffled by chance from one period to the next.'
          : overlapInRange(shared, chance, overlapVariance)
            ? `That is a little more than random sets share, but well inside the range luck gives 95 times in 100 (up to ${fmtFixed(chance + 1.96 * Math.sqrt(overlapVariance), 1)}): the top ten is reshuffled by chance from one period to the next.`
            : `That is more than random sets share 95 times in 100 (up to ${fmtFixed(chance + 1.96 * Math.sqrt(overlapVariance), 1)}). Taken alone it would be worth watching, but the gap check below is the sharper test, and one unusual result among several checks is expected by luck.`}
      </p>

      <h2>Long gaps</h2>
      <p>
        The other popular idea runs the opposite way: a number that has not come out for a long time must be owed one soon.
        Long gaps do happen.{' '}
        {longest
          ? `The longest in the counted draws was in ${longest.l.name}, where number ${longest.gap!.number} stayed out for ${plural(longest.gap!.draws, 'draw')} in a row before it came back on ${fmtDate(longest.gap!.endedOn)}.`
          : ''}{' '}
        But if a long absence made a number come back sooner, numbers that had been away for a long time would come out more
        often in the next draw than numbers drawn just before.
      </p>
      <p>
        To test that, WinLot looked at every draw in the counted archive and, just before it, put every number in use into a
        group by how many draws ago it last came out. Then it counted how often the numbers of each group came out in that draw.
        That gives {fmtInt(totalTrials)} number-and-draw pairs. Fair draws have no memory, so every group should come out at the
        same rate, four in the number of balls in use, about 5%.
      </p>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">How often a number came out, by how long ago it last came out</caption>
          <thead>
            <tr>
              <th scope="col">The number...</th>
              <th scope="col">Pairs</th>
              <th scope="col">Came out</th>
              <th scope="col">Rate</th>
              <th scope="col">Fair rate</th>
              <th scope="col">Within luck?</th>
            </tr>
          </thead>
          <tbody>
            {gaps.map((g, i) => (
              <tr key={GAP_BUCKETS[i].label}>
                <td>{GAP_BUCKETS[i].label}</td>
                <td className="num">{fmtInt(g.trials)}</td>
                <td className="num">{fmtInt(g.hits)}</td>
                <td className="num">{g.trials ? pct1(g.hits / g.trials) : '-'}</td>
                <td className="num">{g.trials ? pct1(g.expected / g.trials) : '-'}</td>
                <td>{g.trials ? (gapInRange(g) ? 'yes' : 'no') : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        &quot;Within luck&quot; means the count sits inside the range that fair draws produce 95 times in 100 (1.96 standard
        deviations either side of the fair count).{' '}
        {groupsIn === groupsUsed
          ? `All ${countWord(groupsUsed)} groups do: a number that has been missing for 50 draws comes out at the same rate as one drawn last time.`
          : `${cap(countWord(groupsIn))} of the ${countWord(groupsUsed)} groups do. With ${countWord(groupsUsed)} groups checked, at least one landing outside its range happens by luck alone about ${Math.round(atLeastOneOut * 100)} times in 100, so this is not a sign of memory either; a group would show a pattern only if it stayed outside as the archive grows.`}{' '}
        {climbs ? '' : 'The rate does not climb steadily with the length of the gap.'}
      </p>

      <h2>Why past draws do not change the next one</h2>
      <p>
        The balls do not know their history. Each draw starts with the same set of balls in the machine, and nothing about the
        last draw, or the last hundred, is carried into the next one. A number that has come up often has no extra pull, and a
        number that has been missing has nothing to catch up on. That is also why WinLot never calls a number lucky or owed, and
        never shows a chance of winning next to its picks.
      </p>

      <h2>So what are the counts good for?</h2>
      <p>
        They are good for checking that the draws behave as fair draws should, as above, and for noticing changes in the
        machine&apos;s set of balls, like the numbers that went out of use. To see how WinLot still turns the history into picks
        for fun, and how it checks those picks against a random ticket, read{' '}
        <Link href="/guides/how-winlot-makes-its-picks">how WinLot builds its picks and checks itself</Link> or{' '}
        <Link href="/about">How it works</Link>.
      </p>
    </ArticleLayout>
  )
}
