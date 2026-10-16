import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPartnerCode, parsePartnerCodes, partnerKitEnabled, SMALL_CELL } from "@/lib/partner-kit";
import { handoutCopy, pageCopy, reportCopy } from "@/lib/partner-kit/copy";
import { buildHandout, handoutDate, variantFromEnv } from "@/lib/partner-kit/handout";
import { renderHandoutPdf, wrap } from "@/lib/partner-kit/pdf";
import { shapeReport, shownText } from "@/lib/partner-kit/report";
import { foldPartnerCounts } from "@/lib/partner-kit/counts";
import { readPartnerRaw, readPartnerCodeInfo } from "@/lib/partner-kit/server";
import { readPartnerReportToken, signCalendarFeedToken, signPartnerReportToken, signReminderToken } from "@/lib/reminders/tokens";
import { SUPPORT_TOPICS, validateSupportContact } from "@/lib/support-contact";
import type { PartnerCodeInfo } from "@/lib/partner-kit";

const SECRET = "x".repeat(40);
const NOW = new Date("2026-10-29T10:00:00Z");
const credits: PartnerCodeInfo = { code: "TG-SPT", kind: "credits", credits: 100, expiryDays: 30, proDays: null, maxAccountAgeDays: 7, endsAt: "2027-01-13T22:00:00Z" };
const seat: PartnerCodeInfo = { code: "OEH-WIEN", kind: "seat", credits: 100, expiryDays: 30, proDays: 30, maxAccountAgeDays: 14, endsAt: "2027-01-13T22:00:00Z" };

describe("flag and allowlist", () => {
  it("is off unless the literal true", () => {
    expect(partnerKitEnabled({})).toBe(false);
    expect(partnerKitEnabled({ PARTNER_KIT_ENABLED: "1" })).toBe(false);
    expect(partnerKitEnabled({ PARTNER_KIT_ENABLED: "true" })).toBe(true);
  });
  it("normalises and de-duplicates PARTNER_CODES, drops junk", () => {
    expect(parsePartnerCodes("tg-spt, OEH-WIEN;tg-spt  x ab!c")).toEqual(["TG-SPT", "OEH-WIEN"]);
    expect(parsePartnerCodes(undefined)).toEqual([]);
  });
  it("only an allowlisted code is a partner code", () => {
    const env = { PARTNER_CODES: "TG-SPT" };
    expect(isPartnerCode("tg-spt", env)).toBe(true);
    expect(isPartnerCode("OTHER", env)).toBe(false);
    expect(isPartnerCode("TG-SPT", {})).toBe(false);
  });
});

describe("partner-report link", () => {
  beforeEach(() => { process.env.REMINDER_LINK_SIGNING_SECRET = SECRET; });
  afterEach(() => { delete process.env.REMINDER_LINK_SIGNING_SECRET; });
  it("round trips a code and expires", () => {
    const t = signPartnerReportToken("TG-SPT", 10, NOW);
    expect(readPartnerReportToken(t, new Date(NOW.getTime() + 9 * 86_400_000))).toBe("TG-SPT");
    expect(readPartnerReportToken(t, new Date(NOW.getTime() + 11 * 86_400_000))).toBeNull();
  });
  it("rejects tampering, a swapped code and other purposes (both directions)", () => {
    const t = signPartnerReportToken("TG-SPT", 10, NOW);
    const [v, payload, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), code: "OTHER" })).toString("base64url");
    expect(readPartnerReportToken(`${v}.${forged}.${sig}`, NOW)).toBeNull();
    expect(readPartnerReportToken(`${v}.${payload}.${sig}x`, NOW)).toBeNull();
    expect(readPartnerReportToken("garbage", NOW)).toBeNull();
    const calendar = signCalendarFeedToken("0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", NOW);
    expect(readPartnerReportToken(calendar, NOW)).toBeNull();
    const unsub = signReminderToken("exam-confirm", "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b", NOW);
    expect(readPartnerReportToken(unsub, NOW)).toBeNull();
  });
  it("is refused without the secret and never throws on read", () => {
    const t = signPartnerReportToken("TG-SPT", 10, NOW);
    delete process.env.REMINDER_LINK_SIGNING_SECRET;
    expect(readPartnerReportToken(t, NOW)).toBeNull();
    expect(() => signPartnerReportToken("TG-SPT", 10, NOW)).toThrow();
  });
  it("refuses a bad code or lifetime at signing", () => {
    expect(() => signPartnerReportToken("a b", 10)).toThrow();
    expect(() => signPartnerReportToken("TG-SPT", 0)).toThrow();
    expect(() => signPartnerReportToken("TG-SPT", 9999)).toThrow();
  });
});

