// SPDX-License-Identifier: Apache-2.0
// Google AdSense configuration, read once at build time from NEXT_PUBLIC_ADSENSE_* (public IDs, not secrets).
// Pure: no fs, no DOM globals. Invalid or unset values switch the affected part off; ads are fully off without a client.
export type AdPosition = "top" | "left" | "right" | "bottom";
export const AD_POSITIONS: readonly AdPosition[] = ["top", "left", "right", "bottom"];
export const ADS_ENV = {
  client: "NEXT_PUBLIC_ADSENSE_CLIENT",
  top: "NEXT_PUBLIC_ADSENSE_SLOT_TOP",
  left: "NEXT_PUBLIC_ADSENSE_SLOT_LEFT",
  right: "NEXT_PUBLIC_ADSENSE_SLOT_RIGHT",
  bottom: "NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM",
} as const;
/** px; the CSS media query for the side rails uses the same literal (test-pinned). */
export const RAIL_MIN_WIDTH = 1600;
export const GOOGLE_CERT_AUTHORITY_ID = "f08c47fec0942fa0";
/**
 * The owner's AdSense publisher ID (public). It always goes into the `google-adsense-account` meta tag and ads.txt, so
 * Google can verify the site and authorise its inventory before any ad slot exists; NEXT_PUBLIC_ADSENSE_CLIENT still
 * decides whether the ad loader and slots render.
 */
export const ADSENSE_PUBLISHER_ID = "ca-pub-9686181545299385";

export interface AdsConfig {
  client: string | null;
  slots: Record<AdPosition, string | null>;
  warnings: string[];
}

const CLIENT_RE = /^ca-pub-\d+$/;
const SLOT_RE = /^\d+$/;
const LOADER_HOST = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

// Truncate, then escape control characters (incl. CR/LF, DEL, C1) so an env value cannot forge or split log lines.
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]", "g");
const show = (v: string): string =>
  v.slice(0, 40).replace(CONTROL_RE, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

export function parseAdsConfig(env: Partial<Record<string, string | undefined>>): AdsConfig {
  const warnings: string[] = [];
  const slots: Record<AdPosition, string | null> = { top: null, left: null, right: null, bottom: null };
  const clientRaw = (env[ADS_ENV.client] ?? "").trim();
  const rawSlots = {} as Record<AdPosition, string>;
  for (const pos of AD_POSITIONS) rawSlots[pos] = (env[ADS_ENV[pos]] ?? "").trim();

  if (clientRaw && !CLIENT_RE.test(clientRaw)) {
    warnings.push(`WARNING ads: ${ADS_ENV.client} "${show(clientRaw)}" ignored: expected ca-pub- followed by digits; ads are off`);
  }
  const client = CLIENT_RE.test(clientRaw) ? clientRaw : null;

  for (const pos of AD_POSITIONS) {
    const v = rawSlots[pos];
    if (!v) continue;
    if (!SLOT_RE.test(v)) {
      warnings.push(`WARNING ads: ${ADS_ENV[pos]} "${show(v)}" ignored: expected digits only; the ${pos} ad space is off`);
    } else if (client) {
      slots[pos] = v;
    }
  }
  if (!clientRaw && AD_POSITIONS.some((p) => SLOT_RE.test(rawSlots[p]))) {
    warnings.push(`WARNING ads: slot IDs are set but ${ADS_ENV.client} is not; ads are off`);
  }
  return { client, slots, warnings };
}

let memo: AdsConfig | undefined;
/** Memoized. Literal `process.env.NEXT_PUBLIC_*` reads so Next inlines them; no dynamic indexing. */
export function getAdsConfig(): AdsConfig {
  memo ??= parseAdsConfig({
    NEXT_PUBLIC_ADSENSE_CLIENT: process.env.NEXT_PUBLIC_ADSENSE_CLIENT,
    NEXT_PUBLIC_ADSENSE_SLOT_TOP: process.env.NEXT_PUBLIC_ADSENSE_SLOT_TOP,
    NEXT_PUBLIC_ADSENSE_SLOT_LEFT: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LEFT,
    NEXT_PUBLIC_ADSENSE_SLOT_RIGHT: process.env.NEXT_PUBLIC_ADSENSE_SLOT_RIGHT,
    NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM: process.env.NEXT_PUBLIC_ADSENSE_SLOT_BOTTOM,
  });
  return memo;
}

export function adsLoaderSrc(client: string): string {
  return `${LOADER_HOST}?client=${client}`;
}

/** The one ads.txt line for a valid client ("ca-pub-123" -> "pub-123"), or null when ads are off. */
export function adsTxtContent(client: string | null): string | null {
  if (!client || !CLIENT_RE.test(client)) return null;
  return `google.com, ${client.slice(3)}, DIRECT, ${GOOGLE_CERT_AUTHORITY_ID}\n`;
}

export function adsSummary(cfg: AdsConfig): string {
  if (!cfg.client) return `ads: off (${ADS_ENV.client} not set)`;
  const on = AD_POSITIONS.filter((p) => cfg.slots[p]);
  return `ads: on (${cfg.client}; positions: ${on.length ? on.join(", ") : "none"})`;
}

export type AdQueue = { push(item: object): unknown };

/**
 * `adsbygoogle.push({})` fills the first unprocessed <ins>, so push exactly once per visible element.
 * "done": already processed or pushed; "hidden": zero width (no push, avoids availableWidth=0 TagError).
 */
export function requestAdOnce(
  ins: { offsetWidth: number; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void },
  queue: AdQueue,
): "pushed" | "hidden" | "done" {
  if (ins.getAttribute("data-adsbygoogle-status") !== null || ins.getAttribute("data-winlot-pushed") !== null) return "done";
  if (ins.offsetWidth === 0) return "hidden";
  ins.setAttribute("data-winlot-pushed", "1");
  try {
    queue.push({});
  } catch {
    /* blocked or failed loader: content is unaffected */
  }
  return "pushed";
}
