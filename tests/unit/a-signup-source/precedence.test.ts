/**
 * a-signup-source-1029: the precedence of deriveSignupSource, the referrer
 * host rule and the key shape (mirrored by the migration CHECK).
 */
import { describe, expect, it } from "vitest";
import {
  SIGNUP_SOURCE_RE,
  deriveSignupSource,
  isAppShellUserAgent,
  normalizeRefHost,
  refChannel,
  refHostFromReferrer,
  signupSourceEnabled,
} from "@/lib/signup-source";

const UTM = { utm_source: "Reddit Ads", utm_medium: "cpc", utm_campaign: "oct" };
const CODE = { utm_source: "code", utm_medium: "typed", utm_campaign: "ARZT24" };
const GRATIS = { utm_source: "arrival", utm_medium: "organic", utm_campaign: "gratis:arzt24" };
const BLOG = { utm_source: "arrival", utm_medium: "organic", utm_campaign: "blog:anerkennung" };
const TG_REF = { utm_source: "telegram", utm_medium: "referral", utm_campaign: "lernplan" };
const APP_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 MedPrufApp/1.0";

/** Every signal at once; each case below drops the stronger ones. */
const ALL = {
  attribution: UTM,
  pendingReferral: true,
  startParam: "c_fristen",
  hint: "tg_welcome",
  telegramMethod: "miniapp" as const,
  refHost: "google.com",
  userAgent: APP_UA,
};

describe("deriveSignupSource precedence", () => {
  it("1. a utm link wins over everything", () => {
    expect(deriveSignupSource(ALL)).toEqual({ key: "utm:reddit-ads", basis: "utm" });
  });

  it("a tagged Telegram post or bot link keeps its utm shape", () => {
    expect(deriveSignupSource({ ...ALL, attribution: { utm_source: "telegram", utm_medium: "post", utm_campaign: "Fristen" } }))
      .toEqual({ key: "tg_post:fristen", basis: "utm" });
  });

  it("2. a typed or partner code beats a referral, Telegram, referrer, app and direct", () => {
    expect(deriveSignupSource({ ...ALL, attribution: CODE })).toEqual({ key: "code:arzt24", basis: "code" });
    expect(deriveSignupSource({ ...ALL, attribution: GRATIS })).toEqual({ key: "gratis:arzt24", basis: "code" });
  });

  it("2. a pending referral code is stored as its kind only, never the code", () => {
    expect(deriveSignupSource({ ...ALL, attribution: null })).toEqual({ key: "referral", basis: "code" });
    expect(deriveSignupSource({ ...ALL, attribution: BLOG })).toEqual({ key: "referral", basis: "code" });
    // Only the literal true counts.
    expect(deriveSignupSource({ ...ALL, attribution: null, pendingReferral: "ABC123" }).key).toBe("tg_start:fristen");
  });

  it("3. Telegram signed signals: start param, then the welcome hint", () => {
    const tg = { ...ALL, attribution: BLOG, pendingReferral: false };
    expect(deriveSignupSource(tg)).toEqual({ key: "tg_start:fristen", basis: "telegram" });
    expect(deriveSignupSource({ ...tg, startParam: null })).toEqual({ key: "tg_welcome", basis: "telegram" });
  });

  it("4 before 5: a stored arrival page or referrer record beats the bare Telegram method", () => {
    expect(deriveSignupSource({ attribution: TG_REF, telegramMethod: "bot_deeplink" })).toEqual({ key: "tg_ref", basis: "referrer" });
    expect(deriveSignupSource({ attribution: BLOG, telegramMethod: "miniapp" })).toEqual({ key: "blog:anerkennung", basis: "referrer" });
    expect(deriveSignupSource({ refHost: "google.at", telegramMethod: "miniapp" }).key).toBe("ref:google");
  });

  it("5. the Telegram sign-in method when nothing names a lever", () => {
    expect(deriveSignupSource({ telegramMethod: "miniapp", userAgent: APP_UA })).toEqual({ key: "tg:miniapp", basis: "telegram" });
    expect(deriveSignupSource({ telegramMethod: "bot_deeplink" }).key).toBe("tg:bot_deeplink");
  });

  it("an unknown start param or hint falls through, never stored", () => {
    expect(deriveSignupSource({ startParam: "evil value", hint: "made_up" }).key).toBe("direct");
  });

  it("4. the stored arrival page or referrer record, then the first referrer channel", () => {
    expect(deriveSignupSource({ refHost: "www.Google.com", attribution: BLOG, userAgent: APP_UA }))
      .toEqual({ key: "blog:anerkennung", basis: "referrer" });
    expect(deriveSignupSource({ attribution: TG_REF, userAgent: APP_UA })).toEqual({ key: "tg_ref", basis: "referrer" });
    expect(deriveSignupSource({ refHost: "www.Google.com", userAgent: APP_UA })).toEqual({ key: "ref:google", basis: "referrer" });
    expect(deriveSignupSource({ refHost: "drsara.wordpress.com" })).toEqual({ key: "ref:other", basis: "referrer" });
    expect(deriveSignupSource({ attribution: { utm_source: "arrival", utm_medium: "organic", utm_campaign: "lernplan" } }).key).toBe("lernplan");
  });

  it("6. the native app shell, then 7. direct", () => {
    expect(deriveSignupSource({ userAgent: APP_UA })).toEqual({ key: "app_shell", basis: "app_shell" });
    expect(deriveSignupSource({ userAgent: "Mozilla/5.0 Safari" })).toEqual({ key: "direct", basis: "direct" });
    expect(deriveSignupSource({})).toEqual({ key: "direct", basis: "direct" });
  });

  it("every derived key matches the stored shape", () => {
    const inputs = [ALL, { attribution: CODE }, { attribution: GRATIS }, { pendingReferral: true }, { startParam: "c_x" }, { telegramMethod: "widget" as const }, { refHost: "chatgpt.com" }, { attribution: BLOG }, { userAgent: APP_UA }, {}];
    for (const i of inputs) expect(SIGNUP_SOURCE_RE.test(deriveSignupSource(i).key)).toBe(true);
  });
});

