import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { marketingAllowed, parseOptIn, setMarketingConsent } from "@/lib/marketing-consent";
import { CONSENT_TEXT, MARKETING_CONSENT_VERSION, PRIVACY_CONSENT, PRIVACY_INTERCOM_NEWS, PRIVACY_ZOHO_PURPOSE, marketingConsentCopy } from "@/lib/marketing-consent/copy";

// Each consent text version and the exact text it names. Changing the
// checkbox or card body without a new version (and a row here) fails.
const VERSION_TEXT_SHA256: Record<string, string> = {
  "mc-2026-10-17.1": "70be088f5b4080a1200f784650e7f476f52290a2db2fa26f0ad20e15bb296de5",
};

function textHash(): string {
  return createHash("sha256").update(JSON.stringify(CONSENT_TEXT), "utf8").digest("hex");
}

function allStrings(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") out.push(String((v as (e: string) => string)("x@example.org")));
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk([CONSENT_TEXT, PRIVACY_CONSENT, PRIVACY_INTERCOM_NEWS, PRIVACY_ZOHO_PURPOSE, marketingConsentCopy("de"), marketingConsentCopy("en")]);
  return out;
}

describe("consent copy", () => {
  it("the version names exactly this text", () => {
    expect(VERSION_TEXT_SHA256[MARKETING_CONSENT_VERSION]).toBe(textHash());
  });
  it("has no em or en dashes and no du in German", () => {
    for (const s of allStrings()) expect(s).not.toMatch(/[–—]/);
    const de = [CONSENT_TEXT.de, marketingConsentCopy("de"), PRIVACY_CONSENT.items.map((i) => i.de), PRIVACY_INTERCOM_NEWS.purpose.de, PRIVACY_ZOHO_PURPOSE.de];
    const text = JSON.stringify(de) + marketingConsentCopy("de").on("x@example.org");
    expect(text).not.toMatch(/\b(du|dich|dir|dein|deine|deinen)\b/i);
  });
  it("unreviewed interface languages read English", () => {
    for (const l of ["ru", "uk", "tr", "ar", "fr", undefined, null]) expect(marketingConsentCopy(l).checkbox).toBe(CONSENT_TEXT.en.checkbox);
    expect(marketingConsentCopy("de").checkbox).toBe(CONSENT_TEXT.de.checkbox);
  });
  it("the checkbox component starts unticked", () => {
    const login = readFileSync("src/app/login/page.tsx", "utf8");
    expect(login).toContain("const [marketingOptIn, setMarketingOptIn] = useState(false);");
    expect(login).not.toMatch(/defaultChecked/);
  });
});

describe("sender rule", () => {
  it("only a stored true on a proven address allows marketing (fail closed)", () => {
    const proven = { email_verified_at: "2026-10-01T00:00:00Z", email_status: "valid" };
    expect(marketingAllowed({ marketing_opt_in: true, ...proven })).toBe(true);
    expect(marketingAllowed({ marketing_opt_in: true, email_verified_at: "2026-10-01T00:00:00Z", email_status: null })).toBe(true);
    for (const v of [false, null, undefined, "true", 1]) expect(marketingAllowed({ marketing_opt_in: v, ...proven })).toBe(false);
    expect(marketingAllowed({ marketing_opt_in: true })).toBe(false);
    expect(marketingAllowed({ marketing_opt_in: true, email_verified_at: null, email_status: "valid" })).toBe(false);
    for (const st of ["unverified", "bounced"]) expect(marketingAllowed({ marketing_opt_in: true, email_verified_at: "2026-10-01T00:00:00Z", email_status: st })).toBe(false);
    expect(marketingAllowed(null)).toBe(false);
    expect(marketingAllowed(undefined)).toBe(false);
  });
  it("parseOptIn accepts real booleans only", () => {
    expect(parseOptIn(true)).toBe(true);
    expect(parseOptIn(false)).toBe(false);
    for (const v of ["true", "false", 1, 0, null, undefined, {}]) expect(parseOptIn(v)).toBeNull();
  });
});

