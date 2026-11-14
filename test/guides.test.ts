// SPDX-License-Identifier: Apache-2.0
// The /guides articles, the results archives and the lottery guide, rendered with react-dom/server the way the static
// export renders them, over today's data/. Every check holds on any data: sentences are compared with the numbers
// recomputed here through lib/insights.ts (lesson L11), and no count of today's data is pinned (lesson L12).
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import GuidesPage, { metadata as guidesMeta } from "../app/(site)/guides/page";
import HowToRead, { metadata as howToReadMeta } from "../app/(site)/guides/how-to-read-lottery-results/page";
import JackpotHistory, { metadata as jackpotMeta } from "../app/(site)/guides/jackpot-wins-history/page";
import Frequency, { metadata as frequencyMeta } from "../app/(site)/guides/number-frequency-and-gaps/page";
import Picks, { metadata as picksMeta } from "../app/(site)/guides/how-winlot-makes-its-picks/page";
import YearPage, { metadata as yearMeta } from "../app/(site)/guides/year-in-numbers/page";
import ResultsPage, { generateMetadata as resultsMetadata } from "../app/(site)/l/[id]/results/page";
import { pooledHeadline } from "../components/charts/Backtest";
import { LotteryGuide, scheduleText } from "../components/LotteryGuide";
import { fmtInt, fmtRupees } from "../components/util/format";
import { countWord, plural } from "../components/util/text";
import { ARTICLES } from "../lib/articles";
import { LOTTERY_IDS, getDraws, getJackpotStatus, getLotteries, getLottery, getPrediction, getPrizeRows } from "../lib/data";
import {
  articleYear,
  drawNoSteps,
  drawSchedule,
  gapCheck,
  gapInRange,
  jackpotHistory,
  liveNumbers,
  outcomeCounts,
  resultRows,
  stableWindow,
  yearRow,
} from "../lib/insights";
import { forbiddenHits } from "./helpers/copy-rules";

const decode = (x: string) =>
  x
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
const textOf = (html: string) =>
  decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
