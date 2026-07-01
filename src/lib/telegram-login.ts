/**
 * Client-side helpers for the Telegram bot deep-link login, with the
 * mobile-PWA hand-off (FB-08, 2026-07-01).
 *
 * ── The mobile-PWA problem this solves ──────────────────────────────
 * The bot returns a login button whose URL is a plain https link to
 * `/?tg_token=<uuid>`. On a phone, tapping that link inside Telegram
 * opens Telegram's OWN in-app browser (an ephemeral WebView with its
 * own, isolated storage), NOT the user's real browser and NOT the
 * installed PWA where they actually study. If the token is exchanged
 * inside that WebView, the signed session lands in the WebView's
 * localStorage and the PWA never sees it — so the user "logs in" and
 * is still logged out in the app.
 *
 * There is no cross-context hand-off API: an installed PWA cannot be
 * launched *with a payload* from a foreign WebView (start_url is
 * static; storage is partitioned; Telegram intercepts the tap into its
 * own WebView rather than the OS intent resolver). So the ONLY robust
 * fix is to carry the credential across contexts by hand: the bot
 * shows the one-time token as a copyable code, and the user pastes it
 * into the app (the PWA), where the exchange runs and the session mints
 * in the RIGHT storage context.
 *
 * Security is unchanged: the pasted code is the same single-use,
 * 10-minute-TTL token, exchanged through the same already-audited
 * `/api/auth` `tokenExchange` path. No new trust surface — the code is
 * the full UUID (never a short guessable PIN).
 */

/**
 * True when the page is running as an installed PWA (standalone
 * display) rather than inside a browser tab or a foreign WebView.
 *
 * - `matchMedia('(display-mode: standalone)')` covers Android/desktop
 *   installed PWAs and standard standalone launches.
 * - `navigator.standalone` is the iOS-Safari-specific flag for a
 *   home-screen web app (iOS does not report the display-mode media
 *   query reliably for legacy installs).
 *
 * Used to decide whether a `?tg_token=` load should auto-exchange (safe
 * in the PWA / a real browser — the session persists where the user
 * is) or instead surface the copy-code hand-off (a mobile WebView,
 * where the session would be trapped).
 */
export function isStandalonePWA(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const mql =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches;
    const iosStandalone =
      (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true;
    return Boolean(mql || iosStandalone);
  } catch {
    return false;
  }
}

/**
 * Touch-first device check, used ONLY to decide whether a `?tg_token=`
 * load should default to the paste-code hand-off screen.
 *
 * We deliberately gate on CAPABILITY (`pointer: coarse`), not the user
 * agent. UA sniffing silently reintroduces the original bug on devices
 * that report a desktop UA while running a touch browser — most notably
 * iPadOS Safari, which since iPadOS 13 sends a macOS-like UA with no
 * "iPad"/"Mobile" token. A UA check there returns "desktop" → we would
 * auto-exchange inside Telegram's in-app WebView and trap the session,
 * exactly the failure FB-08 fixes. `matchMedia('(pointer: coarse)')`
 * catches phones, tablets, AND iPadOS regardless of UA string.
 *
 * The only cost is a touchscreen LAPTOP (coarse-capable but a real
 * browser): it would see the hand-off screen and can tap "continue in
 * this browser" to sign in normally — a soft, one-tap detour, far
 * better than a silently trapped session. This is non-security-bearing:
 * the escape hatch and the paste path perform the identical audited
 * exchange either way.
 */
export function isTouchFirstDevice(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (typeof window.matchMedia === "function") {
      if (window.matchMedia("(pointer: coarse)").matches) return true;
      // Some tablets expose no `pointer` support at all; treat "no fine
      // pointer" + a touch API as touch-first too.
      const noFinePointer = window.matchMedia("(any-pointer: fine)").matches === false;
      const hasTouch =
        "ontouchstart" in window ||
        (navigator.maxTouchPoints ?? 0) > 0;
      if (noFinePointer && hasTouch) return true;
    }
    // Last-resort fallback when matchMedia is unavailable: touch points.
    return (navigator.maxTouchPoints ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Shape of a Telegram login token (the code the bot hands the user, and
 * the value in `?tg_token=`). The token is the full UUID minted in the
 * webhook — validating the shape client-side lets the paste field
 * reject obvious junk before a round-trip (server still re-validates).
 */
const TG_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `value` looks like a well-formed Telegram login token. */
export function looksLikeLoginCode(value: string): boolean {
  return TG_TOKEN_RE.test(value.trim());
}

/**
 * Normalise pasted input into a bare token: trim, lowercase, and —
 * defensively — pull a UUID out of a full pasted URL in case the user
 * copied the whole `https://medpruf.com/?tg_token=<uuid>` link instead
 * of just the code. Returns "" when no token-shaped substring is found.
 */
export function extractLoginCode(input: string): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  const direct = raw.toLowerCase();
  if (TG_TOKEN_RE.test(direct)) return direct;
  const m = direct.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  return m ? m[0].toLowerCase() : "";
}
