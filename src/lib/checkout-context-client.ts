/**
 * a-tg-checkout-context, browser side: the Mini App marker, the context
 * detection and the one hand-off to the hosted Whop page.
 *
 * `window.Telegram.WebApp` exists on any page where TelegramSdkLoader loaded
 * the SDK by user agent, even outside a Mini App (empty initData), so the
 * Mini App is detected from the per-tab marker set at Mini App entry, never
 * from the object.
 */
import { safeSessionStorage } from "@/lib/safe-storage";
import { isStandalonePWA } from "@/lib/telegram-login";
import { TG_CHECKOUT_OPENLINK_BUILD, type CheckoutContext } from "@/lib/checkout-context";

export const TG_WEBAPP_MARKER = "medpruef_tg_webapp";

type TelegramWebApp = {
  initData?: string;
  platform?: string;
  isVersionAtLeast?: (version: string) => boolean;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
};

/** openLink hands the URL to the Telegram client only from Bot API 6.1 on a known platform; older SDKs fall back to window.open. */
function nativeOpenLink(app: TelegramWebApp | null): app is TelegramWebApp & { openLink: (url: string) => void } {
  if (!app || typeof app.openLink !== "function") return false;
  if (!app.platform || app.platform === "unknown") return false;
  try { return typeof app.isVersionAtLeast === "function" && app.isVersionAtLeast("6.1"); } catch { return false; }
}

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

/** Called at Mini App entry (tgWebAppData in the launch hash, or /tg-welcome). */
export function markTelegramWebApp(): void {
  safeSessionStorage.setItem(TG_WEBAPP_MARKER, "1");
}

export function isTelegramWebAppMarked(): boolean {
  return safeSessionStorage.getItem(TG_WEBAPP_MARKER) === "1";
}

export function detectCheckoutContext(): CheckoutContext {
  if (typeof window === "undefined") return "browser";
  if (isTelegramWebAppMarked() || Boolean(webApp()?.initData)) return "tg_webapp";
  if (/Telegram/i.test(navigator.userAgent)) return "tg_inapp";
  if (isStandalonePWA()) return "pwa";
  return "browser";
}

export type OpenCheckoutResult = "navigated" | "opened_external";

/**
 * Opens the hosted checkout. Today's navigation unless the build flag is on,
 * this tab is a marked Mini App and the SDK offers openLink: then Telegram
 * opens the page in the external browser and this page stays (the caller
 * clears its busy state and shows the note with a "open again" button that
 * calls this again inside the tap, in case the first hand-off did nothing).
 */
export function openCheckout(url: string, method: "href" | "assign" = "href"): OpenCheckoutResult {
  const app = webApp();
  if (TG_CHECKOUT_OPENLINK_BUILD && isTelegramWebAppMarked() && nativeOpenLink(app)) {
    try {
      app.openLink(url);
      return "opened_external";
    } catch {
      // Fall through to today's navigation.
    }
  }
  if (method === "assign") window.location.assign(url);
  else window.location.href = url;
  return "navigated";
}