describe("organiser report privacy", () => {
  it("shows no count under 5", () => {
    const r = shapeReport({ redemptions: 4, active7d: 4, answerers: 4, answers: 900 });
    expect(r.redemptions).toEqual({ kind: "small" });
    expect(r.active).toEqual({ kind: "small" });
    expect(r.answers).toEqual({ kind: "small" });
    expect(SMALL_CELL).toBe(5);
  });
  it("hides answers while fewer than 5 learners contributed, whatever the total", () => {
    const r = shapeReport({ redemptions: 30, active7d: 3, answerers: 3, answers: 5000 });
    expect(r.redemptions).toEqual({ kind: "number", value: 30 });
    expect(r.active).toEqual({ kind: "small" });
    expect(r.answers).toEqual({ kind: "small" });
  });
  it("rounds answers to 10 and flags it", () => {
    const r = shapeReport({ redemptions: 30, active7d: 12, answerers: 20, answers: 1234 });
    expect(r.answers).toEqual({ kind: "number", value: 1230 });
    expect(r.answersRounded).toBe(true);
    expect(shownText({ kind: "small" }, "unter 5", "de")).toBe("unter 5");
  });
  it("one more learner never moves a shown figure by that learner's own count", () => {
    const a = shapeReport({ redemptions: 30, active7d: 12, answerers: 20, answers: 1231 });
    const b = shapeReport({ redemptions: 31, active7d: 13, answerers: 21, answers: 1233 });
    expect(a.answers).toEqual(b.answers);
  });
  it("rounds shown counts to 5 so one learner never moves a figure", () => {
    expect(shapeReport({ redemptions: 6, active7d: 5, answerers: 6, answers: 50 }).redemptions).toEqual({ kind: "number", value: 5 });
    expect(shapeReport({ redemptions: 6, active7d: 5, answerers: 6, answers: 50 }).active).toEqual(shapeReport({ redemptions: 7, active7d: 6, answerers: 6, answers: 50 }).active);
    expect(shapeReport({ redemptions: 13, active7d: 9, answerers: 9, answers: 50 }).redemptions).toEqual({ kind: "number", value: 15 });
  });
  it("the report shape carries no identity field", () => {
    const keys = Object.keys(shapeReport({ redemptions: 9, active7d: 6, answerers: 6, answers: 100 }));
    expect(keys.sort()).toEqual(["active", "answers", "answersRounded", "redemptions"]);
  });
});

