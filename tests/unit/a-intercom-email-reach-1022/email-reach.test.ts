/**
 * a-intercom-email-reach-1022: with MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED on, the
 * contact sync sends an unproven account address only when no active
 * do-not-email row names the account (user id) or the address (key). Flag off
 * is the proven rule byte for byte. The Messenger JWT and mp_marketing_opt_in
 * stay on the proven rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceClient } = vi.hoisted(() => ({
  getServiceClient: vi.fn(() => {
    throw new Error("database must not be read in these tests");
  }),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient }));

import { resetIntercomSyncDebounce, syncIntercomContact } from "@/lib/intercom/sync";
import { buildContactPayload, contactEmail, contactMarketingOptIn, reachEmail } from "@/lib/intercom/contact-payload";
import { accountSuppressed, decideEmailReach } from "@/lib/intercom/email-reach";
import { suppressionKey } from "@/lib/mail-suppression";
import { fakeIntercom, LEARNER } from "../a-intercom-contact-sync/fake-intercom";

const ENV = ["MEDPRUF_INTERCOM_SYNC_ENABLED", "NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC", "MEDPRUF_INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_REGION", "MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED"];
const saved: Record<string, string | undefined> = {};
const NOW = new Date("2026-10-22T08:00:00Z");
const EXT = LEARNER.id;
/** The 22 Oct production shape: registered by email, never confirmed (column default). */
const UNPROVEN = { ...LEARNER, email_verified_at: null, email_status: "unverified", marketing_opt_in: true };
/** Confirmed on 21 Oct by the email-confirm link: email_status still the default. */
const CONFIRMED_DEFAULT_STATUS = { ...LEARNER, email_verified_at: "2026-10-21T10:00:00Z", email_status: "unverified" };

beforeEach(() => {
  for (const n of ENV) { saved[n] = process.env[n]; delete process.env[n]; }
  process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
  resetIntercomSyncDebounce();
  getServiceClient.mockClear();
});
afterEach(() => {
  for (const n of ENV) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  vi.restoreAllMocks();
});

function newContactScript() {
  return fakeIntercom({
    [`GET /contacts/find_by_external_id/${EXT}`]: [{ status: 404 }],
    "POST /contacts": [{ status: 200, body: { id: "c1" } }],
  });
}
const postedBody = (fake: ReturnType<typeof fakeIntercom>) => fake.calls.find((c) => c.method === "POST")!.body as Record<string, unknown> & { custom_attributes: Record<string, unknown> };

describe("payload rule", () => {
  it("flag off: an unproven address never goes on the contact (today's rule)", () => {
    expect(buildContactPayload(UNPROVEN, { now: NOW, lastActiveAt: null })).not.toHaveProperty("email");
    expect(buildContactPayload(UNPROVEN, { now: NOW, lastActiveAt: null, emailReachAllowed: false })).not.toHaveProperty("email");
  });

  it("allowed: the normalized address goes on the contact", () => {
    expect(buildContactPayload(UNPROVEN, { now: NOW, lastActiveAt: null, emailReachAllowed: true }).email).toBe("user-4ed88e9d@example.com");
  });

  it("a bounced or malformed address never goes, even when allowed", () => {
    expect(reachEmail({ ...UNPROVEN, email_status: "bounced" })).toBeNull();
    expect(reachEmail({ ...UNPROVEN, email: "not-an-address" })).toBeNull();
    expect(reachEmail({ ...UNPROVEN, email: null })).toBeNull();
    expect(buildContactPayload({ ...UNPROVEN, email_status: "bounced" }, { now: NOW, lastActiveAt: null, emailReachAllowed: true })).not.toHaveProperty("email");
  });

  it("mp_marketing_opt_in stays on the proven rule (sender rule marketingAllowed)", () => {
    const body = buildContactPayload(UNPROVEN, { now: NOW, lastActiveAt: null, emailReachAllowed: true });
    expect(body.email).toBe("user-4ed88e9d@example.com");
    expect(body.custom_attributes.mp_marketing_opt_in).toBe(false);
    expect(contactMarketingOptIn(UNPROVEN)).toBe(false);
  });

  it("documents the 22 Oct root cause: a confirmed learner with the default status is not proven", () => {
    expect(contactEmail(CONFIRMED_DEFAULT_STATUS)).toBeNull();
    expect(reachEmail(CONFIRMED_DEFAULT_STATUS)).toBe("user-4ed88e9d@example.com");
  });
});

describe("decideEmailReach", () => {
  const never = async () => { throw new Error("must not read"); };
  it("proven rows and flag off read nothing", async () => {
    expect(await decideEmailReach(LEARNER, never)).toBe("proven");
    expect(await decideEmailReach(UNPROVEN, never)).toBe("flag_off");
  });
  it("flag on: clear, suppressed, failed read, no address", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    expect(await decideEmailReach(UNPROVEN, async () => false)).toBe("allowed");
    expect(await decideEmailReach(UNPROVEN, async () => true)).toBe("suppressed");
    expect(await decideEmailReach(UNPROVEN, never)).toBe("lookup_failed");
    expect(await decideEmailReach({ ...UNPROVEN, email: null }, never)).toBe("no_address");
    expect(await decideEmailReach({ ...UNPROVEN, email_status: "bounced" }, never)).toBe("no_address");
  });
  it("only the literal true switches it on", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "1";
    expect(await decideEmailReach(UNPROVEN, async () => false)).toBe("flag_off");
  });
});

