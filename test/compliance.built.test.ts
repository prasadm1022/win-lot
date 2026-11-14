// SPDX-License-Identifier: Apache-2.0
// AdSense-policy and SEO scan of the built pages in out/ (win-lot-005). Visitor-facing text only: scripts, styles and
// tags are stripped before the copy rules run, so an onClick attribute or an RSC payload never trips "click". Like
// test/ads.built.test.ts it skips while out/ is missing (plain `npm test` before a build) and REQUIRE_BUILT_PAGES=1
// makes a missing out/ a failure. The same file serves the ads-off build and an ads-on build with fake IDs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DISCLAIMER_TEXT } from "../components/Notices";
import { ARTICLES } from "../lib/articles";
import { SITE_URL } from "../lib/seo";
import { FORBIDDEN, forbiddenHits } from "./helpers/copy-rules";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "out");
const required = process.env.REQUIRE_BUILT_PAGES === "1";
const run = required || existsSync(join(OUT, "index.html"));
const LOTTERY_IDS = ["ada-kotipathi", "dhana-nidhanaya", "govisetha", "kapruka", "mega-power", "shanida", "super-ball"];
const LOTTERY_PAGES = LOTTERY_IDS.map((id) => `l/${id}.html`);
const RESULTS_PAGES = LOTTERY_IDS.map((id) => `l/${id}/results.html`);
const GUIDE_PAGES = ["guides.html", ...ARTICLES.map((a) => `guides/${a.slug}.html`)];
/** The indexable pages (AC-39; the results archives and the guides added for the content review) as out/ paths; the
 *  sitemap must list exactly their URLs (AC-40). */
const INDEXABLE = [
  "index.html",
  ...LOTTERY_PAGES,
  ...RESULTS_PAGES,
  ...GUIDE_PAGES,
  "about.html",
  "about-us.html",
  "contact.html",
  "privacy.html",
];
const urlOf = (p: string): string => (p === "index.html" ? SITE_URL : `${SITE_URL}/${p.replace(/\.html$/, "")}`);

const html = (rel: string): string => readFileSync(join(OUT, rel), "utf8");
const decode = (x: string) =>
  x
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
/** What a visitor can read: tags, scripts and styles removed, whitespace folded. */
const visibleText = (h: string): string =>
  decode(
    h
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
const walk = (dir: string, acc: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      if (e !== "_next" && e !== "data") walk(p, acc);
    } else if (e.endsWith(".html")) acc.push(p);
  }
  return acc;
};
const rel = (p: string) => p.slice(OUT.length + 1).replace(/\\/g, "/");
const allPages = (): string[] => walk(OUT).map(rel).sort();
const attr = (h: string, re: RegExp): string | null => h.match(re)?.[1] ?? null;

/** AC-19: no invitation to buy tickets, bet or play, in text or link labels. */
const INVITATION = /\b(buy|purchase|order) (a |your )?tickets?\b|\bplay now\b|\bbuy now\b|\bplace (a |your )?bets?\b|\bbet now\b/i;
/** AC-29, AC-33: nothing asks visitors to click, view or support ads, and no Google-branded labelling. */
const AD_SOLICITATION = /\bclick\b|support us|visit our sponsors|ads by google/i;
/** AC-22: no winner names or towns. */
const WINNER_DATA = /\bwon by\b|\bwinner(?:'s)? name\b|\bfrom (the )?town\b/i;
const WINNER_KEYS = ["name", "winner", "town"];

describe.skipIf(!run)("built pages meet the AdSense content rules (AC-17, AC-19..22, AC-29, AC-33, AC-35)", () => {
  it("out/ holds every page the scan covers", () => {
    expect(existsSync(join(OUT, "index.html")), "out/index.html is missing: run `npm run build` first").toBe(true);
    for (const p of [...INDEXABLE, "404.html"]) expect(existsSync(join(OUT, p)), p).toBe(true);
    expect(allPages().length).toBeGreaterThanOrEqual(INDEXABLE.length + 1);
  });

  it("no page invites visitors to buy tickets, bet or play (AC-19)", () => {
    for (const p of allPages()) {
      const text = visibleText(html(p));
      expect(text.match(INVITATION)?.[0], p).toBeUndefined();
      // link targets as well as labels: no ticket seller or betting site
      for (const m of html(p).matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)) {
        expect(m[1], `${p}: link ${m[1]}`).not.toMatch(/\b(bet|betting|casino|lotto-?shop|ticket)s?\b/i);
      }
    }
  });

  it("no page uses the odds language of the copy rules (AC-20)", () => {
    for (const p of allPages()) {
      const text = visibleText(html(p));
      expect(forbiddenHits(text), `${p}: ${forbiddenHits(text).join(", ")}`).toEqual([]);
    }
    expect(FORBIDDEN.length).toBeGreaterThanOrEqual(7); // the AC-20 list is a subset of the shared rules
  });

  it("no page asks visitors to click, view or support ads, and none says 'Ads by Google' (AC-29, AC-33)", () => {
    for (const p of allPages()) {
      const text = visibleText(html(p));
      expect(text.match(AD_SOLICITATION)?.[0], p).toBeUndefined();
      expect(html(p), `${p}: alt text`).not.toMatch(/alt="[^"]*google[^"]*"/i);
    }
  });

  it("no page has a form (AC-11, AC-25)", () => {
    for (const p of allPages()) expect(html(p), p).not.toMatch(/<form\b|<input\b|<textarea\b/i);
  });

  it("every picks page (home, 7 lotteries) carries the disclaimer word for word (AC-21)", () => {
    for (const p of ["index.html", ...LOTTERY_PAGES]) expect(visibleText(html(p)), p).toContain(DISCLAIMER_TEXT);
  });

  it("no winner names or towns, on any page or in data/jackpots.json (AC-22)", () => {
    for (const p of allPages()) expect(visibleText(html(p)).match(WINNER_DATA)?.[0], p).toBeUndefined();
    const records = JSON.parse(readFileSync(join(ROOT, "data", "jackpots.json"), "utf8")) as Record<string, unknown>[];
    expect(Array.isArray(records)).toBe(true);
    for (const r of records) for (const k of WINNER_KEYS) expect(k in r, `jackpot ${String(r.lotteryId)} ${String(r.drawNo)}: key ${k}`).toBe(false);
  });

  it("every lottery page credits its official source, nlb.lk or dlb.lk (AC-35)", () => {
    for (const p of LOTTERY_PAGES) expect(visibleText(html(p)), p).toMatch(/\b(nlb|dlb)\.lk\b/);
  });

  it("the home page links each of the seven lottery pages (AC-17)", () => {
    const h = html("index.html");
    for (const id of LOTTERY_IDS) expect(h, id).toContain(`href="/l/${id}"`);
  });
});