/** The visible text with React's text-node seams closed, so a sentence built from several JSX pieces reads whole. */
const flat = (html: string) => textOf(html).replace(/ ([.,;:)])/g, "$1").replace(/\( /g, "(");
const words = (s: string) => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/** The copy rules of the built-page scans (test/compliance.built.test.ts), applied before the build. */
const PAGE_RULES: RegExp[] = [
  /\b(buy|purchase|order) (a |your )?tickets?\b|\bplay now\b|\bbuy now\b|\bplace (a |your )?bets?\b|\bbet now\b/i,
  /\bclick\b|support us|visit our sponsors|ads by google/i,
  /\bwon by\b|\bwinner(?:'s)? name\b|\bfrom (the )?town\b/i,
  /\b(?:\d+(?:\.\d+)?|n|x)\s*(?:[x×]|times)\s*(?:more|as likely|the chance|the odds)\b/i,
  /better odds|better chance|lucky day|jackpot[- ]?like|accura|affinit/i,
];
const ruleHits = (t: string) => [...forbiddenHits(t), ...PAGE_RULES.filter((re) => re.test(t)).map((re) => re.source)];

const ARTICLE_PAGES: { slug: string; page: () => ReactElement; meta: typeof guidesMeta }[] = [
  { slug: "how-to-read-lottery-results", page: () => createElement(HowToRead), meta: howToReadMeta },
  { slug: "jackpot-wins-history", page: () => createElement(JackpotHistory), meta: jackpotMeta },
  { slug: "number-frequency-and-gaps", page: () => createElement(Frequency), meta: frequencyMeta },
  { slug: "how-winlot-makes-its-picks", page: () => createElement(Picks), meta: picksMeta },
  { slug: "year-in-numbers", page: () => createElement(YearPage), meta: yearMeta },
];
const rendered = new Map(ARTICLE_PAGES.map((a) => [a.slug, renderToStaticMarkup(a.page())]));
const html = (slug: string) => rendered.get(slug)!;
const articleText = (slug: string) => flat(html(slug).match(/<article[\s\S]*<\/article>/)![0]);

describe("guides: the article set", () => {
  it("every registered article has a page, and every page is registered, in the Guides order", () => {
    expect(ARTICLE_PAGES.map((a) => a.slug)).toEqual(ARTICLES.map((a) => a.slug));
    const g = renderToStaticMarkup(createElement(GuidesPage));
    let last = -1;
    for (const a of ARTICLES) {
      const at = g.indexOf(`href="/guides/${a.slug}"`);
      expect(at, a.slug).toBeGreaterThan(last);
      last = at;
    }
    for (const id of LOTTERY_IDS) expect(g, id).toContain(`href="/l/${id}/results"`);
    expect(ruleHits(textOf(g))).toEqual([]);
    expect(guidesMeta.alternates?.canonical).toBe("/guides");
  });

  it("titles and descriptions are unique, descriptions 120-160 characters, canonical paths under /guides", () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const { slug, meta } of [...ARTICLE_PAGES, { slug: "", page: () => createElement("div"), meta: guidesMeta }]) {
      const t = String(meta.title);
      const d = String(meta.description);
      expect(titles.has(t), t).toBe(false);
      expect(descriptions.has(d), d).toBe(false);
      titles.add(t);
      descriptions.add(d);
      expect(d.length, slug).toBeGreaterThanOrEqual(120);
      expect(d.length, slug).toBeLessThanOrEqual(160);
      if (slug) expect(meta.alternates?.canonical).toBe(`/guides/${slug}`);
    }
  });

  it("each article: one h1, 800-1400 words, a publication date, Article JSON-LD and no forbidden copy", () => {
    for (const a of ARTICLES) {
      const h = html(a.slug);
      expect(h.match(/<h1\b/g), a.slug).toHaveLength(1);
      const n = words(articleText(a.slug));
      expect(n, `${a.slug}: ${n} words`).toBeGreaterThanOrEqual(800);
      expect(n, `${a.slug}: ${n} words`).toBeLessThanOrEqual(1400);
      expect(h, a.slug).toContain(`<time dateTime="${a.published}">`);
      const ld = JSON.parse(h.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
      const article = ld["@graph"].find((x: { "@type": string }) => x["@type"] === "Article");
      expect(article.headline, a.slug).toBe(a.heading);
      expect(article.datePublished, a.slug).toBe(a.published);
      expect(article.dateModified >= a.published, a.slug).toBe(true);
      expect(ld["@graph"].find((x: { "@type": string }) => x["@type"] === "BreadcrumbList").itemListElement).toHaveLength(3);
      expect(ruleHits(textOf(h)), a.slug).toEqual([]);
      expect(textOf(h), a.slug).toContain("For entertainment only.");
    }
  });
});

describe("guides: every figure is the data's", () => {
  const lotteries = getLotteries().filter((l) => l.drawCount > 0);

  it("how to read a result: each lottery's latest result, and the draw-number steps", () => {
    const t = articleText("how-to-read-lottery-results");
    for (const l of lotteries) expect(t, l.id).toContain(`${l.lastDraw!.drawNo}`);
    const steps = lotteries.map((l) => drawNoSteps(getDraws(l.id))).reduce((a, s) => ({ steps: a.steps + s.steps, byOne: a.byOne + s.byOne }), { steps: 0, byOne: 0 });
    expect(t).toContain(`went up by exactly one in ${fmtInt(steps.byOne)} of ${fmtInt(steps.steps)} steps`);
    expect(t.includes("the archive skips at least one draw number")).toBe(steps.byOne < steps.steps);
  });

  it("jackpot history: the total, every paid amount and the checked NLB counts", () => {
    const t = articleText("jackpot-wins-history");
    const rows = jackpotHistory(lotteries.map((l) => ({ id: l.id, name: l.name, board: l.board, status: getJackpotStatus(l.id), rows: getPrizeRows(l.id) })));
    expect(t).toContain(`WinLot holds ${plural(rows.reduce((s, r) => s + r.wins, 0), "jackpot win")}`);
    for (const r of rows) for (const p of r.paid) expect(t, `${r.id} ${p.drawNo}`).toContain(fmtRupees(p.amount));
    for (const r of rows.filter((x) => x.checked && x.checked.draws > 0)) {
      expect(t, r.id).toContain(`won in ${fmtInt(r.checked!.wins)} of ${fmtInt(r.checked!.draws)} draws`);
    }
    // never a "not won" claim for a DLB lottery
    for (const r of rows.filter((x) => x.board === "DLB")) expect(t).not.toMatch(new RegExp(`${r.name}[^.]*not won`));
  });

  it("frequency and gaps: the gap groups and their verdict use the 1.96 range", () => {
    const t = articleText("number-frequency-and-gaps");
    const gaps = gapCheck(
      lotteries.map((l) => {
        const all = getDraws(l.id);
        const live = liveNumbers(all, l.mainMin, l.mainMax);
        return { draws: stableWindow(all, live).draws, live };
      }),
    );
    const used = gaps.filter((g) => g.trials > 0).length;
    const inside = gaps.filter(gapInRange).length;
    expect(t).toContain(inside === used ? `All ${countWord(used)} groups do:` : `${countWord(inside).replace(/^./, (c) => c.toUpperCase())} of the ${countWord(used)} groups do.`);
    expect(t).toContain(`That gives ${fmtInt(gaps.reduce((s, g) => s + g.trials, 0))} number-and-draw pairs`);
    expect(t.includes("comes out at the same rate as one drawn last time")).toBe(inside === used);
    for (const g of gaps) expect(t).toContain(fmtInt(g.trials));
  });

  it("how WinLot makes its picks: a verdict per lottery that follows its 95% range, and the pooled headline", () => {
    const h = html("how-winlot-makes-its-picks");
    const t = articleText("how-winlot-makes-its-picks");
    const rowsHtml = [...h.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => textOf(m[1]));
    let pooled = null as ReturnType<typeof getPrediction>["backtestDetail"] | null;
    for (const l of lotteries) {
      const d = getPrediction(l.id).backtestDetail!;
      pooled ??= d.pooled ? d : null;
      const row = rowsHtml.find((r) => r.startsWith(l.name));
      expect(row, l.id).toBeDefined();
      const same = d.ci95[0] <= 0 && d.ci95[1] >= 0;
      expect(row!.endsWith("the same as random"), l.id).toBe(same);
    }
    expect(t).toContain(pooledHeadline(pooled!.pooled!, pooled!.holmAll));
  });

  it("the year in numbers: the year's draws, and repeats judged on the 1.96 range", () => {
    const t = articleText("year-in-numbers");
    const newest = lotteries.map((l) => l.lastDraw!.date).sort().at(-1)!;
    const year = articleYear(newest);
    const rows = lotteries.map((l) => {
      const all = getDraws(l.id);
      return yearRow(all, liveNumbers(all, l.mainMin, l.mainMax), year);
    });
    const total = rows.reduce((s, r) => s + r.draws, 0);
    expect(html("year-in-numbers")).toContain(`: ${year}</h1>`);
    expect(t).toContain(`WinLot recorded ${plural(total, "draw")}`);
    const n = rows.reduce((s, r) => s + r.repeat.draws, 0);
    const k = rows.reduce((s, r) => s + r.repeat.repeated, 0);
    const e = rows.reduce((s, r) => s + r.repeat.draws * r.repeatChance, 0);
    const v = rows.reduce((s, r) => s + r.repeat.draws * r.repeatChance * (1 - r.repeatChance), 0);
    expect(t).toContain(`${fmtInt(k)} of ${fmtInt(n)} draws`);
    expect(t).toContain(Math.abs(k - e) <= 1.96 * Math.sqrt(v) ? "which is inside the range" : "which is outside the range");
  });
});

describe("results archives", () => {
  it("list every draw once, newest first, grouped by year with the newest year first", async () => {
    for (const id of LOTTERY_IDS) {
      const lottery = getLottery(id)!;
      const h = renderToStaticMarkup(await ResultsPage({ params: Promise.resolve({ id }) }));
      const body = [...h.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((m) => m[1]).join("");
      const drawNos = [...body.matchAll(/<tr[^>]*><td class="num">(\d+)<\/td>/g)].map((m) => Number(m[1]));
      const draws = getDraws(id);
      expect(drawNos, id).toEqual(draws.map((d) => d.drawNo).sort((a, b) => b - a));
      const years = [...h.matchAll(/<h2 id="y(\d{4})">/g)].map((m) => Number(m[1]));
      expect(years, id).toEqual([...years].sort((a, b) => b - a));
      expect(h.match(/<h1\b/g), id).toHaveLength(1);
      const t = textOf(h);
      expect(ruleHits(t), id).toEqual([]);
      expect(t, id).toMatch(lottery.board === "NLB" ? /\bnlb\.lk\b/ : /\bdlb\.lk\b/);
      const counts = outcomeCounts(resultRows(lottery.board, draws, getPrizeRows(id)));
      const notWon = (body.match(/Not won, rolls over/g) ?? []).length;
      expect(notWon, id).toBe(counts.notWon);
      if (lottery.board === "DLB") expect(notWon, id).toBe(0);
      const meta = await resultsMetadata({ params: Promise.resolve({ id }) });
      expect(meta.alternates?.canonical).toBe(`/l/${id}/results`);
      expect(String(meta.description).length, id).toBeLessThanOrEqual(160);
    }
  }, 60_000);
});

describe("lottery guide section", () => {
  it("states the schedule from the data, links the archive and the official source, and invents no prices", () => {
    for (const l of getLotteries().filter((x) => x.drawCount > 0)) {
      const draws = getDraws(l.id);
      const h = renderToStaticMarkup(
        createElement(LotteryGuide, { lottery: l, draws, rows: getPrizeRows(l.id), status: getJackpotStatus(l.id) }),
      );
      const t = flat(h);
      expect(t, l.id).toContain(scheduleText(l.name, drawSchedule(draws.map((d) => d.date))!));
      expect(h, l.id).toContain(`href="/l/${l.id}/results"`);
      expect(h, l.id).toContain('id="guide"');
      expect(ruleHits(t), l.id).toEqual([]);
      // ticket prices and claim rules are the boards': no rupee amount other than jackpots, no deadline in days
      expect(t, l.id).not.toMatch(/ticket (price|costs?) (is|of) Rs/i);
      expect(t, l.id).not.toMatch(/within \d+ days/i);
    }
  });

  it("schedule text: every weekday, a break, and the no-break case", () => {
    const s = { from: "2025-01-05", to: "2025-01-18", days: 14, draws: 11, weekdays: [2, 2, 2, 2, 1, 1, 1], daysWithout: 3, breaks: [{ from: "2025-01-09", to: "2025-01-11", days: 3 }] };
    expect(scheduleText("X", s)).toBe(
      "In the 14 days from 5 Jan 2025 to 18 Jan 2025, X was drawn on 11 of them: on every day of the week (between 1 and 2 draws on each). There was no draw on 3 days; the longest break was 3 days in a row, from 9 Jan 2025 to 11 Jan 2025.",
    );
    const full = { ...s, draws: 14, weekdays: [2, 2, 2, 2, 2, 2, 2], daysWithout: 0, breaks: [] };
    expect(scheduleText("X", full)).toContain("(2 draws on each of them). There was a draw on every one of those days.");
    const weekly = { ...s, draws: 2, weekdays: [0, 0, 0, 2, 0, 0, 0], daysWithout: 12, breaks: [] };
    expect(scheduleText("X", weekly)).toContain("on Wednesdays (2 draws on each of them)");
  });
});
