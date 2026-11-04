// SPDX-License-Identifier: Apache-2.0
'use client'
import type { MouseEvent } from 'react'

/** Where the link goes when there is no Google consent platform (ads off, 404, Contact, or the message not published). */
export const CONSENT_SETTINGS_HREF = '/privacy#pp-eea'
export const CONSENT_SETTINGS_LABEL = 'Privacy and cookie settings'

/** The documented globals Google's consent platform exposes once the owner publishes the consent message. */
export type GoogleFc = { callbackQueue?: Array<() => void>; showRevocationMessage?: () => void }
export type TcfApi = (cmd: 'ping', version: 2, cb: (data?: { gdprApplies?: boolean }) => void) => void
export type ConsentWindow = {
  googlefc?: GoogleFc
  __tcfapi?: TcfApi
  location: Pick<Location, 'assign'>
}

declare global {
  interface Window {
    googlefc?: GoogleFc
    __tcfapi?: TcfApi
  }
}

/**
 * What a click does, separated from React so it can be tested without a DOM.
 * - No Google consent platform: returns false and the browser follows the href to the Privacy section.
 * - Platform present: prevents the navigation, asks TCF whether GDPR applies; yes -> Google's own message is reopened
 *   through its callback queue, no -> the Privacy section is opened by hand (Google shows no message outside the EEA).
 * The default is prevented only after the platform is confirmed, so a missing `ping` still navigates.
 */
export function handleConsentClick(e: Pick<MouseEvent<HTMLAnchorElement>, 'preventDefault'>, win: ConsentWindow): boolean {
  const fc = win.googlefc
  const tcf = win.__tcfapi
  if (!fc?.callbackQueue || typeof tcf !== 'function') return false
  e.preventDefault()
  tcf('ping', 2, (data) => {
    if (data?.gdprApplies) fc.callbackQueue?.push(() => win.googlefc?.showRevocationMessage?.())
    else win.location.assign(CONSENT_SETTINGS_HREF)
  })
  return true
}

/**
 * Footer link "Privacy and cookie settings": a plain link to the Privacy page's EEA section, progressively enhanced to
 * reopen Google's consent message when its platform is on the page (ADR-008). Rendered on every page, ads on or off,
 * so the Privacy page's promise about the link is always true. Never touches lib/ads.ts.
 */
export function ConsentSettingsLink() {
  return (
    <a href={CONSENT_SETTINGS_HREF} onClick={(e) => handleConsentClick(e, window)}>
      {CONSENT_SETTINGS_LABEL}
    </a>
  )
}
