import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/email/zoho", () => ({ sendZohoEmail: vi.fn(async () => ({ ok: true, messageId: "real" })) }));

import { sendZohoEmail } from "@/lib/email/zoho";
import {
  adminSuppressionFlags,
  checkSuppression,
  isMailSuppressed,
  liftSuppression,
  normalizeMailAddress,
  partitionRecipients,
  recordSuppression,
  scopeBlocks,
  sendUnlessSuppressed,
  suppressionKey,
} from "@/lib/mail-suppression";

type Row = { id: string; email_key: string; cause: string; scope: string; source: string; created_at: string; lifted_at: string | null };

function fakeDb(rows: Row[], opts: { failRead?: boolean; rpc?: (fn: string, args: Record<string, unknown>) => { data: unknown; error: unknown } } = {}) {
  const calls: { keys: string[][]; rpc: Array<[string, Record<string, unknown>]> } = { keys: [], rpc: [] };
  const db = {
    from(table: string) {
      expect(table).toBe("mail_suppression");
      let keys: string[] = [];
      let liftedNull = false;
      const q = {
        select: () => q,
        in: (col: string, values: string[]) => { expect(col).toBe("email_key"); keys = values; calls.keys.push(values); return q; },
        is: (col: string, value: null) => { expect(col).toBe("lifted_at"); expect(value).toBeNull(); liftedNull = true; return q; },
        then: (resolve: (v: unknown) => unknown) => {
          if (opts.failRead) return Promise.resolve({ data: null, error: { message: "boom secret@x.y" } }).then(resolve);
          const data = rows.filter((r) => keys.includes(r.email_key) && (!liftedNull || r.lifted_at === null))
            .map((r) => ({ id: r.id, email_key: r.email_key, cause: r.cause, scope: r.scope, source: r.source, created_at: r.created_at }));
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return q;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.rpc.push([fn, args]);
      return opts.rpc ? opts.rpc(fn, args) : { data: null, error: { message: "no rpc" } };
    },
  };
  return { db: db as unknown as SupabaseClient, calls };
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const row = (email: string, extra: Partial<Row> = {}): Row => ({
  id: `id-${email}-${extra.cause ?? "opt_out"}`, email_key: sha(email), cause: "opt_out", scope: "all",
  source: "comms-log", created_at: "2026-09-21T10:00:00Z", lifted_at: null, ...extra,
});

describe("address keying", () => {
  it("normalizes ASCII whitespace and case, and matches the SQL key definition", () => {
    expect(normalizeMailAddress("  Doc.Test@Example.AT \n")).toBe("doc.test@example.at");
    expect(suppressionKey("  Doc.Test@Example.AT \t")).toBe(sha("doc.test@example.at"));
    expect(suppressionKey("doc.test@example.at")).toMatch(/^[0-9a-f]{64}$/);
  });
  it("refuses addresses it cannot key safely", () => {
    for (const bad of [null, undefined, "", "   ", "no-at-sign", "a@b@c", "a b@c.d", "ärzt@example.at", `${"a".repeat(250)}@x.at`]) {
      expect(suppressionKey(bad as string)).toBeNull();
    }
  });
});

describe("scope rule", () => {
  it("scope all blocks every category, marketing only blocks marketing, unknown blocks all", () => {
    expect(scopeBlocks("all", "transactional")).toBe(true);
    expect(scopeBlocks("all", "marketing")).toBe(true);
    expect(scopeBlocks("marketing", "marketing")).toBe(true);
    expect(scopeBlocks("marketing", "transactional")).toBe(false);
    expect(scopeBlocks("weird", "transactional")).toBe(true);
  });
});

describe("partitionRecipients (segment builds)", () => {
  it("withholds suppressed and unkeyable recipients and reports counts only", async () => {
    const { db } = fakeDb([
      row("stopp@example.at"),
      row("bounce@example.de", { cause: "hard_bounce" }),
      row("promo-only@example.at", { scope: "marketing" }),
      row("lifted@example.at", { lifted_at: "2026-10-01T00:00:00Z" }),
    ]);
    const list = ["ok@example.at", "STOPP@example.at", "bounce@example.de", "promo-only@example.at", "lifted@example.at", "broken"]
      .map((email, i) => ({ i, email }));
    const marketing = await partitionRecipients(db, list, (r) => r.email, "marketing");
    expect(marketing.allowed.map((r) => r.email)).toEqual(["ok@example.at", "lifted@example.at"]);
    expect(marketing).toMatchObject({ suppressed: 3, invalid: 1 });
    const receipts = await partitionRecipients(db, list, (r) => r.email, "transactional");
    expect(receipts.allowed.map((r) => r.email)).toEqual(["ok@example.at", "promo-only@example.at", "lifted@example.at"]);
  });
  it("chunks lookups at 100 keys and de-duplicates", async () => {
    const { db, calls } = fakeDb([]);
    const list = Array.from({ length: 250 }, (_, i) => `u${i % 230}@example.at`);
    const res = await partitionRecipients(db, list, (e) => e, "marketing");
    expect(res.allowed).toHaveLength(250);
    expect(calls.keys.map((k) => k.length)).toEqual([100, 100, 30]);
  });
  it("fails closed: a read error throws a message without the database text", async () => {
    const { db } = fakeDb([], { failRead: true });
    await expect(partitionRecipients(db, ["user-65abd062@example.com"], (e) => e, "marketing")).rejects.toThrow(/^Mail suppression lookup failed$/);
  });
});

describe("single sends", () => {
  it("isMailSuppressed is true for suppressed, invalid and unreadable", async () => {
    const { db } = fakeDb([row("stopp@example.at")]);
    expect(await isMailSuppressed(db, "stopp@example.at", "marketing")).toBe(true);
    expect(await isMailSuppressed(db, "fine@example.at", "marketing")).toBe(false);
    expect(await isMailSuppressed(db, "not an address", "transactional")).toBe(true);
    expect(await isMailSuppressed(fakeDb([], { failRead: true }).db, "fine@example.at", "marketing")).toBe(true);
  });
  it("sendUnlessSuppressed never calls the provider for a withheld address", async () => {
    const send = vi.fn(async () => ({ ok: true as const, messageId: "m1" }));
    const { db } = fakeDb([row("stopp@example.at"), row("promo@example.at", { scope: "marketing" })]);
    const mail = (to: string) => ({ to, subject: "s", htmlBody: "<p>x</p>" });
    expect(await sendUnlessSuppressed(db, "marketing", mail(" Stopp@Example.at"), send)).toEqual({ ok: false, reason: "suppressed" });
    expect(await sendUnlessSuppressed(db, "marketing", mail("promo@example.at"), send)).toEqual({ ok: false, reason: "suppressed" });
    expect(await sendUnlessSuppressed(db, "marketing", mail("x"), send)).toEqual({ ok: false, reason: "invalid_address" });
    expect(await sendUnlessSuppressed(fakeDb([], { failRead: true }).db, "marketing", mail("user-65abd062@example.com"), send)).toEqual({ ok: false, reason: "suppression_check_failed" });
    expect(send).not.toHaveBeenCalled();
    expect(await sendUnlessSuppressed(db, "transactional", mail("promo@example.at"), send)).toEqual({ ok: true, messageId: "m1" });
    expect(await sendUnlessSuppressed(db, "marketing", mail("fine@example.at"), send)).toEqual({ ok: true, messageId: "m1" });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("checkSuppression reports status and throws on an unreadable list", async () => {
    const { db } = fakeDb([row("stopp@example.at", { scope: "marketing" })]);
    expect(await checkSuppression(db, "Stopp@example.at", "marketing")).toBe("suppressed");
    expect(await checkSuppression(db, "stopp@example.at", "transactional")).toBe("clear");
    expect(await checkSuppression(db, "nope", "marketing")).toBe("invalid");
    await expect(checkSuppression(fakeDb([], { failRead: true }).db, "user-65abd062@example.com", "marketing")).rejects.toThrow(/^Mail suppression lookup failed$/);
  });
  it("defaults to the Zoho sender", async () => {
    const { db } = fakeDb([]);
    expect(await sendUnlessSuppressed(db, "marketing", { to: "user-65abd062@example.com", subject: "s", htmlBody: "b" })).toEqual({ ok: true, messageId: "real" });
    expect(sendZohoEmail).toHaveBeenCalledTimes(1);
  });
});

describe("admin flags", () => {
  it("maps each given address to its flag and leaves clean ones out", async () => {
    const { db } = fakeDb([
      row("a@example.at", { cause: "opt_out", scope: "marketing", created_at: "2026-09-22T00:00:00Z" }),
      row("a@example.at", { cause: "hard_bounce", created_at: "2026-09-21T00:00:00Z" }),
      row("b@example.at", { scope: "marketing" }),
    ]);
    const flags = await adminSuppressionFlags(db, ["A@example.at", "b@example.at", "c@example.at", null, "bad"]);
    expect(flags.get("A@example.at")).toEqual({ suppressed: true, causes: ["hard_bounce", "opt_out"], scope: "all", since: "2026-09-21T00:00:00Z" });
    expect(flags.get("b@example.at")?.scope).toBe("marketing");
    expect(flags.has("c@example.at")).toBe(false);
    expect(flags.get("bad")).toBe("unmailable");
    expect(flags.size).toBe(3);
  });
});

describe("writes go through the audited RPCs", () => {
  it("recordSuppression forces scope all for bounces and complaints", async () => {
    const { db, calls } = fakeDb([], { rpc: () => ({ data: "uuid-1", error: null }) });
    expect(await recordSuppression(db, { email: "user-bdda357b@example.com", cause: "hard_bounce", source: "zoho-bounce", actor: "track-a", scope: "marketing" })).toBe("uuid-1");
    expect(calls.rpc[0]).toEqual(["suppress_mail", { p_email: "user-bdda357b@example.com", p_cause: "hard_bounce", p_source: "zoho-bounce", p_actor: "track-a", p_scope: "all", p_user_id: null, p_note: null }]);
    await recordSuppression(db, { email: "user-bdda357b@example.com", cause: "opt_out", source: "unsubscribe-link", actor: "route:reminders", scope: "marketing" });
    expect(calls.rpc[1][1].p_scope).toBe("marketing");
  });
  it("rejects bad input before calling the database", async () => {
    const { db, calls } = fakeDb([], { rpc: () => ({ data: "uuid-1", error: null }) });
    await expect(recordSuppression(db, { email: "nope", cause: "opt_out", source: "admin", actor: "a" })).rejects.toThrow();
    await expect(recordSuppression(db, { email: "user-65abd062@example.com", cause: "spam" as never, source: "admin", actor: "a" })).rejects.toThrow();
    await expect(recordSuppression(db, { email: "user-65abd062@example.com", cause: "opt_out", source: "Has Space", actor: "a" })).rejects.toThrow();
    await expect(recordSuppression(db, { email: "user-65abd062@example.com", cause: "opt_out", source: "admin", actor: "  " })).rejects.toThrow();
    expect(calls.rpc).toHaveLength(0);
  });
  it("surfaces RPC errors without their text and lifts with actor and reason", async () => {
    const failing = fakeDb([], { rpc: () => ({ data: null, error: { message: "secret detail" } }) });
    await expect(recordSuppression(failing.db, { email: "user-65abd062@example.com", cause: "manual", source: "admin", actor: "admin:1" })).rejects.toThrow(/^Mail suppression write failed$/);
    const ok = fakeDb([], { rpc: () => ({ data: true, error: null }) });
    expect(await liftSuppression(ok.db, "id-1", " admin:1 ", " learner asked again ")).toBe(true);
    expect(ok.calls.rpc[0]).toEqual(["lift_mail_suppression", { p_id: "id-1", p_actor: "admin:1", p_reason: "learner asked again" }]);
    await expect(liftSuppression(ok.db, "id-1", "admin:1", " ")).rejects.toThrow();
  });
});

describe("migration file shape", () => {
  const sql = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261113090000_mail_suppression.sql"), "utf8");
  it("enables RLS on each table, grants only to service_role and has no anon or authenticated grant", () => {
    const tables = sql.match(/CREATE TABLE public\.(\w+)/g) ?? [];
    expect(tables).toHaveLength(2);
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);
    expect(sql).not.toMatch(/GRANT [^;]* TO [^;]*(anon|authenticated|PUBLIC)/);
    expect(sql).toMatch(/REVOKE ALL ON SEQUENCE public\.mail_suppression_audit_id_seq FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT [^;(]*INSERT ON TABLE public\.mail_suppression TO/);
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
  it("uses the same normalization as the TypeScript key", () => {
    expect(sql).toContain("btrim(p_email, pg_catalog.chr(32) || pg_catalog.chr(9) || pg_catalog.chr(10) || pg_catalog.chr(11) || pg_catalog.chr(12) || pg_catalog.chr(13))");
    // E'\\v' is not an escape in Postgres (it would strip the letter v).
    expect(sql).not.toMatch(/E'[^']*\\\\v/);
    expect(sql).toContain("pg_catalog.lower(");
  });
});
