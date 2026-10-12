/**
 * Cookie consent copy and storage contract (UX-GLOBAL-13).
 *
 * The banner text follows the production tracking mode, read at build time
 * from NEXT_PUBLIC_TRACKING_OPTOUT (the same flag ConsentGatedAnalytics uses):
 *   opt-out mode  analytics run until the visitor declines: "Ablehnen" + "OK"
 *   opt-in mode   analytics run only after consent: "Ablehnen" + "Zustimmen"
 * Both link "Mehr erfahren" to /privacy, where the tools are named. One
 * string key per mode; nothing claims a mode the build does not run.
 *
 * A decline must persist even when storage is blocked (ONB-46), so the
 * choice is mirrored into a first-party cookie.
 */

import type { TranslationKey } from './i18n'

export const TRACKING_OPT_OUT = process.env.NEXT_PUBLIC_TRACKING_OPTOUT === 'true'

export const CONSENT_STORAGE_KEY = 'medpruef_cookies'
export const CONSENT_COOKIE = 'mp_consent'

export type ConsentMode = 'optout' | 'optin'
/**
 * 'acknowledged' is the opt-out mode "OK": analytics stay on (they run until
 * declined) but it is NOT consent for the advertising pixels, which stay
 * strictly opt-in and only load on 'accepted'.
 */
export type ConsentValue = 'accepted' | 'declined' | 'acknowledged'

export function consentMode(optOut: boolean = TRACKING_OPT_OUT): ConsentMode {
  return optOut ? 'optout' : 'optin'
}

/** The stored value for the bar's affirmative button in each mode. */
export function affirmativeConsent(mode: ConsentMode): ConsentValue {
  return mode === 'optout' ? 'acknowledged' : 'accepted'
}

/** i18n keys for the banner, per mode. */
export function consentCopyKeys(mode: ConsentMode): { body: TranslationKey; decline: TranslationKey; accept: TranslationKey; more: TranslationKey } {
  return mode === 'optout'
    ? { body: 'cookie_optout_body', decline: 'cookie_decline', accept: 'cookie_ok', more: 'cookie_more' }
    : { body: 'cookie_optin_body', decline: 'cookie_decline', accept: 'cookie_agree', more: 'cookie_more' }
}

/** Parse the consent cookie value out of document.cookie. */
export function consentFromCookie(cookie: string): ConsentValue | null {
  const row = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
  const value = row?.slice(CONSENT_COOKIE.length + 1)
  return value === 'accepted' || value === 'declined' || value === 'acknowledged' ? value : null
}

/**
 * Runs in <head> before first paint: reserve the banner's height when no
 * choice is stored, so it never slides over content (ONB-03/05).
 */
export const CONSENT_HEAD_SCRIPT = `(function(){var d=document.documentElement;try{var v=localStorage.getItem('${CONSENT_STORAGE_KEY}');if(v==='accepted'||v==='declined'||v==='acknowledged')return}catch(e){}if(/(?:^|; )${CONSENT_COOKIE}=(accepted|declined|acknowledged)/.test(document.cookie))return;d.classList.add('mp-consent-pending')})()`