// Minimal PostgREST stand-in: users row with compare-and-set on update.
function fakeDb(initial: { marketing_opt_in: boolean; email: string | null } | null, opts: { updateError?: boolean } = {}) {
  const row = initial ? { marketing_consent_at: null as string | null, marketing_consent_version: null as string | null, ...initial } : null;
  const events: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      if (table === "user_events") return { insert: async (r: Record<string, unknown>) => { events.push(r); return { error: null }; } };
      const filters: Record<string, unknown> = {};
      let patch: Record<string, unknown> | null = null;
      const q = {
        select() { return q; },
        update(p: Record<string, unknown>) { patch = p; return q; },
        eq(col: string, v: unknown) { filters[col] = v; return q; },
        async maybeSingle() { return { data: row, error: null }; },
        then(resolve: (v: unknown) => unknown) {
          if (opts.updateError) return Promise.resolve({ data: null, error: { code: "42703" } }).then(resolve);
          const match = row && Object.entries(filters).every(([k, v]) => k === "id" || (row as Record<string, unknown>)[k] === v);
          if (match && patch && row) Object.assign(row, patch);
          return Promise.resolve({ data: match && row ? [row] : [], error: null }).then(resolve);
        },
      };
      return q;
    },
  };
  return { db: db as never, row, events };
}

describe("setMarketingConsent", () => {
  const now = new Date("2026-10-17T10:00:00Z");
  it("records an opt-in with time, version and one event (no address)", async () => {
    const f = fakeDb({ marketing_opt_in: false, email: "a@example.org" });
    const r = await setMarketingConsent(f.db, "u-1", true, "settings", now);
    expect(r).toEqual({ ok: true, changed: true, state: { optIn: true, consentAt: now.toISOString(), version: MARKETING_CONSENT_VERSION } });
    expect(f.row).toMatchObject({ marketing_opt_in: true, marketing_consent_at: now.toISOString(), marketing_consent_version: MARKETING_CONSENT_VERSION });
    expect(f.events).toEqual([{ user_id: "u-1", event_type: "marketing_consent_changed", event_data: { opt_in: true, version: MARKETING_CONSENT_VERSION, source: "settings", at: now.toISOString() } }]);
    expect(JSON.stringify(f.events)).not.toContain("@");
  });
  it("a repeated decision writes nothing and keeps the earlier time", async () => {
    const f = fakeDb({ marketing_opt_in: true, email: "a@example.org" });
    f.row!.marketing_consent_at = "2026-10-01T00:00:00.000Z";
    const r = await setMarketingConsent(f.db, "u-1", true, "settings", now);
    expect(r).toMatchObject({ ok: true, changed: false, state: { optIn: true, consentAt: "2026-10-01T00:00:00.000Z" } });
    expect(f.events).toEqual([]);
  });
  it("a withdrawal records time and version too", async () => {
    const f = fakeDb({ marketing_opt_in: true, email: "a@example.org" });
    const r = await setMarketingConsent(f.db, "u-1", false, "settings", now);
    expect(r).toMatchObject({ ok: true, changed: true, state: { optIn: false } });
    expect(f.row).toMatchObject({ marketing_opt_in: false, marketing_consent_at: now.toISOString() });
  });
  it("withdrawals pulled back from Intercom carry source intercom", async () => {
    const f = fakeDb({ marketing_opt_in: true, email: "a@example.org" });
    await setMarketingConsent(f.db, "u-1", false, "intercom", now);
    expect(f.events[0].event_data).toMatchObject({ opt_in: false, source: "intercom" });
  });
  it("an unknown account and a failed write are reported, never thrown", async () => {
    expect(await setMarketingConsent(fakeDb(null).db, "u-x", true, "settings", now)).toEqual({ ok: false, reason: "not_found" });
    expect(await setMarketingConsent(fakeDb({ marketing_opt_in: false, email: null }, { updateError: true }).db, "u-1", true, "settings", now)).toEqual({ ok: false, reason: "db_error" });
  });
});
