// SPDX-License-Identifier: Apache-2.0
// Checks the built pages in out/ against the ads configuration of the SAME environment (parseAdsConfig(process.env)), so
// one file serves the ads-off build (CI) and an ads-on build with fake IDs. out/ exists only after `npm run build`, so a
// plain `npm test` skips it; CI and QA run it with REQUIRE_BUILT_PAGES=1 after the build, and then a missing out/ fails.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adsLoaderSrc, adsTxtContent, parseAdsConfig, type AdPosition } from "../lib/ads";
import { DISCLAIMER_TEXT } from "../components/Notices";

const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "out");
const required = process.env.REQUIRE_BUILT_PAGES === "1";
const run = required || existsSync(join(OUT, "index.html"));
const cfg = parseAdsConfig(process.env);
const POSITIONS: AdPosition[] = ["top", "left", "right", "bottom"];
const LOTTERY_IDS = ["ada-kotipathi", "dhana-nidhanaya", "govisetha", "kapruka", "mega-power", "shanida", "super-ball"];

const html = (rel: string): string => readFileSync(join(OUT, rel), "utf8");
const decode = (x: string) =>
  x
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
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
const contentPages = (): string[] => ["index.html", "about.html", "privacy.html", ...LOTTERY_IDS.map((id) => `l/${id}.html`)];
const positionsIn = (h: string): string[] => [...h.matchAll(/<aside\b[^>]*class="ad ad-(top|left|right|bottom)\b/g)].map((m) => m[1]);
const loaders = (h: string): number => (h.match(/<script[^>]*adsbygoogle\.js/g) ?? []).length;

describe.skipIf(!run)("built pages follow the ads configuration (AC-1..AC-9, AC-22..AC-28)", () => {
  it("every content page (home, 7 lotteries, about, privacy) and the 404 page is built", () => {
    expect(existsSync(join(OUT, "index.html")), "out/index.html is missing: run `npm run build` first").toBe(true);
    for (const p of [...contentPages(), "404.html"]) expect(existsSync(join(OUT, p)), p).toBe(true);
    expect(readdirSync(join(OUT, "l")).filter((f) => f.endsWith(".html")).length).toBe(7);
  });

  it("loader: one per content page when the client is valid, none otherwise (AC-1, AC-2, AC-6)", () => {
    for (const p of contentPages()) {
      const h = html(p);
      expect(loaders(h), p).toBe(cfg.client ? 1 : 0);
      if (cfg.client) expect(h, p).toContain(adsLoaderSrc(cfg.client));
      else expect(h, p).not.toMatch(/adsbygoogle|googlesyndication|class="ad-label"|ad-box/);
    }
  });

  it("the loader is the only ad host in a page, and only when ads are on (NFR-4)", () => {
    for (const p of contentPages()) {
      const hosts = new Set((html(p).match(/https?:\/\/[a-z0-9.-]*(?:google|doubleclick)[a-z0-9.-]*/gi) ?? []).map((u) => u.toLowerCase()));
      const allowed = new Set<string>(["https://policies.google.com", "https://adssettings.google.com"]);
      if (cfg.client) allowed.add("https://pagead2.googlesyndication.com");
      for (const h of hosts) expect(allowed.has(h), `${p}: ${h}`).toBe(true);
    }
  });

  it("asides: one per configured position, outside <main>, in the right order (AC-3, AC-7, AC-20, AC-21, AC-22, AC-31)", () => {
    const want = POSITIONS.filter((p) => cfg.client && cfg.slots[p]);
    for (const p of contentPages()) {
      const h = html(p);
      expect([...positionsIn(h)].sort(), p).toEqual([...want].sort());
      const main = h.indexOf('<main id="main"');
      const mainEnd = h.indexOf("</main>");
      expect(main, p).toBeGreaterThan(-1);
      expect(mainEnd, p).toBeGreaterThan(main);
      const at = (k: string) => h.indexOf(`class="ad ad-${k}`);
      for (const k of want) {
        if (k === "top" || k === "left") expect(at(k) < main, `${p} ${k} precedes <main>`).toBe(true);
        else expect(at(k) > mainEnd, `${p} ${k} follows </main>`).toBe(true);
        expect(h, `${p} ${k}`).toContain(`aria-labelledby="ad-${k}-label"`);
        expect(h, `${p} ${k}`).toMatch(new RegExp(`id="ad-${k}-label"[^>]*>Advertisement<`));
      }
      if (want.includes("top") && want.includes("left")) expect(at("top") < at("left"), p).toBe(true);
      if (want.includes("left") || want.includes("right")) expect(h, p).toContain("site-shell has-rails");
      else expect(h, p).not.toContain("has-rails");
      for (const m of h.matchAll(/<div class="ad-box">([\s\S]*?)<\/div>/g)) expect(m[1], p).not.toMatch(/ball|score|jackpot|Rs\./i);
    }
  });

  it("the client and slots in the markup are exactly the configured ones (AC-4, AC-5)", () => {
    for (const p of contentPages()) {
      const h = html(p);
      if (!cfg.client) {
        expect(h, p).not.toContain("data-ad-client");
        continue;
      }
      // banners carry their <ins> in the server markup; rails mount it only client-side once the viewport is wide enough
      const banners = (["top", "bottom"] as AdPosition[]).filter((k) => cfg.slots[k]);
      for (const pos of banners) expect(h, `${p} ${pos}`).toContain(`data-ad-slot="${cfg.slots[pos]}"`);
      for (const pos of ["left", "right"] as AdPosition[]) expect(h, `${p} ${pos} rail`).not.toContain(`data-ad-slot="${cfg.slots[pos] ?? "none"}"`);
      for (const m of h.matchAll(/data-ad-client="([^"]*)"/g)) expect(m[1], p).toBe(cfg.client);
      expect((h.match(/data-ad-slot="/g) ?? []).length, p).toBe(banners.length);
    }
  });

  it("the 404 page has no ads and no loader, and owns main#main (AC-8, AC-31)", () => {
    const h = html("404.html");
    expect(h).not.toMatch(/adsbygoogle|googlesyndication|ad-box|<aside\b[^>]*class="ad /);
    expect(h).toContain('id="main"');
    expect((h.match(/<main\b/g) ?? []).length).toBe(1);
  });

  it("ads.txt exists only when the client is valid and holds the one exact line (AC-25, AC-26)", () => {
    const f = join(OUT, "ads.txt");
    const want = adsTxtContent(cfg.client);
    if (want === null) expect(existsSync(f)).toBe(false);
    else {
      expect(readFileSync(f, "utf8")).toBe(want);
      expect(want).toMatch(/^google\.com, pub-\d+, DIRECT, f08c47fec0942fa0\n$/);
      expect(want).not.toContain("ca-");
    }
  });

  it("every page, 404 included, has the footer Privacy link (AC-27)", () => {
    const pages = walk(OUT).map(rel);
    expect(pages.length).toBeGreaterThanOrEqual(11);
    for (const p of pages) expect(html(p), p).toMatch(/<footer[\s\S]*<a href="\/privacy">Privacy<\/a>[\s\S]*<\/footer>/);
  });

  it("the Privacy page carries the required statements and safe links (AC-28, AC-24, TC-45)", () => {
    const h = html("privacy.html");
    const text = decode(h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    for (const s of [
      "no accounts",
      "light or dark theme choice",
      "cookies or similar identifiers",
      "EEA",
      "United Kingdom",
      "Switzerland",
      "Privacy and cookie settings",
      "hadesvault.com",
      "Last updated 1 Nov 2026",
    ]) {
      expect(text.toLowerCase(), s).toContain(s.toLowerCase());
    }
    for (const url of ["https://adssettings.google.com", "https://policies.google.com/technologies/partner-sites"]) {
      expect(h, url).toContain(`<a href="${url}" rel="noopener noreferrer">`);
    }
    expect(text).not.toMatch(/\bdue\b/i);
  });

  it("the disclaimer comes before the bottom ad and the footer (AC-23)", () => {
    for (const p of ["index.html", ...LOTTERY_IDS.map((id) => `l/${id}.html`)]) {
      const h = decode(html(p).replace(/<script[\s\S]*?<\/script>/g, ""));
      const d = h.lastIndexOf(DISCLAIMER_TEXT);
      expect(d, `${p}: disclaimer text`).toBeGreaterThan(-1);
      const footer = h.indexOf('<footer class="site-footer"');
      expect(d < footer, p).toBe(true);
      if (cfg.client && cfg.slots.bottom) {
        const b = h.indexOf('class="ad ad-bottom');
        expect(d < b, `${p}: disclaimer before bottom ad`).toBe(true);
        expect(b < footer, `${p}: bottom ad before footer`).toBe(true);
      }
    }
  });

  it("the pre-change URLs still exist after the route-group move (TC-41)", () => {
    for (const p of ["index.html", "about.html", "privacy.html", "404.html", "favicon.svg"]) expect(existsSync(join(OUT, p)), p).toBe(true);
    for (const id of LOTTERY_IDS) expect(existsSync(join(OUT, "l", `${id}.html`)), id).toBe(true);
  });
});
