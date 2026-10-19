import { afterEach, describe, expect, it, vi } from "vitest";
import {
  captureAttributionFromUrl,
  captureTypedCodeAttribution,
  getStoredAttribution,
  referrerSource,
} from "@/lib/attribution";
import { FIRST_TOUCH_KEY_RE, deriveFirstTouch, firstTouchFromAttribution, leverOf } from "@/lib/first-touch";

describe("referrerSource", () => {
  it("names Telegram hosts and the Telegram Android apps", () => {
    for (const r of [
      "https://t.me/medpruef/123",
      "https://T.ME/",
      "https://telegram.me/x",
      "https://web.telegram.org/k/#@medpruef",
      "https://telegram.org/",
      "android-app://org.telegram.messenger/",
      "android-app://org.telegram.messenger.web/",
      "android-app://org.thunderdog.challegram/",
    ]) expect(referrerSource(r), r).toBe("telegram");
  });
  it("names Facebook hosts and the Facebook Android apps", () => {
    for (const r of [
      "https://www.facebook.com/groups/1",
      "https://l.facebook.com/l.php?u=https%3A%2F%2Fmedpruf.com",
      "https://lm.facebook.com/",
      "https://m.facebook.com/",
      "https://fb.com/x",
      "https://fb.me/x",
      "android-app://com.facebook.katana/",
      "android-app://com.facebook.orca/",
    ]) expect(referrerSource(r), r).toBe("facebook");
  });
  it("ignores look-alikes, other hosts, other schemes and junk", () => {
    for (const r of [
      "",
      "https://medpruf.com/landing",
      "https://www.google.com/",
      "https://notfacebook.com/",
      "https://facebook.com.evil.example/",
      "https://t.me.evil.example/",
      "https://evilt.me/",
      "https://instagram.com/",
      "javascript:alert(1)",
      "android-app://org.telegramx.fake/",
      "file:///t.me",
      "not a url",
      "https://t.me/" + "a".repeat(3000),
    ]) expect(referrerSource(r), r).toBeNull();
    expect(referrerSource(undefined)).toBeNull();
    expect(referrerSource(42)).toBeNull();
  });
});

const KEY = "medpruef_attribution";
let store: Map<string, string>;
function fakeBrowser(pathname: string, search = "", referrer = "", keep = false) {
  if (!keep) store = new Map<string, string>();
  vi.stubGlobal("window", {
    location: { pathname, search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  vi.stubGlobal("document", { referrer });
}

describe("first-touch capture from a referrer", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("an untagged arrival from t.me records telegram / referral", () => {
    fakeBrowser("/", "", "https://t.me/medpruef/42");
    captureAttributionFromUrl();
    const a = getStoredAttribution();
    expect(a).toMatchObject({ utm_source: "telegram", utm_medium: "referral" });
    expect(a?.utm_campaign).toBeUndefined();
  });
  it("keeps the answer page as the campaign and Facebook as the source", () => {
    fakeBrowser("/blog/sip4a-vorbereitung", "", "https://l.facebook.com/l.php?u=x");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "facebook", utm_medium: "referral", utm_campaign: "blog:sip4a-vorbereitung" });
  });
  it("never stores the referrer URL or host", () => {
    fakeBrowser("/landing", "", "https://web.telegram.org/k/#@secret-group-name");
    captureAttributionFromUrl();
    const raw = store.get(KEY) ?? "";
    expect(raw).not.toMatch(/telegram\.org|secret-group-name|https?:/);
  });
  it("utm params beat the referrer", () => {
    fakeBrowser("/", "?utm_source=telegram&utm_medium=post&utm_campaign=fristen-19-okt", "https://t.me/x");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen-19-okt" });
  });
  it("a referrer replaces an organic arrival record, a later utm link replaces the referrer", () => {
    fakeBrowser("/blog/x");
    captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_source).toBe("arrival");
    fakeBrowser("/", "", "https://t.me/x", true);
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "telegram", utm_medium: "referral" });
    fakeBrowser("/", "?utm_source=reddit&utm_campaign=c1", "", true);
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "reddit", utm_campaign: "c1" });
  });
  it("a referrer never replaces a referrer, a campaign link or a code; an arrival never replaces a referrer", () => {
    fakeBrowser("/", "", "https://t.me/x");
    captureAttributionFromUrl();
    fakeBrowser("/", "", "https://facebook.com/", true);
    captureAttributionFromUrl();
    fakeBrowser("/lernplan", "", "", true);
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "telegram", utm_medium: "referral" });

    fakeBrowser("/", "?utm_source=reddit");
    captureAttributionFromUrl();
    fakeBrowser("/", "", "https://t.me/x", true);
    captureAttributionFromUrl();
    expect(getStoredAttribution()?.utm_source).toBe("reddit");

    fakeBrowser("/");
    captureTypedCodeAttribution("WIEN26");
    fakeBrowser("/", "", "https://t.me/x", true);
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toMatchObject({ utm_source: "code", utm_campaign: "wien26" });
  });
  it("a typed code replaces a referrer record", () => {
    fakeBrowser("/", "", "https://t.me/x");
    captureAttributionFromUrl();
    captureTypedCodeAttribution("WIEN26");
    expect(getStoredAttribution()).toMatchObject({ utm_source: "code", utm_medium: "typed", utm_campaign: "wien26" });
  });
  it("records nothing for an untagged arrival from any other host", () => {
    fakeBrowser("/", "", "https://www.google.com/");
    captureAttributionFromUrl();
    expect(getStoredAttribution()).toBeNull();
  });
});

describe("first-touch key of a referrer record", () => {
  it("telegram referral is tg_ref (Telegram lever), facebook referral is fb_ref", () => {
    const tg = firstTouchFromAttribution({ utm_source: "telegram", utm_medium: "referral", utm_campaign: "blog:x" });
    expect(tg).toEqual({ key: "tg_ref", basis: "referral" });
    expect(leverOf("tg_ref")).toBe("telegram");
    const fb = firstTouchFromAttribution({ utm_source: "facebook", utm_medium: "referral" });
    expect(fb).toEqual({ key: "fb_ref", basis: "referral" });
    expect(leverOf("fb_ref")).toBe("other_campaign");
    for (const k of ["tg_ref", "fb_ref"]) expect(FIRST_TOUCH_KEY_RE.test(k)).toBe(true);
    expect(FIRST_TOUCH_KEY_RE.test("tg_ref:t.me")).toBe(false);
  });
  it("a tagged Telegram post keeps its own key, and the stored record still beats the start parameter", () => {
    expect(firstTouchFromAttribution({ utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen" })?.key).toBe("tg_post:fristen");
    expect(deriveFirstTouch({ attribution: { utm_source: "telegram", utm_medium: "referral" }, startParam: "c_fristen" })?.key).toBe("tg_ref");
  });
});
