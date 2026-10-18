/**
 * a-intercom-contact-sync: contact body, backfill guards, privacy entry,
 * hook coverage.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ getServiceClient: () => { throw new Error("no db"); } }));

import { buildContactPayload, effectiveTier, MP_ATTRIBUTES, withoutEmail } from "@/lib/intercom/contact-payload";
import {
  applyRefusal,
  BACKFILL_MAX_BATCH,
  BACKFILL_MAX_LIMIT,
  clampArgs,
  doneFromLedger,
  planBackfill,
  runBackfill,
  type BackfillRow,
  type LedgerEntry,
} from "@/lib/intercom/backfill";
import { intercomPrivacyEntry, INTERCOM_CONTACT_SYNC_ENTRY, INTERCOM_MESSENGER_ENTRY } from "@/lib/intercom/privacy-copy";
import { fakeIntercom, LEARNER } from "./fake-intercom";

const NOW = new Date("2026-10-17T12:00:00Z");
const ROOT = path.resolve(__dirname, "../../..");

describe("contact payload", () => {
  it("maps the nine attributes in unix seconds", () => {
    const b = buildContactPayload(LEARNER, { now: NOW, lastActiveAt: 1_760_700_000 });
    expect(b).toEqual({
      role: "user",
      external_id: LEARNER.id,
      email: "user-4ed88e9d@example.com",
      name: "Amira Haddad",
      signed_up_at: Date.parse("2026-10-01T08:00:00Z") / 1000,
      custom_attributes: {
        mp_exam: "kenntnispruefung",
        mp_sitting_date: Date.parse("2026-11-23T00:00:00Z") / 1000,
        mp_tier: "pro",
        mp_plan_ends_at: Date.parse("2026-12-01T10:00:00Z") / 1000,
        mp_ui_lang: "de",
        mp_signup_at: Date.parse("2026-10-01T08:00:00Z") / 1000,
        mp_last_active_at: 1_760_700_000,
        mp_telegram_linked: true,
        mp_marketing_opt_in: false,
      },
    });
    expect(Object.keys(b.custom_attributes).sort()).toEqual(MP_ATTRIBUTES.map((a) => a.name).sort());
  });

  it("omits empty name and email, never sends an empty string", () => {
    const b = buildContactPayload({ id: "u2", email: "  ", first_name: " ", last_name: null, telegram_id: null }, { now: NOW, lastActiveAt: null });
    expect(b).not.toHaveProperty("email");
    expect(b).not.toHaveProperty("name");
    expect(b.custom_attributes).not.toHaveProperty("mp_last_active_at");
    expect(b.custom_attributes.mp_telegram_linked).toBe(false);
    expect(b.custom_attributes.mp_tier).toBe("free");
    expect(withoutEmail(buildContactPayload(LEARNER, { now: NOW, lastActiveAt: null }))).not.toHaveProperty("email");
  });

  it("sends the address only when the learner proved it", () => {
    const opts = { now: NOW, lastActiveAt: null };
    expect(buildContactPayload({ ...LEARNER, email_verified_at: null }, opts)).not.toHaveProperty("email");
    expect(buildContactPayload({ ...LEARNER, email_status: "unverified" }, opts)).not.toHaveProperty("email");
    expect(buildContactPayload(LEARNER, opts).email).toBe("user-4ed88e9d@example.com");
    expect(buildContactPayload(LEARNER, opts)).not.toHaveProperty("email_verified");
  });

  it("tier follows the paywall rule: expired Pro is free and has no plan end", () => {
    expect(effectiveTier("pro", null, NOW)).toBe("pro");
    expect(effectiveTier("pro", "2026-10-01T00:00:00Z", NOW)).toBe("free");
    expect(effectiveTier("pro", "garbage", NOW)).toBe("free");
    expect(effectiveTier("free", "2027-01-01T00:00:00Z", NOW)).toBe("free");
    const b = buildContactPayload({ ...LEARNER, tier_expires_at: "2026-10-10T00:00:00Z" }, { now: NOW, lastActiveAt: null });
    expect(b.custom_attributes.mp_tier).toBe("free");
    expect(b.custom_attributes.mp_plan_ends_at).toBeNull();
  });

  it("a malformed exam date is cleared, not sent", () => {
    const b = buildContactPayload({ ...LEARNER, exam_date: "23.11.2026" }, { now: NOW, lastActiveAt: null });
    expect(b.custom_attributes.mp_sitting_date).toBeNull();
  });
});

const rows = (n: number): BackfillRow[] =>
  Array.from({ length: n }, (_, i) => ({ ...LEARNER, id: `${String(i).padStart(8, "0")}-0000-0000-0000-000000000000`, last_active: "2026-10-15" }));

describe("backfill guards", () => {
  it("clamps batch and limit", () => {
    expect(clampArgs({})).toEqual({ apply: false, batch: 25, limit: 100 });
    expect(clampArgs({ batch: 999, limit: 10 ** 9 })).toMatchObject({ batch: BACKFILL_MAX_BATCH, limit: BACKFILL_MAX_LIMIT });
    expect(clampArgs({ batch: -3, limit: Number.NaN })).toMatchObject({ batch: 25, limit: 100 });
  });

  it("apply needs CONFIRM=yes, config and no re-entry", () => {
    const cfg = { base: "https://api.intercom.io", token: "t" };
    expect(applyRefusal({}, cfg)).toMatch(/CONFIRM/);
    expect(applyRefusal({ CONFIRM: "yes" }, null)).toMatch(/MEDPRUF_INTERCOM_SYNC_ENABLED/);
    expect(applyRefusal({ CONFIRM: "yes", MEDPRUF_INTERCOM_BACKFILL_RUNNING: "1" }, cfg)).toMatch(/another backfill/);
    expect(applyRefusal({ CONFIRM: "yes" }, cfg)).toBeNull();
  });

  it("plans counts: staff, banned, ledger, limit", () => {
    const list: BackfillRow[] = [
      ...rows(3),
      { ...LEARNER, id: "a", role: "admin" },
      { ...LEARNER, id: "b", email: "user-41586b3e@example.com" },
      { ...LEARNER, id: "c", is_banned: true },
    ];
    const done = new Set([list[0].id.replace(/-/g, "").slice(0, 8)]);
    const { counts, toSync } = planBackfill(list, { limit: 1, done });
    expect(counts).toEqual({ total: 6, would_sync: 1, skipped_staff: 2, skipped_banned: 1, already_in_ledger: 1, over_limit: 1 });
    expect(toSync).toHaveLength(1);
  });

  it("runs in batches with a pause, ledger carries uid8 only, stops on 401", async () => {
    const script: Record<string, Array<{ status: number; body?: unknown }>> = { "POST /contacts": [] };
    const list = rows(5);
    for (const [i, r] of list.entries()) {
      script[`GET /contacts/find_by_external_id/${r.id}`] = [{ status: i === 3 ? 401 : 404 }];
      script["POST /contacts"].push({ status: 200, body: {} });
    }
    const fake = fakeIntercom(script);
    const ledger: LedgerEntry[] = [];
    const sleeps: number[] = [];
    const summary = await runBackfill(list, { apply: true, batch: 2, limit: 100 }, {
      cfg: { base: "https://api.intercom.io", token: "t" },
      now: () => NOW,
      sleep: async (ms) => { sleeps.push(ms); },
      writeLedger: (e) => ledger.push(e),
      fetchImpl: fake.fetchImpl,
    });
    expect(summary.stopped).toBe("auth");
    expect(summary.attempted).toBe(4);
    expect(sleeps).toEqual([1000]);
    for (const e of ledger) {
      expect(Object.keys(e).sort()).toEqual(["at", "outcome", "status", "uid8"]);
      expect(e.uid8).toHaveLength(8);
      expect(JSON.stringify(e)).not.toMatch(/@|Amira|Haddad/);
    }
    expect(doneFromLedger(ledger.map((e) => JSON.stringify(e)))).toEqual(new Set(ledger.filter((e) => e.outcome !== "failed").map((e) => e.uid8)));
  });

  it("a 429 waits and is not counted as a failure", async () => {
    const list = rows(7);
    const script: Record<string, Array<{ status: number }>> = {};
    for (const r of list) script[`GET /contacts/find_by_external_id/${r.id}`] = [{ status: 429 }];
    const fake = fakeIntercom(script);
    const sleeps: number[] = [];
    const summary = await runBackfill(list, { apply: true, batch: 50, limit: 100 }, {
      cfg: { base: "https://api.intercom.io", token: "t" }, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, writeLedger: () => {}, fetchImpl: fake.fetchImpl,
    });
    expect(summary).toMatchObject({ stopped: null, attempted: 7 });
    expect(sleeps).toEqual(Array(7).fill(10_000));
  });

  it("stops after five failures in a row", async () => {
    const list = rows(8);
    const script: Record<string, Array<{ status: number }>> = {};
    for (const r of list) script[`GET /contacts/find_by_external_id/${r.id}`] = [{ status: 503 }];
    const fake = fakeIntercom(script);
    const summary = await runBackfill(list, { apply: true, batch: 50, limit: 100 }, {
      cfg: { base: "https://api.intercom.io", token: "t" }, now: () => NOW, sleep: async () => {}, writeLedger: () => {}, fetchImpl: fake.fetchImpl,
    });
    expect(summary).toMatchObject({ stopped: "failures", attempted: 5 });
  });

  it("dry run against local data prints counts only", async () => {
    const { execFileSync } = await import("node:child_process");
    const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "ic-backfill-"));
    const input = path.join(tmp, "rows.jsonl");
    fs.writeFileSync(input, [...rows(3), { ...LEARNER, id: "z", role: "admin" }].map((r) => JSON.stringify(r)).join("\n"));
    const out = execFileSync(path.join(ROOT, "node_modules/.bin/vite-node"), ["--config", "vitest.config.ts", "scripts/intercom/backfill-contacts.ts", "--", "--input", input], {
      cwd: ROOT,
      env: { ...process.env, MEDPRUF_INTERCOM_SYNC_ENABLED: "", MEDPRUF_INTERCOM_ACCESS_TOKEN: "", NEXT_PUBLIC_SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" },
      encoding: "utf8",
      timeout: 60_000,
    });
    const parsed = JSON.parse(out.slice(out.indexOf("{")));
    expect(parsed).toEqual({ mode: "dry_run", total: 4, would_sync: 3, skipped_staff: 1, skipped_banned: 0, already_in_ledger: 0, over_limit: 0, batch: 25, limit: 100 });
    expect(out).not.toMatch(/@|Amira|0000000/);
  }, 90_000);
});

describe("privacy entry", () => {
  it("off: none; messenger only: the earlier text; sync: the contact sync text", () => {
    expect(intercomPrivacyEntry({ messenger: false, sync: false })).toBeNull();
    expect(intercomPrivacyEntry({ messenger: true, sync: false })).toBe(INTERCOM_MESSENGER_ENTRY);
    expect(intercomPrivacyEntry({ messenger: false, sync: true })).toBe(INTERCOM_CONTACT_SYNC_ENTRY);
    expect(intercomPrivacyEntry({ messenger: true, sync: true })).toBe(INTERCOM_CONTACT_SYNC_ENTRY);
  });
  it("names Intercom USA, uses Sie and no dashes", () => {
    const e = INTERCOM_CONTACT_SYNC_ENTRY;
    expect(e.jurisdiction.de).toContain("USA");
    expect(e.jurisdiction.en).toContain("USA");
    for (const t of [e.purpose.de, e.purpose.en, e.jurisdiction.de, e.jurisdiction.en]) expect(t).not.toMatch(/[–—]/);
    expect(e.purpose.de).not.toMatch(/\b(du|dein|deine|dir)\b/i);
  });
});

describe("hooks", () => {
  const expectations: Array<[string, string]> = [
    ["src/app/api/auth/route.ts", '"register"'],
    ["src/app/api/auth/route.ts", '"login"'],
    ["src/app/api/user/exam-preference/route.ts", "'exam_set'"],
    ["src/app/api/user/language/route.ts", "'language_change'"],
    ["src/app/api/user/email-update/route.ts", '"email_change"'],
    ["src/lib/whop-grant.ts", '"tier_change"'],
    ["src/app/api/webhooks/whop/route.ts", '"tier_change"'],
    ["src/app/api/admin/users/grant/route.ts", '"tier_change"'],
    ["src/lib/admin/puyp-decision.ts", '"tier_change"'],
  ];
  it.each(expectations)("%s schedules a sync (%s)", (file, reason) => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toMatch(new RegExp(`scheduleIntercomContactSync\\([^)]*${reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  });
});
