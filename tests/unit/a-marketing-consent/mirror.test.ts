import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setConsent = vi.fn(async () => ({ ok: true, changed: true, state: { optIn: false, consentAt: "x", version: "v" } }));
vi.mock("@/lib/marketing-consent", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/marketing-consent")>()),
  setMarketingConsent: (...args: unknown[]) => setConsent(...(args as [])),
}));

import { consentMirrorConfig, mirrorMarketingConsent, resetConsentMirrorCache, type ConsentMirrorConfig } from "@/lib/intercom/marketing-subscription";
import { reconcileMarketingConsent } from "@/lib/intercom/consent-reconcile";

// a-intercom-marketing-consent: the Intercom mirror. Scripted Intercom stand-in,
// never the live API.
interface Scripted { status: number; body?: unknown }
function fakeIntercom(script: Record<string, Scripted[]>) {
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const next = script[`${method} ${url.pathname}`]?.shift();
    if (!next) throw new Error(`unscripted ${method} ${url.pathname}`);
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const USER = "11111111-2222-3333-4444-555555555555";
const CFG: ConsentMirrorConfig = { base: "https://api.intercom.io", token: "tok-test", subscriptionId: "4242", attachAllowed: true };
const NO_ATTACH: ConsentMirrorConfig = { ...CFG, attachAllowed: false };
const LIVE_TYPES = { status: 200, body: { data: [{ id: "4242", state: "live", consent_type: "opt_in", content_types: ["email"] }] } };
const CONTACT = { status: 200, body: { id: "c-9", external_id: USER, role: "user", unsubscribed_from_emails: false } };

/** users reads, one value per read (last value repeats); proven address unless proven:false. */
function db(values: Array<boolean | null>, opts: { proven?: boolean } = {}) {
  let i = 0;
  const proven = opts.proven !== false;
  return {
    reads: () => i,
    client: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => {
          const v = values[Math.min(i++, values.length - 1)];
          return v === null ? { data: null, error: { code: "42703" } }
            : { data: { marketing_opt_in: v, email_verified_at: proven ? "2026-10-01T00:00:00Z" : null, email_status: "valid" }, error: null };
        } }) }),
      }),
    } as never,
  };
}

beforeEach(() => { resetConsentMirrorCache(); setConsent.mockClear(); });
afterEach(() => vi.unstubAllEnvs());

describe("mirror config", () => {
  const set = (env: Record<string, string>) => { for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v); };
  const full = { NEXT_PUBLIC_MARKETING_CONSENT_ENABLED: "true", MEDPRUF_INTERCOM_CONSENT_SYNC_ENABLED: "true", MEDPRUF_INTERCOM_ACCESS_TOKEN: "t", MEDPRUF_INTERCOM_REGION: "us", MEDPRUF_INTERCOM_NEWS_SUBSCRIPTION_ID: "4242" };
  it("needs the MedPruef token, region us and a numeric type id; adding also needs both switches", () => {
    set(full);
    expect(consentMirrorConfig()).toEqual({ base: "https://api.intercom.io", token: "t", subscriptionId: "4242", attachAllowed: true });
    for (const [k, v] of [["MEDPRUF_INTERCOM_ACCESS_TOKEN", ""], ["MEDPRUF_INTERCOM_REGION", "eu"], ["MEDPRUF_INTERCOM_NEWS_SUBSCRIPTION_ID", "abc"]]) {
      set(full);
      vi.stubEnv(k, v);
      expect(consentMirrorConfig(), k).toBeNull();
    }
    for (const [k, v] of [["NEXT_PUBLIC_MARKETING_CONSENT_ENABLED", "false"], ["MEDPRUF_INTERCOM_CONSENT_SYNC_ENABLED", "1"]]) {
      set(full);
      vi.stubEnv(k, v);
      expect(consentMirrorConfig()?.attachAllowed, k).toBe(false);
    }
  });
  it("never reads the generic or BlinkOS Intercom token", () => {
    const src = readFileSync("src/lib/intercom/marketing-subscription.ts", "utf8") + readFileSync("src/lib/intercom/api.ts", "utf8");
    expect(src).not.toMatch(/process\.env\.INTERCOM_ACCESS_TOKEN|process\.env\.BLINK_/);
    set({ ...full, MEDPRUF_INTERCOM_ACCESS_TOKEN: "" });
    vi.stubEnv("INTERCOM_ACCESS_TOKEN", "blink");
    expect(consentMirrorConfig()).toBeNull();
  });
  it("flag off: no network at all", async () => {
    const f = fakeIntercom({});
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: null, fetchImpl: f.fetchImpl })).toBe("off");
    expect(f.calls).toEqual([]);
  });
});

