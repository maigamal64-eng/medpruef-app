/**
 * Install and launch counting (LX-12 events, LX-13 standalone launch).
 * Pure helpers; the effects live in PWAInstall.
 */
import { detectIos, type InstallEnv, isStandalone } from "./ios-install";

export type PwaPlatform = "ios" | "android" | "desktop";

export const STANDALONE_SESSION_KEY = "medpruef_standalone_launch_sent";
export const OFFLINE_PAGE_MARKER_KEY = "medpruef_offline_page_shown";

export function pwaPlatform(env: InstallEnv): PwaPlatform {
  if (detectIos(env)) return "ios";
  return /Android/i.test(env.userAgent ?? "") ? "android" : "desktop";
}

/** One standalone_launch per browser session, only when running as an installed app. */
export function shouldCountStandaloneLaunch(env: InstallEnv, alreadySent: boolean): boolean {
  return !alreadySent && isStandalone(env);
}

/** The manifest start_url carries ?source=pwa; anything else is a launch from inside the app. */
export function launchSource(search: string): "start_url" | "other" {
  try {
    return new URLSearchParams(search).get("source") === "pwa" ? "start_url" : "other";
  } catch {
    return "other";
  }
}

/** Count written by public/offline.html while offline; a positive integer or 0. */
export function readOfflinePageMarker(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}
