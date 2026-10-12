import { describe, expect, it } from "vitest";
import {
  detectIos,
  detectIosBrowser,
  iosInstallSteps,
  isStandalone,
  resolveIosInstallState,
} from "@/lib/master-pwa/ios-install";

const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1";
const INSTAGRAM_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0";
const IPADOS_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Mobile Safari/537.36";

describe("ios detection", () => {
  it("detects iPhone, iPad and iPadOS desktop UA with touch", () => {
    expect(detectIos({ userAgent: SAFARI_IPHONE })).toBe(true);
    expect(detectIos({ userAgent: IPADOS_DESKTOP, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });
  it("does not flag a real Mac or Android", () => {
    expect(detectIos({ userAgent: IPADOS_DESKTOP, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(detectIos({ userAgent: ANDROID })).toBe(false);
  });
  it("classifies browsers", () => {
    expect(detectIosBrowser({ userAgent: SAFARI_IPHONE })).toBe("safari");
    expect(detectIosBrowser({ userAgent: CHROME_IPHONE })).toBe("chrome");
    expect(detectIosBrowser({ userAgent: INSTAGRAM_IPHONE })).toBe("in-app");
  });
});

describe("install state", () => {
  it("resolves each state", () => {
    expect(resolveIosInstallState({ userAgent: ANDROID })).toBe("not-ios");
    expect(resolveIosInstallState({ userAgent: SAFARI_IPHONE })).toBe("ready");
    expect(resolveIosInstallState({ userAgent: CHROME_IPHONE })).toBe("ready");
    expect(resolveIosInstallState({ userAgent: INSTAGRAM_IPHONE })).toBe("in-app-browser");
    expect(resolveIosInstallState({ userAgent: SAFARI_IPHONE, navigatorStandalone: true })).toBe("installed");
    expect(resolveIosInstallState({ userAgent: SAFARI_IPHONE, displayModeStandalone: true })).toBe("installed");
  });
  it("standalone needs an explicit true", () => {
    expect(isStandalone({ userAgent: SAFARI_IPHONE })).toBe(false);
    expect(isStandalone({ userAgent: SAFARI_IPHONE, navigatorStandalone: false })).toBe(false);
  });
  it("lists four ordered steps", () => {
    expect(iosInstallSteps("safari")).toEqual(["open-share", "add-to-home", "confirm", "open-from-home"]);
  });
});