describe("referrer host rule", () => {
  it("keeps the host only, without www/m/l labels", () => {
    expect(refHostFromReferrer("https://www.google.com/search?q=sip+wien")).toBe("google.com");
    expect(refHostFromReferrer("https://l.facebook.com/l.php?u=x")).toBe("facebook.com");
    expect(refHostFromReferrer("https://m.facebook.com/")).toBe("facebook.com");
    expect(refHostFromReferrer("android-app://org.telegram.messenger/")).toBe("org.telegram.messenger");
  });

  it("drops own hosts, IPs, odd schemes and junk", () => {
    for (const r of ["https://medpruf.com/landing", "https://www.medpruef.com/", "https://preview-cb3ca5.vercel.app/", "http://localhost:3000/", "http://10.0.0.1/", "javascript:alert(1)", "file:///etc", "", "nonsense", 42, null]) {
      expect(refHostFromReferrer(r)).toBeNull();
    }
  });

  it("server side: an untrusted host is validated, never stored raw", () => {
    expect(normalizeRefHost("Google.COM.")).toBe("google.com");
    for (const h of ["evil.com/path", "a b.com", "x".repeat(101) + ".com", "medpruf.com", "<script>.com", "nodot", "-bad.com", 7]) {
      expect(normalizeRefHost(h)).toBeNull();
    }
    expect(deriveSignupSource({ refHost: "evil.com/path?email=a@b.c" }).key).toBe("direct");
  });

  it("a host is reduced to a known channel or other, never kept (Argus P2)", () => {
    const cases: Array<[string, string]> = [
      ["google.at", "google"], ["google.com.eg", "google"], ["gemini.google.com", "gemini"], ["mail.google.com", "gmail"],
      ["com.google.android.gm", "gmail"], ["t.me", "telegram"], ["org.telegram.messenger", "telegram"], ["web.telegram.org", "telegram"],
      ["facebook.com", "facebook"], ["com.facebook.katana", "facebook"], ["instagram.com", "instagram"], ["chatgpt.com", "chatgpt"],
      ["reddit.com", "reddit"], ["youtu.be", "youtube"], ["bing.com", "bing"], ["copilot.microsoft.com", "copilot"],
      ["m.me", "facebook"], ["com.google.android.youtube", "youtube"], ["com.google.android.googlequicksearchbox", "google"],
      ["google.evil.com", "other"], ["google.blogspot.com", "other"], ["docs.google.com", "other"], ["sites.google.com", "other"],
      ["ahmed-hassan.substack.com", "other"], ["ahmed.mohamed.gmail.com", "other"], ["intranet.spital.at", "other"], ["notgoogle.com", "other"],
    ];
    for (const [h, c] of cases) expect(refChannel(h), h).toBe(c);
    expect(refChannel("medpruf.com")).toBeNull();
  });
});

describe("flag and app shell", () => {
  it("only the literal true turns the write on", () => {
    expect(signupSourceEnabled({})).toBe(false);
    expect(signupSourceEnabled({ SIGNUP_SOURCE_ENABLED: "1" })).toBe(false);
    expect(signupSourceEnabled({ SIGNUP_SOURCE_ENABLED: "true" })).toBe(true);
  });
  it("detects the MedPrufApp user agent suffix", () => {
    expect(isAppShellUserAgent(APP_UA)).toBe(true);
    expect(isAppShellUserAgent("Mozilla/5.0 MedPrufAppX")).toBe(false);
    expect(isAppShellUserAgent(undefined)).toBe(false);
  });
});

describe("migration CHECK mirrors SIGNUP_SOURCE_RE", () => {
  it("the SQL pattern accepts and refuses the same keys", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync("supabase/migrations/20270116090000_a_signup_source.sql", "utf8");
    const m = sql.match(/signup_source ~ '([^']+)'/);
    expect(m).not.toBeNull();
    const dbRe = new RegExp(m![1]);
    const samples = ["direct", "app_shell", "referral", "tg:miniapp", "tg:other", "ref:google", "ref:other", "ref:google.com", "ref:-bad", "utm:reddit-ads", "code:arzt24", "blog:x", "tg_start:fristen", "ref:a", "lernplan", "utm:", "UTM:x", "ref:google.com/x"];
    for (const s of samples) expect(dbRe.test(s), s).toBe(SIGNUP_SOURCE_RE.test(s));
  });
});
