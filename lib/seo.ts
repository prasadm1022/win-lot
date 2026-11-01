// SPDX-License-Identifier: Apache-2.0
// Search metadata: the canonical origin, per-page <head> metadata (canonical, Open Graph, Twitter) and the schema.org
// JSON-LD graphs. Pure: no fs, no React. Copy here follows the same rules as the pages (no odds language).
import type { Metadata } from "next";
import type { DrawSummary, Lottery } from "./types";

export const SITE_URL = "https://winlot.hadesvault.com";
export const SITE_NAME = "WinLot";
export const PUBLISHER = { name: "HadesVault.com", url: "https://hadesvault.com" } as const;
/** Social share image (public/og.png, 1200 x 630). */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "WinLot - Sri Lanka lottery results and statistics" };

export const BOARD_NAME: Record<string, string> = {
  NLB: "National Lotteries Board",
  DLB: "Development Lotteries Board",
};

/** A path resolved against the canonical origin, unslashed ("/" -> "https://winlot.hadesvault.com"). */
export const absUrl = (path: string): string => new URL(path, SITE_URL).toString().replace(/\/$/, "");

/**
 * Full metadata for one page. Next replaces (does not merge) `openGraph` and `twitter` per segment, so every page sets
 * them whole, with the same canonical URL in `alternates`, `og:url` and the JSON-LD `@id`s.
 */
export function pageMetadata(opts: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const { title, description, path } = opts;
  const social = opts.absoluteTitle ? title : `${title} - ${SITE_NAME}`;
  return {
    title: opts.absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: SITE_NAME,
      locale: "en_LK",
      title: social,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title: social, description, images: [OG_IMAGE.url] },
  };
}

/** "E 24 33 41 45 + 12": a draw as one line of text, for descriptions and structured data. */
export function ticketText(draw: Pick<DrawSummary, "letter" | "numbers" | "bonus">): string {
  const parts = [draw.letter, ...draw.numbers.map(String)].filter((p): p is string => Boolean(p));
  const b = draw.bonus;
  const bonus = typeof b === "string" || typeof b === "number" ? String(b) : null;
  return bonus ? `${parts.join(" ")} + ${bonus}` : parts.join(" ");
}

// ---------- JSON-LD ----------

const ORG_ID = `${PUBLISHER.url}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

const organization = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: PUBLISHER.name,
  url: PUBLISHER.url,
};

const breadcrumb = (path: string, name: string) => ({
  "@type": "BreadcrumbList",
  "@id": `${absUrl(path)}#breadcrumb`,
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "All lotteries", item: SITE_URL },
    { "@type": "ListItem", position: 2, name, item: absUrl(path) },
  ],
});

const webPage = (type: string, path: string, name: string, description: string) => ({
  "@type": type,
  "@id": `${absUrl(path)}#webpage`,
  url: absUrl(path),
  name,
  description,
  inLanguage: "en",
  isPartOf: { "@id": SITE_ID },
  publisher: { "@id": ORG_ID },
  ...(path === "/" ? {} : { breadcrumb: { "@id": `${absUrl(path)}#breadcrumb` } }),
});

/** Home: the site, its publisher, and the seven lottery pages as an ordered list. */
export function homeJsonLd(lotteries: Pick<Lottery, "id" | "name" | "board">[], description: string): object {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": SITE_ID,
        url: SITE_URL,
        name: SITE_NAME,
        description,
        inLanguage: "en",
        publisher: { "@id": ORG_ID },
      },
      organization,
      webPage("CollectionPage", "/", `${SITE_NAME} - Sri Lanka lottery results`, description),
      {
        "@type": "ItemList",
        name: "Sri Lanka lottery results",
        itemListElement: lotteries.map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${l.name} results (${l.board})`,
          url: absUrl(`/l/${l.id}`),
        })),
      },
    ],
  };
}

/** A lottery page: the page, its breadcrumb, and its draw archive as a Dataset with the open-data JSON download. */
export function lotteryJsonLd(lottery: Lottery, description: string): object {
  const path = `/l/${lottery.id}`;
  const board = BOARD_NAME[lottery.board] ?? lottery.board;
  const last = lottery.lastDraw;
  return {
    "@context": "https://schema.org",
    "@graph": [
      webPage("WebPage", path, `${lottery.name} results`, description),
      breadcrumb(path, lottery.name),
      ...(last
        ? [
            {
              "@type": "Dataset",
              "@id": `${absUrl(path)}#dataset`,
              name: `${lottery.name} draw results`,
              description: `Every ${lottery.name} draw of the ${board} (${lottery.board}) since ${lottery.firstDate}: draw number, date and the numbers drawn. Collected daily from the board's public results.`,
              url: absUrl(path),
              keywords: [`${lottery.name} results`, `${lottery.board} results`, "Sri Lanka lottery results"],
              temporalCoverage: `${lottery.firstDate}/${last.date}`,
              spatialCoverage: { "@type": "Place", name: "Sri Lanka" },
              isAccessibleForFree: true,
              creator: { "@id": ORG_ID },
              publisher: { "@id": ORG_ID },
              dateModified: last.date,
              distribution: {
                "@type": "DataDownload",
                encodingFormat: "application/json",
                contentUrl: absUrl(`/data/${lottery.id}.json`),
              },
            },
          ]
        : []),
    ],
  };
}

/** A plain page (How it works, Privacy) with its breadcrumb. */
export function pageJsonLd(type: string, path: string, name: string, description: string): object {
  return {
    "@context": "https://schema.org",
    "@graph": [webPage(type, path, name, description), breadcrumb(path, name)],
  };
}
