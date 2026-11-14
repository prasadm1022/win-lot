// SPDX-License-Identifier: Apache-2.0
// Search metadata: the canonical origin, per-page <head> metadata (canonical, Open Graph, Twitter) and the schema.org
// JSON-LD graphs. Pure: no fs, no React. Copy here follows the same rules as the pages (no odds language).
import type { Metadata } from "next";
import type { DrawSummary, Lottery } from "./types";

export const SITE_URL = "https://winlot.hadesvault.com";
export const SITE_NAME = "WinLot";
export const PUBLISHER = { name: "HadesVault.com", url: "https://hadesvault.com" } as const;
/**
 * The operator's contact details, WinLot's one copy of what hadesvault.com publishes (the Contact and About Us pages
 * read it from here; the Privacy page links to /contact). Mirrored by hand from the portfolio repo
 * (`portfolio-prasad-madusanka`): `email` is `site.email` in `app/lib/site.ts`, `location` is the "Based in" fact in
 * `app/components/Contact.tsx`. test/contact.test.ts compares both against the sibling checkout when it is present.
 */
export const CONTACT = {
  operator: PUBLISHER.name,
  email: "prasadmupwork@gmail.com",
  location: "Colombo, Sri Lanka",
  url: `${PUBLISHER.url}/contact`,
} as const;
/** Social share image (public/og.png, 1200 x 630). */
export const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "WinLot - Sri Lanka lottery predictions, NLB and DLB" };

/** The official sources every result comes from: WinLot only does the maths on what the boards publish. */
export const BOARD_SOURCE: Record<string, { name: string; url: string; host: string }> = {
  NLB: { name: "National Lotteries Board", url: "https://www.nlb.lk", host: "nlb.lk" },
  DLB: { name: "Development Lotteries Board", url: "https://www.dlb.lk", host: "dlb.lk" },
};

export const BOARD_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(BOARD_SOURCE).map(([board, s]) => [board, s.name]),
);

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

const boardOrg = (board: string) => {
  const s = BOARD_SOURCE[board];
  return s ? { "@type": "GovernmentOrganization", name: s.name, url: s.url } : { "@type": "Organization", name: board };
};

/** Home: the site, the prediction tool itself, its publisher, and the seven lottery pages as an ordered list. */
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
      {
        "@type": "WebApplication",
        name: `${SITE_NAME} lottery prediction tool`,
        url: SITE_URL,
        description,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "LKR" },
        isBasedOn: Object.values(BOARD_SOURCE).map((s) => s.url),
        publisher: { "@id": ORG_ID },
      },
      organization,
      webPage("CollectionPage", "/", `${SITE_NAME} - Sri Lanka lottery predictions`, description),
      {
        "@type": "ItemList",
        name: "Sri Lanka lottery predictions",
        itemListElement: lotteries.map((l, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: `${l.name} predictions (${l.board})`,
          url: absUrl(`/l/${l.id}`),
        })),
      },
    ],
  };
}

/**
 * A lottery page: the page, its breadcrumb, and the official draw archive it is calculated from as a Dataset - created by
 * the lottery board, republished by HadesVault.com - with the open-data JSON download.
 */
export function lotteryJsonLd(lottery: Lottery, description: string): object {
  const path = `/l/${lottery.id}`;
  const board = BOARD_NAME[lottery.board] ?? lottery.board;
  const last = lottery.lastDraw;
  return {
    "@context": "https://schema.org",
    "@graph": [
      webPage("WebPage", path, `${lottery.name} predictions`, description),
      breadcrumb(path, lottery.name),
      ...(last
        ? [
            {
              "@type": "Dataset",
              "@id": `${absUrl(path)}#dataset`,
              name: `${lottery.name} official draw results`,
              description: `Every ${lottery.name} draw of the ${board} (${lottery.board}) since ${lottery.firstDate}: draw number, date and the numbers drawn, as published by the board and used to calculate WinLot's predictions.`,
              url: absUrl(path),
              keywords: [`${lottery.name} prediction`, `${lottery.name} results`, `${lottery.board} results`],
              temporalCoverage: `${lottery.firstDate}/${last.date}`,
              spatialCoverage: { "@type": "Place", name: "Sri Lanka" },
              isAccessibleForFree: true,
              creator: boardOrg(lottery.board),
              isBasedOn: BOARD_SOURCE[lottery.board]?.url,
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

/** A breadcrumb that starts at the home page ("All lotteries") and runs through `trail` (name + path) to the page. */
const breadcrumbTrail = (trail: readonly { name: string; path: string }[]) => {
  const path = trail[trail.length - 1].path;
  return {
    "@type": "BreadcrumbList",
    "@id": `${absUrl(path)}#breadcrumb`,
    itemListElement: [{ name: "All lotteries", path: "/" }, ...trail].map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: t.path === "/" ? SITE_URL : absUrl(t.path),
    })),
  };
};

/**
 * A page below another page (a lottery's results archive, the Guides page): the page and its breadcrumb through
 * `trail`, the last entry being the page itself.
 */
export function trailPageJsonLd(type: string, trail: readonly { name: string; path: string }[], description: string): object {
  const page = trail[trail.length - 1];
  return {
    "@context": "https://schema.org",
    "@graph": [webPage(type, page.path, page.name, description), breadcrumbTrail(trail)],
  };
}

/**
 * A guide article: the Article (written and published by HadesVault.com, about the NLB and DLB results), its web page
 * and its breadcrumb (All lotteries > Guides > the article). Dates are YYYY-MM-DD; dateModified is the newest draw date
 * the article's figures were computed from.
 */
export function articleJsonLd(a: {
  path: string;
  headline: string;
  description: string;
  datePublished: string;
  dateModified: string;
}): object {
  const url = absUrl(a.path);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        headline: a.headline,
        description: a.description,
        url,
        mainEntityOfPage: { "@id": `${url}#webpage` },
        datePublished: a.datePublished,
        dateModified: a.dateModified < a.datePublished ? a.datePublished : a.dateModified,
        inLanguage: "en",
        image: absUrl(OG_IMAGE.url),
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        isBasedOn: Object.values(BOARD_SOURCE).map((s) => s.url),
        about: Object.keys(BOARD_SOURCE).map((board) => boardOrg(board)),
      },
      organization,
      webPage("WebPage", a.path, a.headline, a.description),
      breadcrumbTrail([
        { name: "Guides", path: "/guides" },
        { name: a.headline, path: a.path },
      ]),
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
