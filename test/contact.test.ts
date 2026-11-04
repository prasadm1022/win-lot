// SPDX-License-Identifier: Apache-2.0
// CONTACT (lib/seo.ts) is WinLot's one copy of the hadesvault.com contact details (AC-9). The shape is always checked;
// the cross-repo comparison runs only where the portfolio checkout exists (HADESVAULT_SITE_DIR, or the sibling folder
// `portfolio-prasad-madusanka` next to this repo) and skips with a reason elsewhere, e.g. in CI. The second half renders
// the Contact page (app/contact/page.tsx): no form, no ads, its own <main>.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ContactPage, { metadata } from "../app/contact/page";
import { CONTACT, PUBLISHER } from "../lib/seo";
import { forbiddenHits } from "./helpers/copy-rules";

const ROOT = join(__dirname, "..");
const SITE_DIR = resolve(process.env.HADESVAULT_SITE_DIR ?? join(ROOT, "..", "portfolio-prasad-madusanka"));
const SITE_TS = join(SITE_DIR, "app", "lib", "site.ts");
const CONTACT_TSX = join(SITE_DIR, "app", "components", "Contact.tsx");
const haveSite = existsSync(SITE_TS) && existsSync(CONTACT_TSX);

describe("CONTACT constant", () => {
  it("names the publisher as the operator and points at its contact page", () => {
    expect(CONTACT.operator).toBe(PUBLISHER.name);
    expect(CONTACT.operator).toBe("HadesVault.com");
    expect(CONTACT.url).toBe(`${PUBLISHER.url}/contact`);
    expect(CONTACT.url).toBe("https://hadesvault.com/contact");
  });

  it("has a plausible email and the studio's location", () => {
    expect(CONTACT.email).toMatch(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i);
    expect(CONTACT.email).toBe(CONTACT.email.trim().toLowerCase());
    expect(CONTACT.location).toBe("Colombo, Sri Lanka");
  });

  it("is the only place in app/, components/ and lib/ that spells the email", () => {
    // A second copy would go stale on its own (A-3); pages must read CONTACT.email.
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(dir)) {
        const p = join(dir, e);
        if (statSync(p).isDirectory()) walk(p, acc);
        else if (/\.(ts|tsx)$/.test(e)) acc.push(p);
      }
      return acc;
    };
    const files = ["app", "components", "lib"].flatMap((d) => walk(join(ROOT, d)));
    const holders = files.filter((f) => readFileSync(f, "utf8").includes(CONTACT.email)).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
    expect(holders).toEqual(["lib/seo.ts"]);
  });
});

describe.skipIf(!haveSite)(`CONTACT matches the hadesvault.com source (${haveSite ? SITE_DIR : "portfolio checkout absent, skipped"})`, () => {
  it("email equals site.email in app/lib/site.ts", () => {
    const src = readFileSync(SITE_TS, "utf8");
    const m = src.match(/\bemail:\s*(['"])([^'"]+)\1/);
    expect(m?.[2]).toBe(CONTACT.email);
  });

  it("location equals the 'Based in' fact in app/components/Contact.tsx", () => {
    const src = readFileSync(CONTACT_TSX, "utf8");
    const m = src.match(/term:\s*['"]Based in['"],\s*detail:\s*['"]([^'"]+)['"]/);
    expect(m?.[1]).toBeDefined();
    // The portfolio appends the time zone ("Colombo, Sri Lanka · UTC+05:30"); WinLot keeps the place only.
    expect(m?.[1].startsWith(CONTACT.location)).toBe(true);
  });
});

// ---------- The Contact page (W3): outside the ad frame, no form, one mailto link ----------

const contactHtml = renderToStaticMarkup(createElement(ContactPage));
const contactText = contactHtml
  .replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

describe("contact page", () => {
  it('owns <main id="main"> (skip-link target) like the 404 page and carries no ad markup, loader or Google host', () => {
    expect(contactHtml.startsWith('<main id="main" tabindex="-1"><div class="container">')).toBe(true);
    expect(contactHtml.match(/<main/g)).toHaveLength(1);
    expect(contactHtml).not.toMatch(/adsbygoogle|ad-box|Advertisement|<aside/);
    expect(contactHtml).not.toMatch(/google(syndication|tagservices|adservices)|doubleclick|googlefc/i);
    expect(contactHtml).not.toContain("<script src");
  });

  it("has no form, input, textarea or button: the one contact method is the mailto link whose text is the address", () => {
    expect(contactHtml).not.toMatch(/<form|<input|<textarea|<button|<select/);
    expect(contactHtml).toContain(`<a href="mailto:${CONTACT.email}">${CONTACT.email}</a>`);
    expect(contactText).toContain("The link opens your mail app. If nothing opens, copy the address instead.");
  });

  it("shows the operator, the location, the hadesvault.com contact page and the four topics", () => {
    expect(contactText).toContain(`Operator: ${CONTACT.operator}`);
    expect(contactText).toContain(`Location: ${CONTACT.location}`);
    expect(contactText).toContain("Colombo, Sri Lanka");
    expect(contactHtml).toContain(`<a href="${CONTACT.url}" rel="noopener noreferrer">HadesVault.com contact page</a>`);
    for (const topic of [
      "A wrong result or jackpot mark: tell us the lottery, the draw number and the date.",
      "A privacy question about this site or the ads on it.",
      "An advertising or policy concern.",
      "Anything else: a broken page, an idea, a thank-you.",
    ]) {
      expect(contactText).toContain(topic);
    }
  });

  it("reminds the visitor to confirm prizes with nlb.lk or dlb.lk and that WinLot pays none", () => {
    expect(contactText).toContain("Always confirm a prize with the board that ran the draw: nlb.lk for NLB lotteries or dlb.lk for DLB lotteries.");
    expect(contactText).toContain("WinLot does not sell tickets or pay prizes.");
    expect(contactHtml).toContain('href="https://www.nlb.lk"');
    expect(contactHtml).toContain('href="https://www.dlb.lk"');
  });

  it("has the fixed title, a 120-160 character description, the canonical path, one h1 and the ContactPage JSON-LD", () => {
    expect(metadata.title).toBe("Contact WinLot");
    expect(metadata.alternates?.canonical).toBe("/contact");
    const d = String(metadata.description);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(contactHtml.match(/<h1/g)).toHaveLength(1);
    expect(contactHtml.match(/<h2/g)).toHaveLength(3);
    for (const id of ["ct-write", "ct-topics", "ct-before"]) {
      expect(contactHtml).toContain(`<section class="card prose" aria-labelledby="${id}"><h2 id="${id}">`);
    }
    expect(contactHtml).toContain('"@type":"ContactPage"');
    expect(contactHtml).toContain('"url":"https://winlot.hadesvault.com/contact"');
  });

  it("keeps to the copy rules: no odds language, no gambling invitations, no click requests, no placeholder", () => {
    expect(forbiddenHits(contactText)).toEqual([]);
    expect(contactText).not.toMatch(/\b(buy|purchase|order) (a |your )?tickets?\b|\bplay now\b|\bbuy now\b|\bplace (a |your )?bets?\b|\bbet now\b/i);
    expect(contactText).not.toMatch(/\bclick\b|support us|visit our sponsors|ads by google/i);
    expect(contactHtml).not.toMatch(/TODO|lorem|placeholder/i);
  });
});
