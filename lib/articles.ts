// SPDX-License-Identifier: Apache-2.0
// The /guides articles: one entry per article, in the order the Guides page lists them. Pure data, no fs: the pages
// compute every figure they print from lib/data.ts at build time (lib/insights.ts), so only the slug, the headings and
// the publication date live here. `published` is the day an article was first published; the date its figures run to
// is the newest draw date of the build, shown next to it.

export interface ArticleMeta {
  slug: string;
  /** The <title> (the site name is appended by the root layout's title template). */
  title: string;
  /** The h1, and the article's name in lists and in the JSON-LD. */
  heading: string;
  /** Meta description and the summary on the Guides page: 120-160 characters, unique. */
  description: string;
  /** YYYY-MM-DD. */
  published: string;
}

export const ARTICLES: readonly ArticleMeta[] = [
  {
    slug: "how-to-read-lottery-results",
    title: "How to Read a Sri Lankan Lottery Result",
    heading: "How to read a Sri Lankan lottery result",
    description:
      "Draw number, date, letter, four numbers and the bonus: what each part of an NLB or DLB lottery result means, with the latest results as worked examples.",
    published: "2026-11-14",
  },
  {
    slug: "jackpot-wins-history",
    title: "Jackpot Wins of Sri Lanka's Seven Lotteries",
    heading: "Jackpot wins across Sri Lanka's seven lotteries",
    description:
      "Every jackpot (Super Prize) win WinLot knows of for the NLB and DLB lotteries: where each record comes from, what was paid and how long jackpots run.",
    published: "2026-11-14",
  },
  {
    slug: "number-frequency-and-gaps",
    title: "Lottery Number Frequency and Long Gaps Explained",
    heading: "Number frequency and long gaps: what past draws can tell you",
    description:
      "What counting past lottery numbers shows and what it cannot: a check of thousands of Sri Lankan draws on whether a long absence changes the next draw.",
    published: "2026-11-14",
  },
  {
    slug: "how-winlot-makes-its-picks",
    title: "How WinLot Builds Its Picks and Checks Itself",
    heading: "How WinLot builds its picks and checks itself",
    description:
      "The three kinds of evidence behind WinLot's picks, the rules that keep them honest, and the backtest that compares them with a random ticket draw by draw.",
    published: "2026-11-14",
  },
  {
    slug: "year-in-numbers",
    title: "The Lottery Year in Numbers: NLB and DLB",
    heading: "The lottery year in numbers",
    description:
      "One year of Sri Lanka's seven lotteries in figures: draws held, breaks, jackpots won, the most and least drawn numbers and how often a number repeats.",
    published: "2026-11-14",
  },
];

export const ARTICLE_BY_SLUG: Readonly<Record<string, ArticleMeta>> = Object.fromEntries(ARTICLES.map((a) => [a.slug, a]));

/** The article's path, e.g. "/guides/jackpot-wins-history". */
export const articlePath = (slug: string): string => `/guides/${slug}`;
