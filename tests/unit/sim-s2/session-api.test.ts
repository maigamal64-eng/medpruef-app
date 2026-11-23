import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: vi.fn() }));

import { handleGet, handlePost, type SimApiDeps } from "@/lib/sim-server/session-api";
import { staffOnlyGate, type SimAccessGate } from "@/lib/sim-server/gate";
import { serializeSession } from "@/lib/sim";
import { makeDb, client, type FakeDb } from "../de-kp/fake-db";

const SID = "3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e5f";
const CASE = JSON.parse(readFileSync(path.resolve(__dirname, "../../../content/de-kp/cases/nf-anaphylaxie-wespenstich.json"), "utf8")) as Record<string, unknown> & { followups: unknown[] };
const url = "https://medpruf.test/api/sim/session";
const guardOf = (userId: string, role: "user" | "admin" = "admin") => ({ userId, role, tier: role === "admin" ? "admin" : "free", tierExpiresAt: null });

const h = { db: null as unknown as FakeDb, now: 1_800_000_000_000, user: guardOf("u1") as ReturnType<typeof guardOf> | null, ids: [SID] };
const deps = (over: Partial<SimApiDeps> = {}): SimApiDeps => ({
  db: () => client(h.db) as never,
  gate: staffOnlyGate,
  now: () => h.now,
  newId: () => h.ids.shift() ?? "00000000-0000-4000-8000-00000000dead",
  requireUser: async () => (h.user ? (h.user as never) : { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }),
  ...over,
});
const post = (b: unknown, d = deps()) => handlePost(new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } }), d);
const get = (q = "", d = deps()) => handleGet(new NextRequest(url + q), d);
const create = (extra: Record<string, unknown> = {}) => post({ action: "create", profileKey: "de_kenntnispruefung", caseId: CASE.slug, mode: "full_exam", ...extra });
const event = (version: number, ev: Record<string, unknown>, sessionId = SID) => post({ action: "event", sessionId, expectedVersion: version, event: ev });
const rows = () => (h.db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables?.sim_sessions;

beforeEach(() => {
  process.env.SIM_ENABLED = "true";
  process.env.DE_KP_ENABLED = "true";
  h.now = 1_800_000_000_000;
  h.user = guardOf("u1");
  h.ids = [SID];
  h.db = makeDb({
    de_kp_cases: [{ id: 1, exam_key: "de_kenntnispruefung", is_active: true, ...CASE }],
    de_kp_followups: (CASE.followups as Record<string, unknown>[]).map((f, i) => ({ id: i + 1, case_id: 1, is_active: true, ...f })),
    sim_sessions: [],
  });
});
afterEach(() => {
  delete process.env.SIM_ENABLED;
  delete process.env.DE_KP_ENABLED;
});

describe("guards", () => {
  it("unauthenticated is 401", async () => {
    h.user = null;
    expect((await get()).status).toBe(401);
    expect((await create()).status).toBe(401);
  });
  it("flag off answers 404 before the session guard: no users read, same answer when signed out", async () => {
    delete process.env.SIM_ENABLED;
    const calls = vi.fn(async () => ({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }));
    const d = deps({ requireUser: calls as never });
    expect((await get("", d)).status).toBe(404);
    expect((await post({ action: "create" }, d)).status).toBe(404);
    expect(calls).not.toHaveBeenCalled();
  });
  it("flag off is 404, also for staff", async () => {
    delete process.env.SIM_ENABLED;
    const res = await create();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("SIM_DISABLED");
    expect((await get()).status).toBe(404);
  });
  it("a non-staff learner is refused by the default gate (nothing reaches learners)", async () => {
    h.user = guardOf("u9", "user");
    const res = await create();
    expect(res.status).toBe(403);
    expect(rows()).toHaveLength(0);
  });
  it("the gate is replaceable (S10)", async () => {
    h.user = guardOf("u9", "user");
    const gate: SimAccessGate = () => ({ allowed: true, aiMarking: false });
    expect((await post({ action: "create", profileKey: "de_kenntnispruefung", caseId: CASE.slug, mode: "full_exam" }, deps({ gate }))).status).toBe(201);
  });
  it("an exam whose own flag is off reads as not found", async () => {
    delete process.env.DE_KP_ENABLED;
    expect((await create()).status).toBe(404);
  });
});

describe("create", () => {
  it("stores a session for the signed user with a server-built state and server time", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.session.id).toBe(SID);
    expect(body.session.state_version).toBe(1);
    expect(body.session.state.createdAt).toBe(h.now);
    expect(rows()[0]).toMatchObject({ id: SID, user_id: "u1", profile_key: "de_kenntnispruefung", case_id: CASE.slug, ai_marking: false, state_version: 1 });
  });
  it("takes the user from the session, never the body", async () => {
    await create({ userId: "victim", user_id: "victim" });
    expect(rows()[0].user_id).toBe("u1");
  });
  it("never trusts profile or case content from the body: unknown profile or case is 404, body state is ignored", async () => {
    expect((await create({ profileKey: "evil" })).status).toBe(404);
    expect((await create({ caseId: "no-such-case" })).status).toBe(404);
    await create({ state: { v: 1, status: "finished" }, items: [] , aiMarking: true });
    expect(rows()[0].status).toBe("ready");
    expect(rows()[0].ai_marking).toBe(false);
  });
  it("is retry safe on a client session id; another user's id reads as not found", async () => {
    const a = await create({ sessionId: SID });
    expect(a.status).toBe(201);
    const b = await create({ sessionId: SID });
    expect(b.status).toBe(200);
    expect((await b.json()).duplicate).toBe(true);
    expect(rows()).toHaveLength(1);
    h.user = guardOf("u2");
    expect((await create({ sessionId: SID })).status).toBe(404);
  });
  it("refuses bad input", async () => {
    expect((await create({ mode: "solo" })).status).toBe(400);
    expect((await create({ sessionId: "nope" })).status).toBe(400);
    expect((await create({ mode: "full_exam", partIds: ["talk"] })).status).toBe(400);
    expect((await post({ action: "nope" })).status).toBe(400);
  });
  it("caps unfinished sessions", async () => {
    for (let i = 0; i < 10; i++) {
      h.ids = [`3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e${(16 + i).toString(16).padStart(2, "0")}`];
      expect((await create()).status).toBe(201);
    }
    h.ids = [SID];
    expect((await create()).status).toBe(429);
  });
});

