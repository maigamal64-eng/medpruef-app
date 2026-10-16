import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type WebAppStub = { initData?: string; platform?: string; isVersionAtLeast?: (v: string) => boolean; openLink?: (u: string) => void };
type Win = Window & { Telegram?: { WebApp?: WebAppStub } };
const NATIVE = { platform: "ios", isVersionAtLeast: () => true };

async function load(flag: boolean) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TG_CHECKOUT_OPENLINK", flag ? "true" : "");
  return import("@/lib/checkout-context-client");
}

let href: string;
let assign: ReturnType<typeof vi.fn>;
let ua: string;
let standalone: boolean;
let store: Map<string, string>;
let win: Win & Record<string, unknown>;
beforeEach(() => {
  href = ""; assign = vi.fn(); ua = "Mozilla/5.0 Chrome"; standalone = false; store = new Map();
  const nav = { get userAgent() { return ua; } };
  win = {
    location: { get href() { return href; }, set href(v: string) { href = v; }, assign, search: "", hash: "" },
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } },
    navigator: nav,
    matchMedia: () => ({ matches: standalone }),
  } as unknown as Win & Record<string, unknown>;
  vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", nav);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("detectCheckoutContext", () => {
  it("marker or initData means tg_webapp; the SDK object alone does not", async () => {
    const m = await load(false);
    win.Telegram = { WebApp: { initData: "", openLink: vi.fn() } };
    expect(m.detectCheckoutContext()).toBe("browser");
    m.markTelegramWebApp();
    expect(m.detectCheckoutContext()).toBe("tg_webapp");
    store.clear();
    win.Telegram = { WebApp: { initData: "query_id=1" } };
    expect(m.detectCheckoutContext()).toBe("tg_webapp");
  });
  it("Telegram user agent is tg_inapp, standalone is pwa, else browser", async () => {
    const m = await load(false);
    ua = "Mozilla/5.0 Telegram-Android/11.2";
    expect(m.detectCheckoutContext()).toBe("tg_inapp");
    ua = "Mozilla/5.0 Safari";
    standalone = true;
    expect(m.detectCheckoutContext()).toBe("pwa");
    standalone = false;
    expect(m.detectCheckoutContext()).toBe("browser");
  });
});

describe("openCheckout", () => {
  it("flag off: today's navigation even in a marked Mini App", async () => {
    const m = await load(false);
    const openLink = vi.fn();
    win.Telegram = { WebApp: { initData: "x", ...NATIVE, openLink } };
    m.markTelegramWebApp();
    expect(m.openCheckout("https://whop.com/c/1")).toBe("navigated");
    expect(href).toBe("https://whop.com/c/1");
    expect(m.openCheckout("https://whop.com/c/2", "assign")).toBe("navigated");
    expect(assign).toHaveBeenCalledWith("https://whop.com/c/2");
    expect(openLink).not.toHaveBeenCalled();
  });
  it("flag on + marked Mini App: openLink, no navigation", async () => {
    const m = await load(true);
    const openLink = vi.fn();
    win.Telegram = { WebApp: { initData: "x", ...NATIVE, openLink } };
    m.markTelegramWebApp();
    expect(m.openCheckout("https://whop.com/c/1")).toBe("opened_external");
    expect(openLink).toHaveBeenCalledWith("https://whop.com/c/1");
    expect(href).toBe("");
  });
  it("flag on but no marker, no openLink, or a throwing bridge: navigation", async () => {
    const m = await load(true);
    const openLink = vi.fn();
    win.Telegram = { WebApp: { initData: "", ...NATIVE, openLink } };
    expect(m.openCheckout("https://whop.com/a")).toBe("navigated");
    expect(openLink).not.toHaveBeenCalled();
    m.markTelegramWebApp();
    win.Telegram = { WebApp: { initData: "x" } };
    expect(m.openCheckout("https://whop.com/b")).toBe("navigated");
    win.Telegram = { WebApp: { initData: "x", ...NATIVE, openLink: () => { throw new Error("old client"); } } };
    expect(m.openCheckout("https://whop.com/c")).toBe("navigated");
    expect(href).toBe("https://whop.com/c");
  });
  it("flag on + marker but an SDK older than 6.1 or an unknown platform: navigation (no window.open fallback)", async () => {
    const m = await load(true);
    const openLink = vi.fn();
    m.markTelegramWebApp();
    win.Telegram = { WebApp: { initData: "x", platform: "ios", isVersionAtLeast: () => false, openLink } };
    expect(m.openCheckout("https://whop.com/old")).toBe("navigated");
    win.Telegram = { WebApp: { initData: "x", platform: "unknown", isVersionAtLeast: () => true, openLink } };
    expect(m.openCheckout("https://whop.com/web")).toBe("navigated");
    win.Telegram = { WebApp: { initData: "x", platform: "android", openLink } };
    expect(m.openCheckout("https://whop.com/noversion")).toBe("navigated");
    expect(openLink).not.toHaveBeenCalled();
  });
});
