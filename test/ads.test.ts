// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  ADS_ENV,
  RAIL_MIN_WIDTH,
  adsLoaderSrc,
  adsSummary,
  adsTxtContent,
  parseAdsConfig,
  requestAdOnce,
} from "../lib/ads";

const CLIENT = "ca-pub-0000000000000000";
const fakeIns = (width: number, attrs: Record<string, string> = {}) => {
  const a = { ...attrs };
  return {
    offsetWidth: width,
    getAttribute: (n: string) => (n in a ? a[n] : null),
    setAttribute: (n: string, v: string) => {
      a[n] = v;
    },
  };
};
const throwing = () => {
  throw new Error("must not push");
};

describe("parseAdsConfig", () => {
  it("is off when nothing is set (AC-1, AC-6)", () => {
    for (const v of [undefined, "", "  "]) {
      const c = parseAdsConfig({ [ADS_ENV.client]: v });
      expect(c.client).toBeNull();
      expect(Object.values(c.slots).every((s) => s === null)).toBe(true);
      expect(c.warnings).toEqual([]);
    }
    expect(adsSummary(parseAdsConfig({}))).toBe("ads: off (NEXT_PUBLIC_ADSENSE_CLIENT not set)");
  });

  it("ignores a malformed client with a warning (AC-4)", () => {
    for (const v of ["pub-123", "ca-pub-12x"]) {
      const c = parseAdsConfig({ [ADS_ENV.client]: v, [ADS_ENV.top]: "1111" });
      expect(c.client).toBeNull();
      expect(c.slots.top).toBeNull();
      expect(c.warnings[0]).toContain(`NEXT_PUBLIC_ADSENSE_CLIENT "${v}" ignored`);
      expect(c.warnings[0].startsWith("WARNING ads:")).toBe(true);
    }
  });

  it("accepts a valid client and trims it", () => {
    const c = parseAdsConfig({ [ADS_ENV.client]: `  ${CLIENT} ` });
    expect(c.client).toBe(CLIENT);
    expect(c.warnings).toEqual([]);
    expect(adsSummary(c)).toBe(`ads: on (${CLIENT}; positions: none)`);
  });

  it("turns off only a malformed slot and names it (AC-5)", () => {
    const c = parseAdsConfig({
      [ADS_ENV.client]: CLIENT,
      [ADS_ENV.top]: "1111111111",
      [ADS_ENV.left]: "12a",
      [ADS_ENV.bottom]: "4444444444",
    });
    expect(c.slots).toEqual({ top: "1111111111", left: null, right: null, bottom: "4444444444" });
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toContain("NEXT_PUBLIC_ADSENSE_SLOT_LEFT");
    expect(c.warnings[0]).toContain("the left ad space is off");
    expect(adsSummary(c)).toBe(`ads: on (${CLIENT}; positions: top, bottom)`);
  });

  it("warns when slots are set without a client, and truncates long values", () => {
    const c = parseAdsConfig({ [ADS_ENV.top]: "1111111111" });
    expect(c.client).toBeNull();
    expect(c.slots.top).toBeNull();
    expect(c.warnings).toEqual(["WARNING ads: slot IDs are set but NEXT_PUBLIC_ADSENSE_CLIENT is not; ads are off"]);
    const long = parseAdsConfig({ [ADS_ENV.client]: "x".repeat(100) });
    expect(long.warnings[0]).toContain(`"${"x".repeat(40)}"`);
    expect(long.warnings[0]).not.toContain("x".repeat(41));
  });
});

describe("warning log hygiene (D1)", () => {
  it("escapes control characters, incl. newlines, in echoed env values", () => {
    const r = parseAdsConfig({
      NEXT_PUBLIC_ADSENSE_CLIENT: "ca-pub-1\nWARNING forged\r\u001b[31mx",
      NEXT_PUBLIC_ADSENSE_SLOT_TOP: "12\n34",
    });
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const w of r.warnings) expect(w).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(r.warnings[0]).toContain("\\x0a");
    expect(r.warnings.join("")).toContain("\\x1b");
  });
});

describe("loader and ads.txt", () => {
  it("builds the loader URL from the validated client only", () => {
    expect(adsLoaderSrc(CLIENT)).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`);
  });

  it("writes the exact ads.txt line (AC-25) and nothing when off (AC-6)", () => {
    expect(adsTxtContent(CLIENT)).toBe("google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0\n");
    expect(adsTxtContent(null)).toBeNull();
    expect(adsTxtContent("pub-1")).toBeNull();
  });

  it("keeps the rail breakpoint at 1600", () => {
    expect(RAIL_MIN_WIDTH).toBe(1600);
  });
});

describe("requestAdOnce (AC-9)", () => {
  it("pushes once, then reports done", () => {
    const pushed: object[] = [];
    const q = { push: (i: object) => pushed.push(i) };
    const ins = fakeIns(300);
    expect(requestAdOnce(ins, q)).toBe("pushed");
    expect(requestAdOnce(ins, q)).toBe("done");
    expect(pushed).toHaveLength(1);
  });

  it("does not push a zero-width element", () => {
    expect(requestAdOnce(fakeIns(0), { push: throwing })).toBe("hidden");
  });

  it("treats an element AdSense already processed as done", () => {
    expect(requestAdOnce(fakeIns(300, { "data-adsbygoogle-status": "done" }), { push: throwing })).toBe("done");
  });

  it("swallows a throwing queue", () => {
    expect(requestAdOnce(fakeIns(300), { push: throwing })).toBe("pushed");
  });
});