describe("mirror on toggle", () => {
  it("opt in: attaches the live opt-in type with consent_type opt_in", async () => {
    const f = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT], "POST /contacts/c-9/subscriptions": [{ status: 200, body: { id: "4242" } }] });
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("attached");
    const post = f.calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ id: "4242", consent_type: "opt_in" });
    expect(post.headers["Intercom-Version"]).toBe("2.17");
    expect(post.headers.Authorization).toBe("Bearer tok-test");
  });
  it("opt out: detaches; a 404 means already detached", async () => {
    const f = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT], "DELETE /contacts/c-9/subscriptions/4242": [{ status: 404 }] });
    expect(await mirrorMarketingConsent(db([false]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("detached");
    // A removal skips the type check: only the contact lookup, then DELETE.
    expect(f.calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /contacts/find_by_external_id/${USER}`, "DELETE /contacts/c-9/subscriptions/4242"]);
  });
  it("a draft or opt-out type is never attached", async () => {
    for (const type of [{ state: "draft", consent_type: "opt_in" }, { state: "live", consent_type: "opt_out" }, { state: "live", consent_type: "opt_in", content_types: ["sms_message"] }]) {
      resetConsentMirrorCache();
      const f = fakeIntercom({ [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT], "GET /subscription_types": [{ status: 200, body: { data: [{ id: "4242", content_types: ["email"], ...type }] } }] });
      expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("type_not_live");
      expect(f.calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    }
  });
  it("no contact yet, a merged contact or one carrying another external_id: nothing written", async () => {
    for (const answer of [{ status: 404 }, { status: 410 }, { status: 200, body: { id: "c-1", external_id: "someone-else", role: "user" } }, { status: 200, body: { id: "c-2", external_id: USER, role: "lead" } }]) {
      const f = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [answer] });
      expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("no_contact");
      expect(f.calls.some((c) => c.method !== "GET")).toBe(false);
    }
  });
  it("a toggle during the write converges on the latest value", async () => {
    const f = fakeIntercom({
      "GET /subscription_types": [LIVE_TYPES],
      [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT],
      "POST /contacts/c-9/subscriptions": [{ status: 200 }],
      "DELETE /contacts/c-9/subscriptions/4242": [{ status: 200 }],
    });
    const d = db([true, false, false]);
    expect(await mirrorMarketingConsent(d.client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("detached");
    expect(f.calls.filter((c) => c.method !== "GET").map((c) => c.method)).toEqual(["POST", "DELETE"]);
    expect(d.reads()).toBe(3);
  });
  it("an unreadable consent or a failed call writes nothing further and never throws", async () => {
    const f1 = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT] });
    expect(await mirrorMarketingConsent(db([null]).client, USER, { config: CFG, fetchImpl: f1.fetchImpl })).toBe("consent_unreadable");
    const f2 = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [{ status: 500 }] });
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f2.fetchImpl })).toBe("failed");
    const f3 = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT], "POST /contacts/c-9/subscriptions": [{ status: 429 }] });
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f3.fetchImpl })).toBe("failed");
    const broken = (async () => { throw new TypeError("network"); }) as unknown as typeof fetch;
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: broken })).toBe("failed");
  });
  it("logs carry uid8 only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fakeIntercom({ "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [{ status: 500 }] });
    await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl });
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("11111111");
    expect(logged).not.toContain(USER);
    warn.mockRestore();
  });
});

describe("reviewer fixes", () => {
  const base = { "GET /subscription_types": [LIVE_TYPES], [`GET /contacts/find_by_external_id/${USER}`]: [CONTACT] } as Record<string, Scripted[]>;
  const script = (extra: Record<string, Scripted[]>) => ({ ...JSON.parse(JSON.stringify(base)), ...extra });

  it("switches off: a withdrawal is removed at Intercom even with both switches off (after a rollback)", async () => {
    const f = fakeIntercom(script({ "DELETE /contacts/c-9/subscriptions/4242": [{ status: 200 }] }));
    expect(await mirrorMarketingConsent(db([false]).client, USER, { config: NO_ATTACH, fetchImpl: f.fetchImpl })).toBe("detached");
    const f2 = fakeIntercom({});
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: NO_ATTACH, fetchImpl: f2.fetchImpl })).toBe("attach_off");
    expect(f2.calls).toEqual([]);
  });
  it("an opt-in on an unconfirmed address is held as removed at Intercom", async () => {
    const f = fakeIntercom(script({ "DELETE /contacts/c-9/subscriptions/4242": [{ status: 404 }] }));
    expect(await mirrorMarketingConsent(db([true], { proven: false }).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("detached");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("a failed removal is tried once more", async () => {
    const f = fakeIntercom(script({ "DELETE /contacts/c-9/subscriptions/4242": [{ status: 503 }, { status: 200 }] }));
    expect(await mirrorMarketingConsent(db([false]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("detached");
    expect(f.calls.filter((c) => c.method === "DELETE")).toHaveLength(2);
  });
  it("reconcile: a global unsubscribe at Intercom is held, never attached and never written back", async () => {
    const f = fakeIntercom(script({ [`GET /contacts/find_by_external_id/${USER}`]: [{ status: 200, body: { ...CONTACT.body, unsubscribed_from_emails: true } }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl, trigger: "reconcile" })).toBe("blocked_at_intercom");
    expect(f.calls.some((c) => c.method !== "GET")).toBe(false);
    expect(setConsent).not.toHaveBeenCalled();
  });
  it("reconcile with adding switched off still pulls a type opt-out back", async () => {
    const f = fakeIntercom(script({ "GET /contacts/c-9/subscriptions": [{ status: 200, body: { data: [{ id: "4242", consent_type: "opt_out" }] } }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: NO_ATTACH, fetchImpl: f.fetchImpl, trigger: "reconcile" })).toBe("withdrawn_at_intercom");
    expect(setConsent).toHaveBeenCalledWith(expect.anything(), USER, false, "intercom");
    const f2 = fakeIntercom(script({ "GET /contacts/c-9/subscriptions": [{ status: 200, body: { data: [] } }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: NO_ATTACH, fetchImpl: f2.fetchImpl, trigger: "reconcile" })).toBe("attach_off");
    expect(f2.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("a value that turns true in a later round is checked against the type before attaching", async () => {
    const f = fakeIntercom(script({
      "DELETE /contacts/c-9/subscriptions/4242": [{ status: 200 }],
      "GET /subscription_types": [{ status: 200, body: { data: [{ id: "4242", state: "archived", consent_type: "opt_in", content_types: ["email"] }] } }],
    }));
    expect(await mirrorMarketingConsent(db([false, true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("type_not_live");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("reconcile: an opt-out of our type at Intercom is pulled back", async () => {
    const f = fakeIntercom(script({ "GET /contacts/c-9/subscriptions": [{ status: 200, body: { data: [{ id: "4242", consent_type: "opt_out" }] } }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl, trigger: "reconcile" })).toBe("withdrawn_at_intercom");
    expect(f.calls.some((c) => c.method === "POST")).toBe(false);
  });
  it("reconcile: an unknown unsubscribe state or unreadable list attaches and withdraws nothing", async () => {
    const f = fakeIntercom(script({ [`GET /contacts/find_by_external_id/${USER}`]: [{ status: 200, body: { id: "c-9", external_id: USER, role: "user" } }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl, trigger: "reconcile" })).toBe("failed");
    const f2 = fakeIntercom(script({ "GET /contacts/c-9/subscriptions": [{ status: 500 }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f2.fetchImpl, trigger: "reconcile" })).toBe("failed");
    expect(setConsent).not.toHaveBeenCalled();
    expect([...f.calls, ...f2.calls].some((c) => c.method === "POST")).toBe(false);
  });
  it("reconcile: still opted in at Intercom attaches as usual", async () => {
    const f = fakeIntercom(script({ "GET /contacts/c-9/subscriptions": [{ status: 200, body: { data: [] } }], "POST /contacts/c-9/subscriptions": [{ status: 200 }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl, trigger: "reconcile" })).toBe("attached");
  });
  it("a change in the app wins over an earlier opt-out at Intercom (the learner just decided)", async () => {
    const f = fakeIntercom(script({ "POST /contacts/c-9/subscriptions": [{ status: 200 }] }));
    expect(await mirrorMarketingConsent(db([true]).client, USER, { config: CFG, fetchImpl: f.fetchImpl })).toBe("attached");
    expect(setConsent).not.toHaveBeenCalled();
  });
});

describe("reconcile", () => {
  function users(rows: Array<{ id: string; marketing_opt_in: boolean }>) {
    return {
      from: () => {
        let after = "";
        let lim = 50;
        let want: boolean | null = null;
        const q = {
          select: () => q,
          not: () => q,
          eq: (_c: string, v: boolean) => { want = v; return q; },
          gt: (_c: string, v: string) => { after = v; return q; },
          order: () => q,
          limit: (n: number) => { lim = n; return q; },
          then: (r: (v: unknown) => unknown) => Promise.resolve({ data: rows.filter((x) => x.id > after && (want === null || x.marketing_opt_in === want)).slice(0, lim), error: null }).then(r),
        };
        return q;
      },
    } as never;
  }
  const ids = Array.from({ length: 7 }, (_, n) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, marketing_opt_in: n % 2 === 0 }));

  it("dry run calls no mirror and pages by id", async () => {
    const mirror = vi.fn();
    const s = await reconcileMarketingConsent(users(ids), { apply: false, batch: 3, limit: 100, mirror });
    expect(mirror).not.toHaveBeenCalled();
    // Opt-outs first, then opt-ins, each by id.
    expect(s.rows.map((r) => r.planned)).toEqual(["opt_out", "opt_out", "opt_out", "opt_in", "opt_in", "opt_in", "opt_in"]);
    expect(s.rows.every((r) => /^[0-9a-f]{8}$/.test(r.uid8))).toBe(true);
  });
  it("apply mirrors each, caps batch and limit, stops after 3 failures in a row", async () => {
    const mirror = vi.fn(async () => "failed" as const);
    const s = await reconcileMarketingConsent(users(ids), { apply: true, batch: 500, limit: 5, mirror, sleep: async () => {} });
    expect(mirror).toHaveBeenCalledTimes(3);
    expect(s.stopped).toBe("3 failures in a row");
  });
  it("apply passes trigger reconcile; unreadable rows count toward the stop", async () => {
    const mirror = vi.fn(async () => "consent_unreadable" as const);
    const s = await reconcileMarketingConsent(users(ids), { apply: true, batch: 50, limit: 50, mirror });
    expect(mirror.mock.calls[0][2]).toEqual({ trigger: "reconcile" });
    expect(s.stopped).toBe("3 failures in a row");
  });
  it("stops at once when the mirror is off", async () => {
    const mirror = vi.fn(async () => "off" as const);
    const s = await reconcileMarketingConsent(users(ids), { apply: true, batch: 50, limit: 50, mirror });
    expect(mirror).toHaveBeenCalledTimes(1);
    expect(s.stopped).toBe("mirror off");
  });
});