type Rows = Record<string, Array<Record<string, unknown>>>;
function fakeDb(rows: Rows, failOn?: string) {
  return {
    from(table: string) {
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let lo = 0, hi = 999;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
        gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
        order: () => q,
        range: (a: number, b: number) => { lo = a; hi = b; return q; },
        maybeSingle: () => Promise.resolve({ data: (rows[table] ?? []).find((r) => filters.every((f) => f(r))) ?? null, error: failOn === table ? { message: "x" } : null }),
        then: (res: (v: unknown) => unknown) => res({ data: failOn === table ? null : (rows[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(lo, hi + 1), error: failOn === table ? { message: "x" } : null }),
      };
      return q;
    },
  } as never;
}

describe("readPartnerRaw", () => {
  const red = (n: number) => Array.from({ length: n }, (_, i) => ({ code: "TG-SPT", user_id: `u${i}`, redeemed_at: "2026-10-01T00:00:00Z" }));
  it("counts redeemers, active learners and answers since redemption only", async () => {
    const answers = [
      { user_id: "u0", created_at: "2026-10-28T00:00:00Z" },
      { user_id: "u0", created_at: "2026-09-01T00:00:00Z" }, // before redemption: ignored
      { user_id: "u1", created_at: "2026-10-05T00:00:00Z" },
      { user_id: "stranger", created_at: "2026-10-28T00:00:00Z" },
    ];
    const raw = await readPartnerRaw(fakeDb({ ai_credit_campaign_redemption: red(3), answer_history: answers }), "tg-spt", NOW);
    expect(raw).toEqual({ redemptions: 3, active7d: 1, answerers: 2, answers: 2 });
  });
  it("is null (never a low number) when a read fails", async () => {
    expect(await readPartnerRaw(fakeDb({ ai_credit_campaign_redemption: red(2), answer_history: [] }, "answer_history"), "TG-SPT", NOW)).toBeNull();
    expect(await readPartnerRaw(fakeDb({}, "ai_credit_campaign_redemption"), "TG-SPT", NOW)).toBeNull();
  });
  it("an empty code reads zeros", async () => {
    expect(await readPartnerRaw(fakeDb({ ai_credit_campaign_redemption: [] }), "TG-SPT", NOW)).toEqual({ redemptions: 0, active7d: 0, answerers: 0, answers: 0 });
  });
});

describe("readPartnerCodeInfo", () => {
  const row = { code: "TG-SPT", credits: 100, expiry_days: 30, starts_at: "2026-10-01T00:00:00Z", ends_at: "2027-01-13T22:00:00Z", active: true };
  it("returns a live credits code, with the seat age rule for seats", async () => {
    expect((await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [row] }), "tg-spt", NOW))?.kind).toBe("credits");
    const s = await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [{ ...row, kind: "seat", pro_days: 30 }] }), "TG-SPT", NOW);
    expect(s).toMatchObject({ kind: "seat", proDays: 30, maxAccountAgeDays: 14 });
  });
  it("is null for paused, ended, not started or unknown", async () => {
    expect(await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [{ ...row, active: false }] }), "TG-SPT", NOW)).toBeNull();
    expect(await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [{ ...row, ends_at: "2026-10-02T00:00:00Z" }] }), "TG-SPT", NOW)).toBeNull();
    expect(await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [{ ...row, starts_at: "2026-12-01T00:00:00Z" }] }), "TG-SPT", NOW)).toBeNull();
    expect(await readPartnerCodeInfo(fakeDb({ ai_credit_campaign: [] }), "NOPE", NOW)).toBeNull();
  });
});

describe("handout", () => {
  it("says what the kind gives and how to redeem it", () => {
    const c = buildHandout(credits, "de", "settings", "print");
    expect(c.what).toContain("100 Credits");
    expect(c.what).toContain("30 Tage");
    expect(c.steps.join(" ")).toContain("Einstellungen");
    const s = buildHandout(seat, "en", "register", "image");
    expect(s.what).toContain("30 days of full access");
    expect(s.steps.join(" ")).toContain("Do you have a code?");
    expect(s.steps.join(" ")).not.toMatch(/medpruf\.com/);
  });
  it("the image carries no URL, the print sheet names the site", () => {
    for (const lang of ["de", "en"] as const) {
      const img = buildHandout(credits, lang, "register", "image");
      expect(JSON.stringify(img)).not.toMatch(/medpruf\.com|https?:|www\./);
      expect(buildHandout(credits, lang, "settings", "print").steps[0]).toContain("medpruf.com");
    }
  });
  it("variant follows CODE_AT_SIGNUP_ENABLED", () => {
    expect(variantFromEnv({})).toBe("settings");
    expect(variantFromEnv({ CODE_AT_SIGNUP_ENABLED: "true" })).toBe("register");
  });
  it("formats the end date in Vienna", () => {
    expect(handoutDate("2027-01-13T22:00:00Z", "en")).toBe("13 January 2027");
    expect(handoutDate("garbage", "de")).toBe("");
  });
  it("copy has no price, no dash punctuation, no endorsement or medical claim", () => {
    const all = JSON.stringify([handoutCopy("de"), handoutCopy("en"), pageCopy("de"), pageCopy("en"), reportCopy("de"), reportCopy("en"), buildHandout(seat, "de", "register", "print"), buildHandout(credits, "en", "settings", "image")]);
    expect(all).not.toMatch(/[—–]/);
    expect(all).not.toMatch(/€|EUR|\beuro\b|price|preis|\$|rabatt|discount/i);
    expect(all).not.toMatch(/Medizinische Universität|MedUni|Universität Wien|recommended by|empfohlen von|zertifiziert|certified/i);
    expect(all).not.toMatch(/bestehen|pass rate|Bestehensquote|garantie|guarantee|diagnos|therap/i);
    // Sie, never du, in the German copy.
    const de = JSON.stringify([handoutCopy("de"), pageCopy("de"), reportCopy("de")]);
    expect(de).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
  });
});