describe("resume (GET)", () => {
  it("returns null when nothing is open and the latest open one otherwise", async () => {
    expect(await (await get()).json()).toEqual({ session: null });
    await create();
    const body = await (await get()).json();
    expect(body.session.id).toBe(SID);
    expect(body.session.state.parts.length).toBeGreaterThan(0);
  });
  it("a foreign session id is 404 and a malformed id is 400", async () => {
    await create();
    h.user = guardOf("u2");
    expect((await get(`?id=${SID}`)).status).toBe(404);
    expect(await (await get()).json()).toEqual({ session: null });
    expect((await get("?id=nope")).status).toBe(400);
  });
  it("a forged stored state is refused or healed (critical flag dropped, AI switched on, wrong case, status mismatch)", async () => {
    await create();
    const row = rows()[0];
    const good = row.state as Record<string, unknown> & { parts: { items: { critical: boolean }[] }[] };
    const forged = JSON.parse(JSON.stringify(good));
    for (const p of forged.parts) for (const i of p.items) i.critical = false;
    row.state = forged;
    // Items are rebuilt from the server's case on restore: the forged flags never reach the learner or a score.
    const healed = await get();
    expect(healed.status).toBe(200);
    const flags = ((await healed.json()).session.state.parts as { items: { critical: boolean }[] }[]).flatMap((p) => p.items.map((i) => i.critical));
    expect(flags).toContain(true);
    const ai = JSON.parse(JSON.stringify(good));
    ai.aiMarking = true;
    row.state = ai;
    const noAi = await get(); // the server decision (ai_marking column) is false: AI marking is switched back off, never on
    expect(noAi.status).toBe(200);
    expect((await noAi.json()).session.state.aiMarking).toBe(false);
    const other = JSON.parse(JSON.stringify(good));
    other.caseId = "another-case";
    row.state = other;
    expect((await get(`?id=${SID}`)).status).toBe(409);
    const mismatch = JSON.parse(JSON.stringify(good));
    mismatch.status = "finished";
    row.state = mismatch;
    expect((await get(`?id=${SID}`)).status).toBe(409); // row status column disagrees
  });
});

