// SPDX-License-Identifier: Apache-2.0
// The About Us page (/about-us, W2 of win-lot-005): who runs WinLot, what it offers, where the results come from and
// what it is not, rendered with react-dom/server the way the static export renders it. AC-2..5, AC-19..22, AC-39.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutUsPage, { metadata } from "../app/(site)/about-us/page";
import { DISCLAIMER_TEXT } from "../components/Notices";
import { LOTTERIES } from "../lib/lotteries";
import { CONTACT } from "../lib/seo";
import { forbiddenHits } from "./helpers/copy-rules";

const html = renderToStaticMarkup(createElement(AboutUsPage));
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&quot;/g, '"')
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/\s+/g, " ")
  .trim();

describe("about us page", () => {
  it("has the fixed title, a 120-160 character description, the canonical path and one h1", () => {
    expect(metadata.title).toBe("About WinLot");
    expect(metadata.alternates?.canonical).toBe("/about-us");
    const d = String(metadata.description);
    expect(d.length).toBeGreaterThanOrEqual(120);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(text).toContain("About WinLot");
    expect(html).not.toMatch(/<h[3-6]/);
  });

  it("says who runs WinLot (operator, location) and links the operator and the Contact page", () => {
    // text() puts a space at every tag boundary, so the link's closing tag reads as "HadesVault.com ,".
    expect(text).toMatch(new RegExp(`WinLot is a project by ${CONTACT.operator} ?, a software studio in ${CONTACT.location}\\.`));
    expect(html).toContain('<a href="https://hadesvault.com">HadesVault.com</a>');
    expect(html).toContain('href="/contact"');
    expect(html).toContain('href="/about"');
  });

  it("lists all seven lotteries with a link each, in LOTTERIES order, with the board", () => {
    expect(LOTTERIES).toHaveLength(7);
    let last = -1;
    for (const l of LOTTERIES) {
      const needle = `<a href="/l/${l.id}">${l.name}</a> (${l.board})`;
      const at = html.indexOf(needle);
      expect(at, needle).toBeGreaterThan(last);
      last = at;
    }
  });

  it("credits nlb.lk and dlb.lk and says WinLot is not affiliated with either board", () => {
    expect(html).toContain('href="https://www.nlb.lk"');
    expect(html).toContain('href="https://www.dlb.lk"');
    expect(text).toContain("National Lotteries Board (nlb.lk)");
    expect(text).toContain("Development Lotteries Board (dlb.lk)");
    expect(text).toContain("WinLot is not affiliated with, endorsed by or connected to the National Lotteries Board or the Development Lotteries Board.");
    expect(text).toContain("the official site is right");
  });

  it("states what WinLot is not: no tickets, bets or payments; picks for entertainment; adults only", () => {
    expect(text).toContain("WinLot sells no tickets, takes no bets and handles no payments.");
    expect(text).toContain("The picks are a statistical curiosity for entertainment only.");
    expect(text).toContain("WinLot is written for visitors aged 18 and over.");
    expect(text).toContain("The results are refreshed once a day");
  });

  it("shows the disclaimer word for word and no image", () => {
    expect(text).toContain(DISCLAIMER_TEXT);
    expect(html).toContain('role="note"');
    expect(html).not.toMatch(/<img|<picture|<svg/);
  });

  it("uses the Privacy page structure: five labelled sections and the AboutPage JSON-LD", () => {
    for (const id of ["au-who", "au-what", "au-sources", "au-not", "au-fresh"]) {
      expect(html).toContain(`<section class="card prose" aria-labelledby="${id}"><h2 id="${id}">`);
    }
    expect(html.match(/<h2/g)).toHaveLength(5);
    expect(html).toContain('"@type":"AboutPage"');
    expect(html).toContain('"url":"https://winlot.hadesvault.com/about-us"');
  });

  it("keeps to the copy rules: no odds language, no gambling invitations, no click requests, no Google branding", () => {
    expect(forbiddenHits(text)).toEqual([]);
    expect(text).not.toMatch(/\b(buy|purchase|order) (a |your )?tickets?\b|\bplay now\b|\bbuy now\b|\bplace (a |your )?bets?\b|\bbet now\b/i);
    expect(text).not.toMatch(/\bclick\b|support us|visit our sponsors|ads by google/i);
    expect(text).not.toMatch(/\bwon by\b|\bwinner(?:'s)? name\b|\bfrom (the )?town\b/i);
    expect(html).not.toMatch(/<form|<input|<textarea|adsbygoogle/);
    expect(html).not.toMatch(/TODO|lorem|placeholder/i);
  });
});