describe.skipIf(!run)("built pages are indexable the right way (AC-6, AC-39, AC-40)", () => {
  it("each indexable page has a unique title, a unique description, one h1 and a winlot canonical (AC-39)", () => {
    const titles = new Map<string, string>();
    const descriptions = new Map<string, string>();
    for (const p of INDEXABLE) {
      const h = html(p);
      const title = attr(h, /<title>([^<]*)<\/title>/);
      const description = attr(h, /<meta name="description" content="([^"]*)"/);
      const canonical = attr(h, /<link rel="canonical" href="([^"]*)"/);
      expect(title, `${p}: title`).toBeTruthy();
      expect(description, `${p}: description`).toBeTruthy();
      expect(titles.get(title!), `${p}: title also used by ${titles.get(title!)}`).toBeUndefined();
      expect(descriptions.get(description!), `${p}: description also used by ${descriptions.get(description!)}`).toBeUndefined();
      titles.set(title!, p);
      descriptions.set(description!, p);
      expect((h.match(/<h1\b/g) ?? []).length, `${p}: h1 count`).toBe(1);
      expect(canonical, `${p}: canonical`).toBe(urlOf(p));
      expect(h, `${p}: must not be noindex`).not.toMatch(/<meta name="robots" content="[^"]*noindex/);
    }
  });

  it("the 404 page is not indexable and does not claim a canonical", () => {
    const h = html("404.html");
    expect(h).toMatch(/<meta name="robots" content="[^"]*noindex/);
    expect(h).not.toContain('<link rel="canonical"');
  });

  it("How it works keeps its address and title (AC-6)", () => {
    const h = html("about.html");
    expect(attr(h, /<title>([^<]*)<\/title>/)).toBe("How the Lottery Predictions Work - WinLot");
    expect(attr(h, /<link rel="canonical" href="([^"]*)"/)).toBe(`${SITE_URL}/about`);
    expect(h).toMatch(/<h1[^>]*>How WinLot calculates its predictions<\/h1>/);
    for (const p of INDEXABLE) expect(html(p), `${p}: header links How it works`).toMatch(/<header[\s\S]*<a\b[^>]*href="\/about"[^>]*>How it works<\/a>/);
  });

  it("the sitemap lists exactly the indexable URLs, the 404 page excluded (AC-40)", () => {
    const xml = readFileSync(join(OUT, "sitemap.xml"), "utf8");
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBe(INDEXABLE.length);
    expect(new Set(locs).size).toBe(locs.length);
    expect([...locs].sort()).toEqual(INDEXABLE.map(urlOf).sort());
    for (const u of locs) {
      expect(u, "no trailing slash").not.toMatch(/\/$/);
      expect(u, "winlot host").toMatch(new RegExp(`^${SITE_URL.replace(/[.]/g, "\\.")}(/|$)`));
    }
    expect(xml).not.toMatch(/404|not-found/);
  });

  it("robots.txt allows crawling and points to the sitemap (AC-40)", () => {
    const txt = readFileSync(join(OUT, "robots.txt"), "utf8");
    expect(txt).toMatch(/^User-Agent: \*$/im);
    expect(txt).toMatch(/^Allow: \/$/m);
    expect(txt).not.toMatch(/^Disallow: \/\s*$/m);
    expect(txt).toMatch(new RegExp(`^Sitemap: ${SITE_URL.replace(/[.]/g, "\\.")}/sitemap\\.xml$`, "m"));
  });
});