describe("pdf", () => {
  const text = (b: Uint8Array) => Buffer.from(b).toString("latin1");
  it("is a well formed single page PDF with xref offsets that match", () => {
    const bytes = renderHandoutPdf(buildHandout(seat, "de", "settings", "print"));
    const s = text(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 1");
    const start = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const offsets = [...s.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(s).toContain("OEH-WIEN");
  });
  it("encodes umlauts and German quotes as WinAnsi octal escapes", () => {
    const s = text(renderHandoutPdf(buildHandout(credits, "de", "register", "print")));
    expect(s).toContain("\\374"); // ü
    expect(s).toContain("\\204"); // „
    expect(s).toContain("\\223"); // “
  });
  it("never breaks a code or a line past the margin", () => {
    for (const line of wrap("Der Code gilt für neue Konten (höchstens 14 Tage alt), die noch keinen Tarif bezahlt haben, ein Platz pro Person.", 12, false, 200)) expect(line.length).toBeLessThan(60);
  });
  it("is deterministic", () => {
    const m = buildHandout(seat, "en", "register", "print");
    expect(text(renderHandoutPdf(m))).toBe(text(renderHandoutPdf(m)));
  });
});

describe("scoreboard fold", () => {
  it("counts redemptions, named sittings, checkout opens and payers after redemption (X7 rule)", () => {
    const at = (iso: string) => Date.parse(iso);
    const r = foldPartnerCounts("TG-SPT", [
      { user_id: "a", redeemed_at: "2026-10-10T00:00:00Z", named_sitting: true },
      { user_id: "b", redeemed_at: "2026-10-10T00:00:00Z", named_sitting: false },
      { user_id: "a", redeemed_at: "2026-10-10T00:00:00Z", named_sitting: true },
      { user_id: "c", redeemed_at: "2026-10-10T00:00:00Z", named_sitting: false },
    ], new Map([["a", [at("2026-10-12T00:00:00Z")]], ["b", [at("2026-10-01T00:00:00Z")]]]), new Map([["a", [at("2026-10-13T00:00:00Z")]], ["c", [at("2026-09-01T00:00:00Z")]]]));
    expect(r).toEqual({ code: "tg-spt", redemptions: 3, named_sittings: 1, checkout_opens: 1, payers: 1 });
  });
});

describe("support contact topic", () => {
  it("accepts the partner topic and keeps the others", () => {
    expect(SUPPORT_TOPICS).toContain("partner");
    const v = validateSupportContact({ email: "user-3424f963@example.com", topic: "partner", message: "Wir begleiten 30 Ärzte in Wien.", lang: "de" });
    expect(v.ok).toBe(true);
    expect(validateSupportContact({ email: "user-3424f963@example.com", topic: "bogus", message: "Wir begleiten 30 Ärzte in Wien." }).ok).toBe(false);
  });
});
