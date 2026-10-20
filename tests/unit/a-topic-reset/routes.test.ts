import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, requireAdmin: m.admin }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), withScope: vi.fn() }));

import { GET, POST } from "@/app/api/user/topic-progress/reset/route";
import { GET as adminList } from "@/app/api/admin/users/[id]/progress-resets/route";
import { POST as adminRestore } from "@/app/api/admin/users/[id]/progress-resets/[resetId]/restore/route";
import { parseTopicResetBody, topicResetEnabled, TOPIC_RESET_DAILY_LIMIT } from "@/lib/topic-reset";
import { permissionForAdminRequest } from "@/lib/admin/permissions";
import { loadFreeAccess } from "@/lib/free-tier";
import { freeSetIds } from "@/lib/free-set";
import { TOPIC_RESET_COPY } from "@/lib/topic-reset/copy";

const USER = "11111111-1111-4111-8111-111111111111";
const RESET = "22222222-2222-4222-8222-222222222222";
const req = (body: unknown, url = "https://medpruf.com/api/user/topic-progress/reset") =>
  new NextRequest(url, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });

function rpcClient(result: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { rpc, from: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ userId: USER, role: "user", tier: "free" });
});
afterEach(() => vi.unstubAllEnvs());

describe("flag", () => {
  it("only the literal 'true' turns it on", () => {
    expect(topicResetEnabled({})).toBe(false);
    expect(topicResetEnabled({ TOPIC_RESET_ENABLED: "1" })).toBe(false);
    expect(topicResetEnabled({ TOPIC_RESET_ENABLED: "TRUE" })).toBe(false);
    expect(topicResetEnabled({ TOPIC_RESET_ENABLED: "true" })).toBe(true);
  });

  it("GET reports the flag without a session or database read", async () => {
    expect(await (await GET()).json()).toEqual({ enabled: false });
    vi.stubEnv("TOPIC_RESET_ENABLED", "true");
    expect(await (await GET()).json()).toEqual({ enabled: true });
    expect(m.guard).not.toHaveBeenCalled();
    expect(m.client).not.toHaveBeenCalled();
  });

  it("POST with the flag off is a 404 before any session or database read", async () => {
    const res = await POST(req({ exam_type: "kenntnispruefung", topic: "Augenheilkunde" }));
    expect(res.status).toBe(404);
    expect(m.guard).not.toHaveBeenCalled();
    expect(m.client).not.toHaveBeenCalled();
  });
});