describe("events", () => {
  it("applies an event with SERVER time, ignores the client's `at`, bumps the version", async () => {
    await create();
    h.now += 5_000;
    const res = await event(1, { type: "start", at: 1 });
    expect(res.status).toBe(200);
    const s = (await res.json()).session;
    expect(s.state_version).toBe(2);
    expect(s.state.status).toBe("running");
    expect(s.state.startedAt).toBe(h.now);
    expect(rows()[0]).toMatchObject({ status: "running", state_version: 2 });
    expect(rows()[0].updated_at).toBe(new Date(h.now).toISOString());
  });
  it("time never moves backwards even if this instance's clock is behind the stored change", async () => {
    await create();
    h.now += 10_000;
    await event(1, { type: "start" });
    const stored = h.now;
    h.now -= 8_000;
    const res = await event(2, { type: "resume" });
    expect(res.status).toBe(200);
    expect((await res.json()).session.state.updatedAt).toBe(stored);
  });
  it("a stale version is 409 with the current session, and nothing is written", async () => {
    await create();
    await event(1, { type: "start" });
    const res = await event(1, { type: "resume" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("VERSION_CONFLICT");
    expect(body.session.state_version).toBe(2);
    expect(rows()[0].state_version).toBe(2);
  });
  it("a lost compare-and-set race (another tab saves between our read and our write) is 409 and keeps the other tab's state", async () => {
    await create();
    h.db.beforeUpdate = (t) => {
      if (t === "sim_sessions") {
        rows()[0].state_version = 2;
        rows()[0].status = "running";
      }
    };
    const res = await event(1, { type: "start" });
    h.db.beforeUpdate = undefined;
    expect(res.status).toBe(409);
    expect(rows()[0].state_version).toBe(2);
    expect(rows()[0].status).toBe("running");
  });
  it("another user's session is 404, own session of a closed state is a refused event", async () => {
    await create();
    h.user = guardOf("u2");
    expect((await event(1, { type: "start" })).status).toBe(404);
    h.user = guardOf("u1");
    await event(1, { type: "abandon" });
    const res = await event(2, { type: "start" });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("closed");
  });
  it("the reducer's refusals are 422 and write nothing", async () => {
    await create();
    const res = await event(1, { type: "save_text", partId: "talk", slot: "talk", text: "x" });
    expect(res.status).toBe(422);
    expect(rows()[0].state_version).toBe(1);
  });
  it("browser events cannot carry AI verdicts or an AI fallback", async () => {
    await create();
    expect((await event(1, { type: "set_verdicts", partId: "talk", verdicts: [] })).status).toBe(400);
    expect((await event(1, { type: "ai_fallback", reason: "error" })).status).toBe(400);
    expect((await event(1, { type: "bogus" })).status).toBe(400);
  });
  it("the finished status stamps finished_at and the response carries the result", async () => {
    await create({ mode: "practice_part", partIds: ["report"] });
    await event(1, { type: "start" });
    const res = await event(2, { type: "abandon" });
    expect(rows()[0]).toMatchObject({ status: "abandoned", abandoned_at: new Date(h.now).toISOString(), finished_at: null });
    expect((await res.json()).session.status).toBe("abandoned");
  });
  it("rejects malformed bodies and oversized bodies", async () => {
    expect((await post({ action: "event", sessionId: "x", expectedVersion: 1, event: { type: "start" } })).status).toBe(400);
    expect((await post({ action: "event", sessionId: SID, expectedVersion: 0, event: { type: "start" } })).status).toBe(400);
    expect((await post({ action: "event", sessionId: SID, expectedVersion: 1, event: "start" })).status).toBe(400);
    expect((await post({ action: "event", sessionId: SID, expectedVersion: 1, event: { type: "save_text", text: "a".repeat(70_000) } })).status).toBe(400);
  });
});

describe("review fixes (S2)", () => {
  const stored = () => JSON.stringify(rows()[0].state);
  it("malformed event fields are 400 BAD_EVENT, never saved, and the stored state stays loadable", async () => {
    await create({ mode: "practice_part", partIds: ["report"] });
    await event(1, { type: "start" });
    const before = stored();
    const bad: Record<string, unknown>[] = [
      { type: "save_text", partId: "report", slot: "anamnese", text: { bad: true } },
      { type: "save_text", partId: "report", slot: "anamnese", text: ["x"] },
      { type: "save_text", partId: "report", slot: "anamnese", text: 42 },
      { type: "save_text", partId: "report", slot: "Bad Slot!", text: "x" },
      { type: "save_text", partId: "REPORT", slot: "anamnese", text: "x" },
      { type: "save_text", partId: "report", slot: "anamnese", text: "x".repeat(60_000) },
      { type: "save_text", partId: "report", slot: "anamnese", text: "x", extra: 1 },
      { type: "talk_turn", partId: "talk", text: null },
      { type: "examiner_ask", partId: "report", itemId: 5, bounded: false },
      { type: "examiner_ask", partId: "report", itemId: "a", bounded: "yes" },
      { type: "self_mark", partId: "report", itemId: "a", mark: "foo" },
      { type: "self_mark", partId: "report", itemId: ["a"], mark: "covered" },
      { type: "submit_part", partId: 7 },
      { type: "start", junk: true },
    ];
    for (const ev of bad) {
      const res = await event(2, ev);
      expect(res.status, JSON.stringify(ev)).toBe(400);
      expect((await res.json()).code).toBe("BAD_EVENT");
    }
    expect(stored()).toBe(before);
    expect(rows()[0].state_version).toBe(2);
    const again = await get();
    expect(again.status).toBe(200);
    expect((await again.json()).session.id).toBe(SID);
  });
  it("the reducer itself refuses non-string fields (S1 guard)", async () => {
    const { reduce } = await import("@/lib/sim");
    await create({ mode: "practice_part", partIds: ["report"] });
    const { findRegistration } = await import("@/lib/sim-server/registry");
    const reg = findRegistration("de_kenntnispruefung")!;
    const { parseSession } = await import("@/lib/sim");
    const loaded = await reg.loadCase(client(h.db) as never, CASE.slug as string);
    if (!loaded.ok || !loaded.caseInput) throw new Error("case");
    const st = parseSession(rows()[0].state, reg.profile, { caseInput: loaded.caseInput, aiAllowed: false })!;
    const run = reduce(reg.profile, { ...st, status: "running" }, { type: "talk_turn", at: h.now, partId: "talk", text: 42 } as never);
    expect(run).toMatchObject({ ok: false, error: "bad_event" });
  });
  it("a session whose case was deactivated does not block resume, create or the cap", async () => {
    await create();
    const cases = (h.db as unknown as { tables: Record<string, Record<string, unknown>[]> }).tables.de_kp_cases;
    cases[0].is_active = false;
    expect(await (await get()).json()).toEqual({ session: null });
    expect(rows()[0].status).toBe("abandoned");
    cases[0].is_active = true;
    h.ids = [SID.replace("5f", "60")];
    expect((await create()).status).toBe(201);
  });
  it("GET returns the newest restorable session when a newer one is broken", async () => {
    await create();
    const second = "3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e60";
    h.now += 1000;
    h.ids = [second];
    await create();
    rows()[1].state = { v: 1, junk: true };
    rows()[1].created_at = new Date(h.now + 9999).toISOString();
    const body = await (await get()).json();
    expect(body.session.id).toBe(SID);
    expect(rows().find((r) => r.id === second)!.status).toBe("abandoned");
  });
  it("an unrestorable open session can be abandoned by id without a restore", async () => {
    await create();
    rows()[0].state = { v: 1, junk: true };
    const res = await event(1, { type: "abandon" });
    expect(res.status).toBe(200);
    expect((await res.json()).session.status).toBe("abandoned");
    expect(rows()[0]).toMatchObject({ status: "abandoned", state_version: 2 });
    expect((await event(2, { type: "abandon" })).status).toBe(409);
  });
  it("unrestorable rows do not count toward the open-session cap", async () => {
    for (let i = 0; i < 10; i++) {
      h.ids = [`3f2a8c1e-9b7d-4c2a-8e1f-0a1b2c3d4e${(16 + i).toString(16).padStart(2, "0")}`];
      expect((await create()).status).toBe(201);
    }
    rows()[0].state = { v: 1, junk: true };
    h.ids = [SID];
    expect((await create()).status).toBe(201);
    expect(rows().filter((r) => r.status === "abandoned")).toHaveLength(1);
  });
  it("a db failure reaches Sentry with a code and a fixed message only, no learner text", async () => {
    const Sentry = await import("@sentry/nextjs");
    const captured = vi.mocked(Sentry.captureException);
    captured.mockClear();
    const secret = "[secret]";
    const failing = {
      from: () => {
        const chain: Record<string, unknown> = {};
        for (const k of ["select", "insert", "update", "eq", "in", "order", "range"]) chain[k] = () => chain;
        chain.maybeSingle = async () => ({ data: null, error: { code: "23514", message: "check", details: `Failing row contains (${secret})`, hint: secret } });
        chain.then = (ok: (v: unknown) => void) => ok({ data: null, error: { code: "23514", message: "check", details: `Failing row contains (${secret})`, hint: secret } });
        return chain;
      },
    };
    const res = await get("", deps({ db: () => failing as never }));
    expect(res.status).toBe(500);
    expect(captured).toHaveBeenCalled();
    const dump = JSON.stringify(captured.mock.calls.map(([e, c]) => [(e as Error).message, (e as Error).stack?.split("\n")[0], c]));
    expect(dump).not.toContain(secret);
    expect(dump).toContain("23514");
  });
  it("a repeated create id with another case, profile or mode is 409 SESSION_ID_IN_USE", async () => {
    expect((await create({ sessionId: SID })).status).toBe(201);
    const res = await create({ sessionId: SID, mode: "practice_part", partIds: ["report"] });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SESSION_ID_IN_USE");
    expect((await create({ sessionId: SID })).status).toBe(200);
  });
});

describe("serialisation boundary", () => {
  it("stores exactly serializeSession output as an object", async () => {
    await create();
    const s = (await (await get()).json()).session.state;
    expect(JSON.parse(serializeSession(s))).toEqual(rows()[0].state);
  });
});
