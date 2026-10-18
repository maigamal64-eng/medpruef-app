/**
 * a-intercom-contact-sync: flag off means no read and no call; 4 s deadline;
 * MedPrüf token only (never BLINK_* or the generic token); upsert by
 * external_id with 404 / 409 / 410 handling; erasure deletes.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceClient } = vi.hoisted(() => ({
  getServiceClient: vi.fn(() => {
    throw new Error("database must not be read in these tests");
  }),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient }));

import { INTERCOM_TIMEOUT_MS, INTERCOM_API_VERSION, intercomConfig, intercomRequest, intercomRestBase } from "@/lib/intercom/api";
import {
  eraseIntercomContact,
  resetIntercomSyncDebounce,
  scheduleIntercomContactSync,
  syncIntercomContact,
  upsertContact,
} from "@/lib/intercom/sync";
import { buildContactPayload } from "@/lib/intercom/contact-payload";
import { signIntercomIdentity } from "@/lib/intercom-identity";
import { fakeIntercom, LEARNER } from "./fake-intercom";

const ENV_NAMES = [
  "MEDPRUF_INTERCOM_SYNC_ENABLED",
  "NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC",
  "MEDPRUF_INTERCOM_ACCESS_TOKEN",
  "MEDPRUF_INTERCOM_REGION",
  "INTERCOM_ACCESS_TOKEN",
  "BLINK_EU_INTERCOM_ACCESS_TOKEN",
  "BLINK_INTERCOM_ACCESS_TOKEN",
];
const saved: Record<string, string | undefined> = {};
const BASE = "https://api.intercom.io";
const EXT = LEARNER.id;
const NOW = new Date("2026-10-17T12:00:00Z");

beforeEach(() => {
  for (const n of ENV_NAMES) { saved[n] = process.env[n]; delete process.env[n]; }
  resetIntercomSyncDebounce();
  getServiceClient.mockClear();
});
afterEach(() => {
  for (const n of ENV_NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function on() {
  process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
}
const cfg = () => intercomConfig()!;
const body = () => buildContactPayload(LEARNER, { now: NOW, lastActiveAt: 1_760_000_000 });

describe("flag off", () => {
  it("schedule and sync do nothing: no database read, no fetch", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    scheduleIntercomContactSync(EXT, "register");
    const r = await syncIntercomContact(EXT, "login");
    await new Promise((res) => setTimeout(res, 5));
    expect(r.outcome).toBe("disabled");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getServiceClient).not.toHaveBeenCalled();
  });

  it("the runtime flag without its build copy stays off (privacy page would not name the sync)", () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok";
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    expect(intercomConfig()).toBeNull();
    expect(intercomConfig({ requireBuildCopy: false })).not.toBeNull();
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    expect(intercomConfig()).not.toBeNull();
  });

  it("sync needs region us (privacy text names the USA); erasure works in any region", () => {
    on();
    process.env.MEDPRUF_INTERCOM_REGION = "eu";
    expect(intercomConfig()).toBeNull();
    expect(intercomConfig({ requireFlag: false })?.base).toBe("https://api.eu.intercom.io");
  });

  it("only the literal true switches it on", () => {
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok";
    for (const v of ["1", "TRUE", "yes", " true"]) {
      process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = v;
      expect(intercomConfig()).toBeNull();
    }
  });

  it("the JWT payload is unchanged without claims", () => {
    const jwt = signIntercomIdentity("u1", "secret", 1000);
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload).toEqual({ user_id: "u1", iat: 1000, exp: 1300 });
  });
});

describe("token and host", () => {
  it("never uses the generic or BLINK tokens", async () => {
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    process.env.INTERCOM_ACCESS_TOKEN = "tok-generic";
    process.env.BLINK_EU_INTERCOM_ACCESS_TOKEN = "tok-blink";
    process.env.BLINK_INTERCOM_ACCESS_TOKEN = "tok-blink2";
    expect(intercomConfig()).toBeNull();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect((await syncIntercomContact(EXT, "login")).outcome).toBe("disabled");
    expect((await eraseIntercomContact(EXT)).outcome).toBe("no_token");
    expect(fetchSpy).not.toHaveBeenCalled();

    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const fake = fakeIntercom({ "GET /contacts/find_by_external_id/11111111-2222-3333-4444-555555555555": [{ status: 404 }], "POST /contacts": [{ status: 200, body: { id: "c1" } }] });
    await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl });
    for (const call of fake.calls) {
      expect(call.headers.Authorization).toBe("Bearer tok-medpruf");
      expect(call.headers["Intercom-Version"]).toBe("2.17");
    }
  });

  it("source never names the BLINK or generic token", () => {
    const dir = path.resolve(__dirname, "../../../src/lib/intercom");
    const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), path.resolve(__dirname, "../../../src/lib/intercom-identity.ts")];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      expect(src).not.toMatch(/process\.env\.(BLINK_\w+|INTERCOM_ACCESS_TOKEN)\b/);
      expect(src).not.toMatch(/process\.env\[\s*["']BLINK/);
    }
  });

  it("REST host by region, never the api-iam Messenger host", () => {
    expect(intercomRestBase(undefined)).toBe("https://api.intercom.io");
    expect(intercomRestBase("eu")).toBe("https://api.eu.intercom.io");
    expect(intercomRestBase("au")).toBe("https://api.au.intercom.io");
    expect(intercomRestBase("mars")).toBeNull();
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "t";
    process.env.MEDPRUF_INTERCOM_REGION = "mars";
    expect(intercomConfig()).toBeNull();
  });
});

describe("4 s deadline", () => {
  it("every request carries AbortSignal.timeout(4000) and the pinned version", async () => {
    on();
    expect(INTERCOM_TIMEOUT_MS).toBe(4000);
    expect(INTERCOM_API_VERSION).toBe("2.17");
    const spy = vi.spyOn(AbortSignal, "timeout");
    const fake = fakeIntercom({ "GET /me": [{ status: 200, body: {} }] });
    await intercomRequest(cfg(), "GET", "/me", undefined, { fetchImpl: fake.fetchImpl });
    expect(spy).toHaveBeenCalledWith(4000);
  });

  it("a hung call ends as a timeout result, never a throw", async () => {
    on();
    const hung = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const r = await intercomRequest(cfg(), "GET", "/contacts/x", undefined, { fetchImpl: hung, timeoutMs: 20 });
    expect(r).toMatchObject({ ok: false, status: 0, reason: "timeout" });
    const s = await upsertContact(cfg(), body(), { fetchImpl: hung, timeoutMs: 20 });
    expect(s.outcome).toBe("failed");
  });
});

describe("upsert by external_id", () => {
  const FIND = `GET /contacts/find_by_external_id/${EXT}`;

  it("found: PUT the contact", async () => {
    on();
    const fake = fakeIntercom({ [FIND]: [{ status: 200, body: { id: "c9", external_id: EXT } }], "PUT /contacts/c9": [{ status: 200, body: { id: "c9" } }] });
    const r = await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl });
    expect(r.outcome).toBe("updated");
    expect(fake.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(fake.calls[1].body).toMatchObject({ role: "user", external_id: EXT, email: "user-4ed88e9d@example.com", name: "Amira Haddad" });
  });

  it("404 on lookup: POST a user", async () => {
    on();
    const fake = fakeIntercom({ [FIND]: [{ status: 404, body: { type: "error.list", errors: [{ code: "not_found" }] } }], "POST /contacts": [{ status: 200, body: { id: "c1" } }] });
    expect((await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl })).outcome).toBe("created");
    expect(fake.calls[1].url).toBe(`${BASE}/contacts`);
  });

  it("POST 409 (email on another contact): never adopts it, POSTs again without the email", async () => {
    on();
    const fake = fakeIntercom({ [FIND]: [{ status: 404 }], "POST /contacts": [{ status: 409, body: { errors: [{ code: "conflict" }] } }, { status: 200, body: { id: "c2" } }] });
    const r = await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl });
    expect(r.outcome).toBe("created_without_email");
    expect(fake.calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([FIND, "POST /contacts", "POST /contacts"]);
    expect(fake.calls[2].body).not.toHaveProperty("email");
    expect(fake.calls[2].body).toMatchObject({ external_id: EXT });
    expect(fake.calls.some((c) => c.method === "PUT" || /search/.test(c.url))).toBe(false);
  });

  it("PUT 409: PUTs again without the email", async () => {
    on();
    const fake = fakeIntercom({ [FIND]: [{ status: 200, body: { id: "c9" } }], "PUT /contacts/c9": [{ status: 409 }, { status: 200, body: { id: "c9" } }] });
    expect((await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl })).outcome).toBe("updated_without_email");
    expect(fake.calls[2].body).not.toHaveProperty("email");
  });

  it("PUT 404 (deleted in between): POSTs", async () => {
    on();
    const fake = fakeIntercom({ [FIND]: [{ status: 200, body: { id: "c9" } }], "PUT /contacts/c9": [{ status: 404 }], "POST /contacts": [{ status: 200, body: { id: "c10" } }] });
    expect((await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl })).outcome).toBe("created");
  });

  it("410 merged: updates the canonical contact only when its external_id is ours", async () => {
    on();
    const merged = { status: 410, headers: { Link: `<${BASE}/contacts/canon1>; rel="canonical"` } };
    const ok = fakeIntercom({ [FIND]: [merged], "GET /contacts/canon1": [{ status: 200, body: { id: "canon1", external_id: EXT } }], "PUT /contacts/canon1": [{ status: 200, body: {} }] });
    expect((await upsertContact(cfg(), body(), { fetchImpl: ok.fetchImpl })).outcome).toBe("updated");
    const other = fakeIntercom({ [FIND]: [merged], "GET /contacts/canon1": [{ status: 200, body: { id: "canon1", external_id: "someone-else" } }] });
    expect((await upsertContact(cfg(), body(), { fetchImpl: other.fetchImpl })).outcome).toBe("merged_skipped");
    expect(other.calls.some((c) => c.method !== "GET")).toBe(false);
  });

  it("429 and 5xx fail without retry", async () => {
    on();
    for (const status of [429, 500, 503]) {
      const fake = fakeIntercom({ [FIND]: [{ status }] });
      expect((await upsertContact(cfg(), body(), { fetchImpl: fake.fetchImpl })).outcome).toBe("failed");
      expect(fake.calls).toHaveLength(1);
    }
  });
});

describe("sync rules", () => {
  it("skips admin, staff/test and banned accounts without calling Intercom", async () => {
    on();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const cases: Array<[Partial<typeof LEARNER> & { role?: string }, string]> = [
      [{ role: "admin" }, "skipped_staff"],
      [{ email: "user-b7e46e80@example.com" }, "skipped_staff"],
      [{ email: "user-2ac81aa9@example.com" }, "skipped_staff"],
      [{ is_banned: true }, "skipped_banned"],
    ];
    for (const [patch, outcome] of cases) {
      const r = await syncIntercomContact(EXT, "tier_change", { now: NOW, loadUser: async () => ({ ...LEARNER, ...patch }) });
      expect(r.outcome).toBe(outcome);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("debounces repeated logins on one instance, never other reasons", async () => {
    on();
    const fake = fakeIntercom({
      [`GET /contacts/find_by_external_id/${EXT}`]: [{ status: 200, body: { id: "c9" } }, { status: 200, body: { id: "c9" } }],
      "PUT /contacts/c9": [{ status: 200, body: {} }, { status: 200, body: {} }],
    });
    const opts = { now: NOW, loadUser: async () => LEARNER, fetchImpl: fake.fetchImpl };
    expect((await syncIntercomContact(EXT, "login", opts)).outcome).toBe("updated");
    expect((await syncIntercomContact(EXT, "login", opts)).outcome).toBe("skipped_debounced");
    expect((await syncIntercomContact(EXT, "exam_set", opts)).outcome).toBe("updated");
  });

  it("stamps last activity only for learner actions", async () => {
    on();
    const fake = fakeIntercom({
      [`GET /contacts/find_by_external_id/${EXT}`]: [{ status: 404 }, { status: 404 }],
      "POST /contacts": [{ status: 200, body: {} }, { status: 200, body: {} }],
    });
    await syncIntercomContact(EXT, "register", { now: NOW, loadUser: async () => LEARNER, fetchImpl: fake.fetchImpl });
    await syncIntercomContact(EXT, "tier_change", { now: NOW, loadUser: async () => LEARNER, fetchImpl: fake.fetchImpl });
    const posts = fake.calls.filter((c) => c.method === "POST").map((c) => (c.body as { custom_attributes: Record<string, unknown> }).custom_attributes);
    expect(posts[0].mp_last_active_at).toBe(Math.floor(NOW.getTime() / 1000));
    expect(posts[1]).not.toHaveProperty("mp_last_active_at");
  });

  it("a failed users read is a failed sync, never a throw", async () => {
    on();
    const r = await syncIntercomContact(EXT, "login", { loadUser: async () => { throw new Error("db"); } });
    expect(r).toEqual({ outcome: "failed", code: "exception" });
  });
});

describe("erasure", () => {
  const FIND = `GET /contacts/find_by_external_id/${EXT}`;
  it("deletes the contact, also with the sync flag off", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const fake = fakeIntercom({ [FIND]: [{ status: 200, body: { id: "c9" } }], "DELETE /contacts/c9": [{ status: 200, body: { id: "c9", deleted: true } }] });
    const r = await eraseIntercomContact(EXT, { fetchImpl: fake.fetchImpl });
    expect(r.outcome).toBe("deleted");
    expect(fake.calls.map((c) => c.method)).toEqual(["GET", "DELETE"]);
  });
  it("a contact that is already gone counts as erased", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const fake = fakeIntercom({ [FIND]: [{ status: 404 }] });
    expect((await eraseIntercomContact(EXT, { fetchImpl: fake.fetchImpl })).outcome).toBe("not_found");
  });
  it("410 merged: deletes the canonical contact only when it carries our external_id", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const merged = { status: 410, headers: { Link: `<${BASE}/contacts/canon1>` } };
    const ok = fakeIntercom({ [FIND]: [merged], "GET /contacts/canon1": [{ status: 200, body: { external_id: EXT } }], "DELETE /contacts/canon1": [{ status: 200, body: {} }] });
    expect((await eraseIntercomContact(EXT, { fetchImpl: ok.fetchImpl })).outcome).toBe("deleted");
    const other = fakeIntercom({ [FIND]: [merged], "GET /contacts/canon1": [{ status: 200, body: { external_id: "x" } }] });
    expect((await eraseIntercomContact(EXT, { fetchImpl: other.fetchImpl })).outcome).toBe("merged_skipped");
  });
  it("a failing delete reports failed", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
    const fake = fakeIntercom({ [FIND]: [{ status: 200, body: { id: "c9" } }], "DELETE /contacts/c9": [{ status: 500 }] });
    expect((await eraseIntercomContact(EXT, { fetchImpl: fake.fetchImpl })).outcome).toBe("failed");
  });
});

describe("JWT claims", () => {
  it("signs email and name only when given", () => {
    const jwt = signIntercomIdentity("u1", "secret", 1000, { email: "user-65abd062@example.com", name: "A B" });
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    expect(payload).toEqual({ user_id: "u1", iat: 1000, exp: 1300, email: "user-65abd062@example.com", name: "A B" });
  });
});
