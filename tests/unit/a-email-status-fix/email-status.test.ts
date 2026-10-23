/**
 * a-email-status-fix-1022: every path that proves an address writes
 * email_verified_at and email_status 'valid' together; every address change
 * writes both back. Nothing else marks an address verified.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ client: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@/lib/intercom/sync", () => ({ scheduleIntercomContactSync: m.sync }));

import { POST as verifyLink } from "@/app/api/user/link-email/verify/route";
import { needsStatusHeal, provenEmailFields, unprovenEmailFields } from "@/lib/email-status";

const UID = "11111111-2222-4333-8444-555555555555";
const TOKEN = "t".repeat(48);
const NOW = new Date("2026-10-22T10:00:00Z");

function linkWorld(over: { updated?: unknown; collision?: unknown; used?: boolean } = {}) {
  return createFakeSupabase((c: FakeCall) => {
    if (c.table === "email_link_tokens" && c.op === "select") {
      return { data: { id: 7, user_id: UID, pending_email: "learner@example.at", password_hash: "h", expires_at: "2099-01-01T00:00:00Z", used_at: over.used ? "2026-10-22T09:00:00Z" : null } };
    }
    if (c.table === "users" && c.op === "select") return { data: over.collision ?? null };
    if (c.table === "users" && c.op === "update") return { data: "updated" in over ? over.updated : { id: UID } };
    return {};
  });
}
const post = () => verifyLink(new NextRequest("https://medpruf.com/api/user/link-email/verify", { method: "POST", body: JSON.stringify({ token: TOKEN, lang: "de" }) }));

beforeEach(() => { vi.clearAllMocks(); });

describe("helpers", () => {
  it("proven and unproven fields always travel together", () => {
    expect(provenEmailFields(NOW)).toEqual({ email_verified_at: NOW.toISOString(), email_status: "valid" });
    expect(unprovenEmailFields()).toEqual({ email_verified_at: null, email_status: "unverified" });
  });
  it("heal only a confirmed row whose status is unverified or empty, never bounced or an unconfirmed row", () => {
    expect(needsStatusHeal({ email_verified_at: "2026-10-21T08:00:00Z", email_status: "unverified" })).toBe(true);
    expect(needsStatusHeal({ email_verified_at: "2026-10-21T08:00:00Z", email_status: null })).toBe(true);
    expect(needsStatusHeal({ email_verified_at: "2026-10-21T08:00:00Z", email_status: "valid" })).toBe(false);
    expect(needsStatusHeal({ email_verified_at: "2026-10-21T08:00:00Z", email_status: "bounced" })).toBe(false);
    expect(needsStatusHeal({ email_verified_at: null, email_status: "unverified" })).toBe(false);
  });
});

describe("link-email verify", () => {
  it("the single-use link writes email_verified_at and email_status 'valid' in the compare-and-set and queues the contact sync", async () => {
    const f = linkWorld();
    m.client.mockReturnValue(f.sb);
    const res = await post();
    expect(res.status).toBe(200);
    const update = f.calls.find((c) => c.table === "users" && c.op === "update")!;
    expect(update.payload).toMatchObject({ email: "learner@example.at", password_hash: "h", email_status: "valid" });
    expect(typeof (update.payload as { email_verified_at: unknown }).email_verified_at).toBe("string");
    expect(update.filters).toEqual(expect.arrayContaining([{ kind: "eq", column: "id", value: UID }, { kind: "is", column: "email", value: null }]));
    expect(m.sync).toHaveBeenCalledWith(UID, "email_change");
  });
  it("an account that already has an address is not touched by the link and no sync is queued", async () => {
    const f = linkWorld({ updated: null });
    m.client.mockReturnValue(f.sb);
    expect(await (await post()).json()).toEqual({ ok: true, already_linked: true });
    expect(m.sync).not.toHaveBeenCalled();
  });
  it("a used token or an address claimed by another account never writes users", async () => {
    for (const w of [linkWorld({ used: true }), linkWorld({ collision: { id: "other" } })]) {
      m.client.mockReturnValue(w.sb);
      const res = await post();
      expect(res.status).toBe(409);
      expect(w.calls.some((c) => c.table === "users" && c.op === "update")).toBe(false);
    }
  });
});

describe("no other writer marks an address verified", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("email_status 'valid' and a non-null email_verified_at are written only through provenEmailFields", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      if (file.endsWith(join("lib", "email-status.ts"))) continue;
      const text = readFileSync(file, "utf8");
      if (/email_status\s*:\s*["']valid["'](?!\s*\|)/.test(text)) offenders.push(`${file}: email_status valid`);
      if (/email_verified_at\s*:\s*(new Date|now\b|[A-Za-z_.]+\.toISOString\(\))/.test(text)) offenders.push(`${file}: email_verified_at write`);
    }
    expect(offenders).toEqual([]);
  });
});
