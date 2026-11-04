// SPDX-License-Identifier: Apache-2.0
// ConsentSettingsLink (AC-23 site side, AC-24): a real link to the Privacy EEA section, enhanced to reopen Google's
// consent message only when Google's platform is on the page and GDPR applies. The click logic is tested without a DOM
// through handleConsentClick with fake globals; the markup through react-dom/server, as the static export renders it.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CONSENT_SETTINGS_HREF,
  CONSENT_SETTINGS_LABEL,
  ConsentSettingsLink,
  handleConsentClick,
  type ConsentWindow,
} from "../components/ConsentSettingsLink";
import { FORBIDDEN } from "./helpers/copy-rules";

type Globals = Pick<ConsentWindow, "googlefc" | "__tcfapi">;
const fakeWindow = (over: Globals = {}) => {
  const assign = vi.fn<(url: string | URL) => void>();
  const win: ConsentWindow = { location: { assign }, ...over };
  return { win, assign };
};
const click = () => ({ preventDefault: vi.fn() });

describe("ConsentSettingsLink markup", () => {
  it("is a plain anchor to /privacy#pp-eea labelled 'Privacy and cookie settings', nothing else", () => {
    const html = renderToStaticMarkup(createElement(ConsentSettingsLink));
    expect(html).toBe(`<a href="${CONSENT_SETTINGS_HREF}">${CONSENT_SETTINGS_LABEL}</a>`);
    expect(CONSENT_SETTINGS_HREF).toBe("/privacy#pp-eea");
    expect(CONSENT_SETTINGS_LABEL).toBe("Privacy and cookie settings");
    for (const re of FORBIDDEN) expect(CONSENT_SETTINGS_LABEL).not.toMatch(re);
  });

  it("brings no ad or consent code of its own (no Google host, no script)", () => {
    const html = renderToStaticMarkup(createElement(ConsentSettingsLink));
    expect(html).not.toMatch(/<script|googlesyndication|fundingchoices|adsbygoogle|role="button"/);
  });
});

describe("handleConsentClick", () => {
  it("without Google's platform it does nothing and lets the browser follow the href", () => {
    const e = click();
    const { win, assign } = fakeWindow();
    expect(handleConsentClick(e, win)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it("with googlefc but no __tcfapi (or the reverse) it still follows the href", () => {
    const only = [
      fakeWindow({ googlefc: { callbackQueue: [], showRevocationMessage: vi.fn() } }),
      fakeWindow({ __tcfapi: vi.fn() }),
      fakeWindow({ googlefc: {}, __tcfapi: vi.fn() }), // platform stub without a queue: not usable yet
    ];
    for (const { win } of only) {
      const e = click();
      expect(handleConsentClick(e, win)).toBe(false);
      expect(e.preventDefault).not.toHaveBeenCalled();
    }
  });

  it("with Google's platform and gdprApplies it queues showRevocationMessage and does not navigate", () => {
    const show = vi.fn();
    const fc = { callbackQueue: [] as Array<() => void>, showRevocationMessage: show };
    const tcf = vi.fn((cmd: string, v: number, cb: (d?: { gdprApplies?: boolean }) => void) => {
      expect(cmd).toBe("ping");
      expect(v).toBe(2);
      cb({ gdprApplies: true });
    });
    const { win, assign } = fakeWindow({ googlefc: fc, __tcfapi: tcf as ConsentWindow["__tcfapi"] });
    const e = click();
    expect(handleConsentClick(e, win)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(tcf).toHaveBeenCalledTimes(1);
    expect(fc.callbackQueue).toHaveLength(1);
    expect(show).not.toHaveBeenCalled(); // Google runs the queue when its script is ready
    fc.callbackQueue[0]();
    expect(show).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("with Google's platform but GDPR not applying it opens the Privacy section by hand", () => {
    const show = vi.fn();
    const fc = { callbackQueue: [] as Array<() => void>, showRevocationMessage: show };
    const tcf = vi.fn((_c: string, _v: number, cb: (d?: { gdprApplies?: boolean }) => void) => cb({ gdprApplies: false }));
    const { win, assign } = fakeWindow({ googlefc: fc, __tcfapi: tcf as ConsentWindow["__tcfapi"] });
    const e = click();
    expect(handleConsentClick(e, win)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalledTimes(1);
    expect(fc.callbackQueue).toHaveLength(0);
    expect(show).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith("/privacy#pp-eea");
  });

  it("treats a ping answer without gdprApplies as 'not applying'", () => {
    const fc = { callbackQueue: [] as Array<() => void> };
    const tcf = vi.fn((_c: string, _v: number, cb: (d?: { gdprApplies?: boolean }) => void) => cb(undefined));
    const { win, assign } = fakeWindow({ googlefc: fc, __tcfapi: tcf as ConsentWindow["__tcfapi"] });
    handleConsentClick(click(), win);
    expect(assign).toHaveBeenCalledWith("/privacy#pp-eea");
    expect(fc.callbackQueue).toHaveLength(0);
  });
});