let seq = 0;
describe("POST /api/user/topic-progress/reset", () => {
  // A fresh learner per test: the per-instance burst guard keys on the user.
  let me = USER;
  beforeEach(() => {
    vi.stubEnv("TOPIC_RESET_ENABLED", "true");
    seq += 1;
    me = `11111111-1111-4111-8111-${String(seq).padStart(12, "0")}`;
    m.guard.mockResolvedValue({ userId: me, role: "user", tier: "free" });
  });

  it("needs a signed-in learner", async () => {
    m.guard.mockResolvedValue({ error: new Response("no", { status: 401 }) });
    const res = await POST(req({ exam_type: "kenntnispruefung", topic: "Augenheilkunde" }));
    expect(res.status).toBe(401);
    expect(m.client).not.toHaveBeenCalled();
  });

  it("validates the body: known exam, non-empty bounded topic", async () => {
    for (const body of ["not json", {}, { exam_type: "ok", topic: "x" }, { exam_type: "kenntnispruefung", topic: "  " }, { exam_type: "kenntnispruefung", topic: "x".repeat(201) }]) {
      expect((await POST(req(body))).status).toBe(400);
    }
    expect(parseTopicResetBody({ exam_type: "pharma", topic: " Pharmakologie " })).toEqual({ examType: "pharma", topic: "Pharmakologie" });
    expect(m.client).not.toHaveBeenCalled();
  });

  it("runs the one SQL function as the session user, never a body user id", async () => {
    const sb = rpcClient({ data: { status: "reset", reset_id: RESET, counts: { answer_history: 6 } } });
    m.client.mockReturnValue(sb);
    const res = await POST(req({ exam_type: "kenntnispruefung", topic: "Augenheilkunde", user_id: "someone-else" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, code: "reset", counts: { answer_history: 6 } });
    expect(sb.rpc).toHaveBeenCalledWith("topic_progress_reset", {
      p_user: me, p_exam_type: "kenntnispruefung", p_topic: "Augenheilkunde",
      p_daily_limit: TOPIC_RESET_DAILY_LIMIT, p_max_rows: 20000,
    });
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("maps every SQL status to its HTTP answer", async () => {
    const cases: Array<[string, number]> = [["empty", 200], ["unknown_topic", 404], ["rate_limited", 429], ["too_large", 409], ["invalid", 400]];
    for (const [status, http] of cases) {
      m.guard.mockResolvedValue({ userId: `55555555-5555-4555-8555-${status.padEnd(12, "0").slice(0, 12).replace(/[^0-9a-f]/g, "0")}` });
      m.client.mockReturnValue(rpcClient({ data: { status } }));
      const res = await POST(req({ exam_type: "pharma", topic: `T-${status}` }));
      expect(res.status, status).toBe(http);
      expect((await res.json()).code).toBe(status);
    }
  });

  it("before the changeset: 503, never a 500", async () => {
    m.client.mockReturnValue(rpcClient({ error: { code: "PGRST202", message: "not found" } }));
    const res = await POST(req({ exam_type: "pharma", topic: "Pharmakologie" }));
    expect(res.status).toBe(503);
  });

  it("an unknown status from SQL is a 500, not a success", async () => {
    m.client.mockReturnValue(rpcClient({ data: { status: "weird" } }));
    expect((await POST(req({ exam_type: "pharma", topic: "Pharmakologie" }))).status).toBe(500);
  });

  it("burst guard: at most 5 presses a minute per learner on one instance", async () => {
    m.guard.mockResolvedValue({ userId: "33333333-3333-4333-8333-333333333333" });
    m.client.mockReturnValue(rpcClient({ data: { status: "empty" } }));
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await POST(req({ exam_type: "pharma", topic: "Pharmakologie" }))).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("admin routes", () => {
  beforeEach(() => {
    m.admin.mockResolvedValue({ userId: "44444444-4444-4444-8444-444444444444", role: "admin", tier: "admin" });
  });

  it("permission map: list needs users.read, restore users.write, nothing else", () => {
    expect(permissionForAdminRequest(`/api/admin/users/${USER}/progress-resets`, "GET")).toBe("users.read");
    expect(permissionForAdminRequest(`/api/admin/users/${USER}/progress-resets`, "POST")).toBeNull();
    expect(permissionForAdminRequest(`/api/admin/users/${USER}/progress-resets/${RESET}/restore`, "POST")).toBe("users.write");
    expect(permissionForAdminRequest(`/api/admin/users/${USER}/progress-resets/${RESET}/restore`, "GET")).toBeNull();
    expect(permissionForAdminRequest(`/api/admin/users/x/progress-resets/${RESET}/restore`, "POST")).toBeNull();
  });

  it("restore passes the reset, the learner and the actor to the SQL function", async () => {
    const sb = rpcClient({ data: { status: "restored", counts: { answer_history: 6 } } });
    const users = createFakeSupabase((c: FakeCall) => (c.table === "users" ? { data: { email: "admin@medpruf.com" } } : {})).sb;
    m.client.mockReturnValue({ ...users, rpc: sb.rpc });
    const res = await adminRestore(req({ reason: "learner asked" }, `https://medpruf.com/api/admin/users/${USER}/progress-resets/${RESET}/restore`));
    expect(res.status).toBe(200);
    expect(sb.rpc).toHaveBeenCalledWith("topic_progress_restore", expect.objectContaining({
      p_reset: RESET, p_user: USER, p_actor: "44444444-4444-4444-8444-444444444444", p_reason: "learner asked",
    }));
  });

  it("restore refuses bad ids and reports already_restored as 409", async () => {
    const sb = rpcClient({ data: { status: "already_restored" } });
    const users = createFakeSupabase((c: FakeCall) => (c.table === "users" ? { data: { email: "admin@medpruf.com" } } : {})).sb;
    m.client.mockReturnValue({ ...users, rpc: sb.rpc });
    expect((await adminRestore(req({}, `https://medpruf.com/api/admin/users/nope/progress-resets/${RESET}/restore`))).status).toBe(400);
    expect((await adminRestore(req({}, `https://medpruf.com/api/admin/users/${USER}/progress-resets/${RESET}/restore`))).status).toBe(409);
  });

  it("list never selects the archived rows", async () => {
    const { sb, calls } = createFakeSupabase((c: FakeCall) => (c.table === "users" ? { data: { email: "admin@medpruf.com" } } : c.table === "progress_resets" ? { data: [] } : {}));
    m.client.mockReturnValue(sb);
    const res = await adminList(new NextRequest(`https://medpruf.com/api/admin/users/${USER}/progress-resets`));
    expect(res.status).toBe(200);
    const read = calls.find((c) => c.table === "progress_resets")!;
    expect(read.columns).not.toMatch(/archived|question_ids/);
  });
});

describe("free sample after a reset", () => {
  const EXAM = "kenntnispruefung";
  const NEW = [...freeSetIds(EXAM)];
  beforeEach(() => { process.env.FREE_TIER_ENFORCED = "true"; vi.stubEnv("TOPIC_RESET_ENABLED", "true"); });

  it("flag off: reset answers still count (switching the flag off gives no second free taste)", async () => {
    vi.stubEnv("TOPIC_RESET_ENABLED", "");
    const access = await loadFreeAccess(world([], NEW.slice(0, 150)), "u0", EXAM, { strict: true });
    expect(access.capped).toBe(true);
  });

  function world(history: number[], archived: number[], archiveError?: { code: string }) {
    return createFakeSupabase((c: FakeCall) => {
      if (c.table === "answer_history") {
        const inIds = c.filters.find((f) => f.kind === "in")?.value as number[] | undefined;
        const after = Number(c.filters.find((f) => f.kind === "gt")?.value ?? 0);
        return { data: (inIds ? history.filter((q) => inIds.includes(q)) : history).filter((q) => q > after).sort((a, b) => a - b).map((q) => ({ question_id: q })) };
      }
      if (c.table === "progress_resets") return archiveError ? { error: archiveError } : { data: archived.length ? [{ question_ids: archived }] : [] };
      return {};
    }).sb as unknown as SupabaseClient;
  }

  it("archived answers still count toward the cap and stay readable (no second free taste)", async () => {
    const access = await loadFreeAccess(world([], NEW.slice(0, 150)), "u1", EXAM, { strict: true });
    expect(access.capped).toBe(true);
    expect(access.answered.has(NEW[0])).toBe(true);
  });

  it("a re-answered archived question is counted once", async () => {
    const access = await loadFreeAccess(world(NEW.slice(0, 100), NEW.slice(50, 149)), "u2", EXAM, { strict: true });
    expect(access.capped).toBe(false);
  });

  it("before the changeset the archive reads as empty", async () => {
    const access = await loadFreeAccess(world(NEW.slice(0, 10), [], { code: "PGRST205" }), "u3", EXAM, { strict: true });
    expect(access.capped).toBe(false);
  });

  it("strict: a failed archive read throws (no paywall decision on an unproven read)", async () => {
    await expect(loadFreeAccess(world([], [], { code: "XX000" }), "u4", EXAM, { strict: true })).rejects.toBeTruthy();
    const loose = await loadFreeAccess(world([], [], { code: "XX000" }), "u4", EXAM);
    expect(loose.capped).toBe(false);
  });
});

describe("copy", () => {
  it("German uses Sie, no dashes, the confirm states what stays and that progress is saved", () => {
    for (const lang of ["de", "en"] as const) {
      const c = TOPIC_RESET_COPY[lang];
      const all = [c.entry, c.title, c.subjectLabel, c.subjectPlaceholder, c.body, c.kept, c.saved, c.freeNote, c.confirm, c.cancel, c.busy, c.done("X"), c.empty, c.rateLimited, c.failed, c.unconfirmed, c.noneYet].join(" ");
      expect(all).not.toMatch(/[–—]/);
      expect(all).not.toMatch(/ - /);
    }
    const de = Object.values(TOPIC_RESET_COPY.de).filter((v) => typeof v === "string").join(" ");
    expect(de).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    expect(TOPIC_RESET_COPY.de.kept).toMatch(/XP.*Serie.*Lernplan/);
    expect(TOPIC_RESET_COPY.en.kept).toMatch(/XP.*streak.*study plan/);
    expect(TOPIC_RESET_COPY.de.saved).toMatch(/gesichert/);
    expect(TOPIC_RESET_COPY.de.rateLimited).toContain(String(TOPIC_RESET_DAILY_LIMIT));
  });
});
