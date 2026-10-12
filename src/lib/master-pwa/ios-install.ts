/**
 * Pure iOS install detection for the install guide. No DOM access: callers pass
 * a plain environment snapshot (see readInstallEnv) so every branch is unit-testable.
 */

export interface InstallEnv {
  userAgent: string;
  /** navigator.platform, used for iPadOS 13+ which reports a Mac user agent. */
  platform?: string;
  maxTouchPoints?: number;
  /** navigator.standalone (iOS Safari only). */
  navigatorStandalone?: boolean;
  /** matchMedia("(display-mode: standalone)").matches */
  displayModeStandalone?: boolean;
}

export type IosBrowser = "safari" | "chrome" | "firefox" | "edge" | "in-app" | "other";

export type IosInstallState =
  | "not-ios"
  | "installed"
  | "in-app-browser"
  | "ready";

export type IosInstallStepId = "open-share" | "add-to-home" | "confirm" | "open-from-home";

const IN_APP_MARKERS = [
  "FBAN",
  "FBAV",
  "FB_IAB",
  "Instagram",
  "Line/",
  "MicroMessenger",
  "musical_ly",
  "BytedanceWebview",
  "Snapchat",
  "LinkedInApp",
];

export function detectIos(env: InstallEnv): boolean {
  const ua = env.userAgent ?? "";
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return true;
  // iPadOS 13+ sends a desktop Mac user agent; touch support gives it away.
  return env.platform === "MacIntel" && (env.maxTouchPoints ?? 0) > 1;
}

export function detectIosBrowser(env: InstallEnv): IosBrowser {
  const ua = env.userAgent ?? "";
  if (IN_APP_MARKERS.some((marker) => ua.includes(marker))) return "in-app";
  if (/\bCriOS\b/.test(ua)) return "chrome";
  if (/\bFxiOS\b/.test(ua)) return "firefox";
  if (/\bEdgiOS\b/.test(ua)) return "edge";
  if (/\bSafari\b/.test(ua) || /\bVersion\/[\d.]+/.test(ua)) return "safari";
  return "other";
}

export function isStandalone(env: InstallEnv): boolean {
  return env.navigatorStandalone === true || env.displayModeStandalone === true;
}

export function resolveIosInstallState(env: InstallEnv): IosInstallState {
  if (!detectIos(env)) return "not-ios";
  if (isStandalone(env)) return "installed";
  // Unknown iOS user agents (no Safari or Version token) are embedded WebViews that cannot install.
  const browser = detectIosBrowser(env);
  if (browser === "in-app" || browser === "other") return "in-app-browser";
  return "ready";
}

/** Ordered steps; the wording lives in copy.ts so DE and EN stay together. */
export function iosInstallSteps(): IosInstallStepId[] {
  return ["open-share", "add-to-home", "confirm", "open-from-home"];
}

export function readInstallEnv(): InstallEnv {
  if (typeof navigator === "undefined") return { userAgent: "" };
  const nav = navigator as Navigator & { standalone?: boolean };
  let displayModeStandalone = false;
  try {
    displayModeStandalone =
      typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches === true;
  } catch {
    displayModeStandalone = false;
  }
  return {
    userAgent: nav.userAgent ?? "",
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    navigatorStandalone: nav.standalone,
    displayModeStandalone,
  };
}
