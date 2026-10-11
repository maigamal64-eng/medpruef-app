"use client";

import { isAdminPath } from "@/lib/admin-route";
import { useEffect } from "react";
import { getCookieConsent } from "@/components/CookieBanner";

/**
 * Loads the Whop Pixel for business `biz_redacted912fd07f` (our live card
 * rail) so on-site behaviour can be attributed to the checkout that happens
 * off-site on whop.com.
 *
 * ── Consent posture: UNGATED by default ([name]'s call, 2026-08-29) ─────
 * This pixel deliberately does NOT sit behind the cookie banner. It loads
 * on every page for every visitor. That is a change from how the Meta and
 * Reddit pixels behave (both strictly opt-in) and it was an explicit
 * product decision, not an oversight, so do not "fix" it back without
 * asking. `NEXT_PUBLIC_WHOP_PIXEL_CONSENT_MODE` switches the behaviour
 * with an env change and a redeploy, no code edit:
 *
 *   unset | "off"   → load always (current default)
 *   "optout"        → load unless the visitor explicitly declined
 *   "optin"         → load only after an explicit accept (Meta/Reddit rule)
 *
 * Worth knowing when revisiting this: `https://t.whop.tw/s.js` loads
 * FingerprintJS and computes a `visitorId` device fingerprint. Our audience
 * is doctors in Austria, so under ePrivacy Art. 5(3) fingerprinting is
 * treated like cookie access. Running ungated puts the weight on the
 * legitimate-interest basis described in the privacy policy (section 9),
 * which is a stronger claim for a fingerprinting pixel than for plain
 * analytics. Flipping to "optin" is a one-env-var retreat if that ever
 * needs to change.
 *
 * Kill switch: NEXT_PUBLIC_WHOP_PIXEL_DISABLED=true makes this a clean
 * no-op (nothing injects, `window.whop` never defined, no console noise).
 *
 * ── SPA route changes ────────────────────────────────────────────────
 * The snippet fires `whop.track("page")` once at load. That is sufficient:
 * the remote `s.js` patches `history.pushState` / `history.replaceState`
 * and listens for `popstate`, so it emits its own page events on client
 * -side navigation (verified against the served bundle). Adding a
 * `TrackRouteChange`-style hook would double-count.
 */

const DISABLED = process.env.NEXT_PUBLIC_WHOP_PIXEL_DISABLED === "true";
const CONSENT_MODE = (
  process.env.NEXT_PUBLIC_WHOP_PIXEL_CONSENT_MODE ?? "off"
).toLowerCase();

/** Does the current consent state permit loading, under CONSENT_MODE? */
function allowedByConsent(): boolean {
  if (CONSENT_MODE === "optin") return getCookieConsent() === "accepted";
  if (CONSENT_MODE === "optout") return getCookieConsent() !== "declined";
  return true; // "off" — ungated, the default
}

/**
 * The official Whop snippet body, copied VERBATIM from the Whop install
 * guide — character for character, including the hard-coded business id.
 * The only adaptation is the wrapper: instead of a literal <script> tag in
 * a static <head>, the same source is injected into <head> from here. Do
 * not reformat, minify, prettify, or template this string; the business id
 * is intentionally inline rather than an env var so the body stays
 * byte-identical to what Whop publishes.
 *
 * Template literal is safe here: the snippet contains no backticks and no
 * `${` sequence, so it is preserved exactly.
 */
const WHOP_PIXEL_SNIPPET = `!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");whop.setScope("biz_redacted912fd07f");whop.track("page");`;

function loadWhopPixel() {
  if (typeof window !== "undefined" && isAdminPath(window.location.pathname)) return;
  if (DISABLED) return;
  if (typeof window === "undefined") return;
  if (
    (window as unknown as { whop?: unknown }).whop ||
    document.getElementById("whop-pixel-loader")
  ) {
    return; // already loaded (the snippet is also self-guarding via w[n])
  }

  const s = document.createElement("script");
  s.id = "whop-pixel-loader";
  s.textContent = WHOP_PIXEL_SNIPPET;
  document.head.appendChild(s);
}

export default function WhopPixel() {
  useEffect(() => {
    if (isAdminPath(window.location.pathname)) return;
    if (DISABLED) return;

    if (allowedByConsent()) loadWhopPixel();

    // Only relevant in the gated modes: a later accept should load the
    // pixel without a reload. In the default ungated mode it already
    // loaded above, and loadWhopPixel() is idempotent regardless.
    if (CONSENT_MODE === "off") return;
    const onConsent = () => {
      if (allowedByConsent()) loadWhopPixel();
    };
    window.addEventListener("medpruef-consent", onConsent);
    return () => window.removeEventListener("medpruef-consent", onConsent);
  }, []);

  return null;
}