describe("accountSuppressed", () => {
  function fakeDb(result: { data: unknown; error: unknown }) {
    const calls: Record<string, unknown[]> = {};
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "select", "is", "or", "limit"]) {
      chain[m] = (...args: unknown[]) => { calls[m] = args; return m === "limit" ? Promise.resolve(result) : chain; };
    }
    return { db: chain as never, calls };
  }
  it("matches any active row by address key or user id", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "s1" }], error: null });
    expect(await accountSuppressed(db, EXT, "user-4ed88e9d@example.com")).toBe(true);
    expect(calls.from).toEqual(["mail_suppression"]);
    expect(calls.is).toEqual(["lifted_at", null]);
    expect(calls.or).toEqual([`email_key.eq.${suppressionKey("user-4ed88e9d@example.com")},user_id.eq.${EXT}`]);
  });
  it("clear when no row; throws on a failed read; fails closed on a bad id or address", async () => {
    expect(await accountSuppressed(fakeDb({ data: [], error: null }).db, EXT, "user-65abd062@example.com")).toBe(false);
    await expect(accountSuppressed(fakeDb({ data: null, error: { message: "x" } }).db, EXT, "user-65abd062@example.com")).rejects.toThrow();
    expect(await accountSuppressed(fakeDb({ data: [], error: null }).db, "not-a-uuid", "user-65abd062@example.com")).toBe(true);
    expect(await accountSuppressed(fakeDb({ data: [], error: null }).db, EXT, "nope")).toBe(true);
  });
});

describe("sync with the flag", () => {
  it("flag off: creates the contact without the unproven address and reads no suppression", async () => {
    const fake = newContactScript();
    const suppressed = vi.fn(async () => false);
    const r = await syncIntercomContact(EXT, "register", { now: NOW, loadUser: async () => UNPROVEN, fetchImpl: fake.fetchImpl, suppressed, mirror: async () => undefined });
    expect(r.outcome).toBe("created");
    expect(postedBody(fake)).not.toHaveProperty("email");
    expect(suppressed).not.toHaveBeenCalled();
  });

  it("flag on, not suppressed: the address goes on the new contact", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    const fake = newContactScript();
    const r = await syncIntercomContact(EXT, "register", { now: NOW, loadUser: async () => UNPROVEN, fetchImpl: fake.fetchImpl, suppressed: async () => false, mirror: async () => undefined });
    expect(r.outcome).toBe("created");
    expect(postedBody(fake).email).toBe("user-4ed88e9d@example.com");
    expect(postedBody(fake).custom_attributes.mp_marketing_opt_in).toBe(false);
  });

  it("flag on, updated contact: the PUT carries the address", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    const fake = fakeIntercom({
      [`GET /contacts/find_by_external_id/${EXT}`]: [{ status: 200, body: { id: "c9" } }],
      "PUT /contacts/c9": [{ status: 200, body: {} }],
    });
    const r = await syncIntercomContact(EXT, "exam_set", { now: NOW, loadUser: async () => UNPROVEN, fetchImpl: fake.fetchImpl, suppressed: async () => false });
    expect(r.outcome).toBe("updated");
    expect((fake.calls.find((c) => c.method === "PUT")!.body as { email?: string }).email).toBe("user-4ed88e9d@example.com");
  });

  it("flag on, suppressed or unreadable list: no address, attributes still sync", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    for (const suppressed of [async () => true, async () => { throw new Error("db"); }]) {
      resetIntercomSyncDebounce();
      const fake = newContactScript();
      const r = await syncIntercomContact(EXT, "register", { now: NOW, loadUser: async () => UNPROVEN, fetchImpl: fake.fetchImpl, suppressed, mirror: async () => undefined });
      expect(r.outcome).toBe("created");
      expect(postedBody(fake)).not.toHaveProperty("email");
      expect(postedBody(fake).custom_attributes.mp_exam).toBe("kenntnispruefung");
    }
  });

  it("flag on, the address sits on another contact: the 409 retry drops it, never adopts", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    const fake = fakeIntercom({
      [`GET /contacts/find_by_external_id/${EXT}`]: [{ status: 404 }],
      "POST /contacts": [{ status: 409, body: { errors: [{ code: "conflict" }] } }, { status: 200, body: { id: "c2" } }],
    });
    const r = await syncIntercomContact(EXT, "register", { now: NOW, loadUser: async () => UNPROVEN, fetchImpl: fake.fetchImpl, suppressed: async () => false, mirror: async () => undefined });
    expect(r.outcome).toBe("created_without_email");
    const posts = fake.calls.filter((c) => c.method === "POST").map((c) => c.body as Record<string, unknown>);
    expect(posts[0].email).toBe("user-4ed88e9d@example.com");
    expect(posts[1]).not.toHaveProperty("email");
    expect(fake.calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("flag on never syncs banned or staff accounts and reads no suppression for them", async () => {
    process.env.MEDPRUF_INTERCOM_EMAIL_REACH_ENABLED = "true";
    const suppressed = vi.fn(async () => false);
    expect((await syncIntercomContact(EXT, "login", { now: NOW, loadUser: async () => ({ ...UNPROVEN, is_banned: true }), suppressed })).outcome).toBe("skipped_banned");
    expect((await syncIntercomContact(EXT, "tier_change", { now: NOW, loadUser: async () => ({ ...UNPROVEN, email: "user-2ac81aa9@example.com" }), suppressed })).outcome).toBe("skipped_staff");
    expect(suppressed).not.toHaveBeenCalled();
  });
});

describe("Messenger JWT stays on the proven rule", () => {
  it("the identify route signs contactEmail only, never reachEmail", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/api/intercom/identify/route.ts", "utf8");
    expect(src).toMatch(/contactEmail\(data\)/);
    expect(src).not.toMatch(/reachEmail|emailReach|email-reach/);
  });
});
