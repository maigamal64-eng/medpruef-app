import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { makeDb, client, type FakeDb } from "./fake-db";

const h = vi.hoisted(() => ({ userId: "u1", paid: false, db: null as unknown }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({ userId: h.userId, role: "user", tier: "free", tierExpiresAt: null }),
  isPaidAccess: () => h.paid,
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient: () => client(h.db as FakeDb) }));
void NextResponse;

import { GET as listCases } from "@/app/api/de-kp/cases/route";
import { GET as getCase } from "@/app/api/de-kp/case/[slug]/route";
import { POST as reveal } from "@/app/api/de-kp/case/[slug]/reveal/route";
import { POST as key } from "@/app/api/de-kp/case/[slug]/key/route";
import { POST as attempt } from "@/app/api/de-kp/attempt/route";

const url = "https://medpruf.test/api/de-kp/x";
const post = (b: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(b), headers: { "content-type": "application/json" } });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const ID = "5b1e2c4a-3f6d-4a8b-9c1d-0e2f3a4b5c6d";
const ID2 = "6c2f3d5b-4a7e-4b9c-8d2e-1f3a4b5c6d7e";

const SECRET = ["MODELLBERICHT_GEHEIM", "RUBRIK_GEHEIM", "ANTWORT_GEHEIM", "BEFUND_GEHEIM", "AKZEPTIERT_GEHEIM", "QUELLE_GEHEIM", "FRAGE_GEHEIM", "WEIGHTPOINT_GEHEIM"];

function caseRow(id: number, slug: string, isFree: boolean) {
  return {
    id, slug, exam_key: "de_kenntnispruefung", subject: "innere", title_de: "Titel " + slug, title_en: "Title " + slug, is_free: isFree, is_active: true,
    vignette_de: "Ein Patient mit Brustschmerz.",
    history_checklist: [{ id: "a1", domain: "aktuelle_beschwerden", point_de: "WEIGHTPOINT_GEHEIM", weight: 2 }, { id: "m1", domain: "medikation", point_de: "WEIGHTPOINT_GEHEIM", weight: 1 }],
    patient_answers_de: { a1: "ANTWORT_GEHEIM drückend", m1: "ANTWORT_GEHEIM ASS" },
    findings: [{ id: "f1", kind: "ekg", text_de: "BEFUND_GEHEIM" }],
    differentials: { leading: [["AKZEPTIERT_GEHEIM"]], others: [["Lungenembolie"], ["Aortendissektion"]] },
    bericht_rubric: [{ id: "r1", section: "anamnese", point_de: "RUBRIK_GEHEIM", weight: 1, critical: false }, { id: "r2", section: "behandlungsplan", point_de: "RUBRIK_GEHEIM", weight: 1, critical: true }],
    model_bericht_de: "MODELLBERICHT_GEHEIM", sources: [{ kind: "awmf", ref: "QUELLE_GEHEIM", url: "https://register.awmf.org/" }],
  };
}
const followups = (caseId: number) => [1, 2].map((p) => ({ id: caseId * 10 + p, case_id: caseId, position: p, scope: p === 1 ? "case" : "cross", stem_de: "FRAGE_GEHEIM " + p, required: 1, accepted: [["AKZEPTIERT_GEHEIM"]], model_answer_de: "ANTWORT_GEHEIM", key_points: [], is_active: true }));

const run = (extra: Record<string, unknown> = {}) => ({
  attemptId: ID, slug: "fall-eins", step: "anamnese",
  answers: { anamnese: ["Schmerzen?"] }, ...extra,
});

beforeEach(() => {
  process.env.DE_KP_ENABLED = "true";
  h.userId = "u1"; h.paid = false;
  h.db = makeDb({ de_kp_cases: [caseRow(1, "fall-eins", true), caseRow(2, "fall-zwei", false)], de_kp_followups: [...followups(1), ...followups(2)], de_kp_case_attempts: [] });
});
afterEach(() => { delete process.env.DE_KP_ENABLED; });
const db = () => h.db as FakeDb;
const noSecret = (body: unknown) => { const s = JSON.stringify(body); for (const w of SECRET) expect(s, w).not.toContain(w); };

describe("free user (acceptance test 2)", () => {
  it("opens the free case: vignette, no key anywhere in the response", async () => {
    const res = await getCase(new NextRequest(url), ctx("fall-eins"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ slug: "fall-eins", is_free: true, vignette_de: "Ein Patient mit Brustschmerz.", domains: ["aktuelle_beschwerden", "medikation"] });
    noSecret(body);
    expect(Object.keys(body).sort()).toEqual(["domains", "is_free", "slug", "subject", "title_de", "title_en", "vignette_de"]);
  });
  it("does not even select a key column for the case route", async () => {
    await getCase(new NextRequest(url), ctx("fall-eins"));
    const sel = db().calls.map((c) => c.select).join(" ");
    for (const col of ["patient_answers_de", "findings", "differentials", "bericht_rubric", "model_bericht_de", "sources"]) expect(sel).not.toContain(col);
  });
  it("gets 403 PRO_REQUIRED on every route for another case", async () => {
    const calls = [
      getCase(new NextRequest(url), ctx("fall-zwei")),
      reveal(post({ stage: "anamnese", lines: ["Schmerzen"] }), ctx("fall-zwei")),
      key(post({ attemptId: ID }), ctx("fall-zwei")),
      attempt(post(run({ slug: "fall-zwei" }))),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "PRO_REQUIRED" });
    }
    expect(db().tables.de_kp_case_attempts).toHaveLength(0);
  });
  it("sees the locked flag in the list and no key either", async () => {
    const body = await (await listCases(new NextRequest(url))).json();
    expect(body.cases.map((c: { slug: string; locked: boolean }) => [c.slug, c.locked])).toEqual([["fall-eins", false], ["fall-zwei", true]]);
    noSecret(body);
  });
  it("gets 409 NOT_SUBMITTED asking for the key before submitting", async () => {
    expect((await attempt(post(run()))).status).toBe(200);
    const res = await key(post({ attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "NOT_SUBMITTED" });
  });
  it("a Pro user opens the locked case", async () => {
    h.paid = true;
    expect((await getCase(new NextRequest(url), ctx("fall-zwei"))).status).toBe(200);
  });
  it("unknown, malformed and inactive slugs are 404", async () => {
    expect((await getCase(new NextRequest(url), ctx("gibt-es-nicht"))).status).toBe(404);
    expect((await getCase(new NextRequest(url), ctx("../x"))).status).toBe(404);
    (db().tables.de_kp_cases[0] as Record<string, unknown>).is_active = false;
    expect((await getCase(new NextRequest(url), ctx("fall-eins"))).status).toBe(404);
  });
});

describe("reveal", () => {
  it("answers only the domains the learner named; never findings or key text", async () => {
    const body = await (await reveal(post({ stage: "anamnese", lines: ["Seit wann haben Sie Schmerzen?"] }), ctx("fall-eins"))).json();
    expect(body.domains).toEqual(["aktuelle_beschwerden"]);
    expect(body.revealed).toEqual([{ id: "a1", domain: "aktuelle_beschwerden", answer: "ANTWORT_GEHEIM drückend" }]);
    expect(JSON.stringify(body)).not.toContain("BEFUND_GEHEIM");
  });
  it("findings and oral stems wait for the submitted steps", async () => {
    await attempt(post(run()));
    let res = await reveal(post({ stage: "findings", attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(409);
    await attempt(post(run({ step: "differentials" })));
    res = await reveal(post({ stage: "findings", attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain("BEFUND_GEHEIM");
    expect((await reveal(post({ stage: "oral", attemptId: ID }), ctx("fall-eins"))).status).toBe(409);
  });
  it("rejects an unknown stage and a missing attempt id", async () => {
    expect((await reveal(post({ stage: "key" }), ctx("fall-eins"))).status).toBe(400);
    expect((await reveal(post({ stage: "findings" }), ctx("fall-eins"))).status).toBe(400);
  });
});

describe("attempt and key, step by step", () => {
  const typed = {
    anamnese: ["Schmerzen?", "Medikamente?"], differentials: { leading: "ACS", others: ["Lungenembolie"] },
    bericht: { anamnese: "a", behandlungsplan: "b" }, oral: { "11": ["x"] },
  };
  it("walks the whole run, releases the key part by part and computes the scores itself", async () => {
    const step = (s: string, marks: unknown = {}) => attempt(post({ attemptId: ID, slug: "fall-eins", step: s, answers: typed, marks }));
    expect((await step("anamnese")).status).toBe(200);
    expect((await step("differentials", { history: { a1: true } })).status).toBe(200);
    let k = await (await key(post({ attemptId: ID }), ctx("fall-eins"))).json();
    expect(k.released).toEqual(["history"]);
    expect(k.differentials).toBeUndefined();
    expect(k.bericht_rubric).toBeUndefined();
    expect((await step("bericht")).status).toBe(200);
    k = await (await key(post({ attemptId: ID }), ctx("fall-eins"))).json();
    expect(k.released).toEqual(["history", "differentials"]);
    expect(JSON.stringify(k)).not.toContain("MODELLBERICHT_GEHEIM");
    expect((await step("oral")).status).toBe(200);
    k = await (await key(post({ attemptId: ID }), ctx("fall-eins"))).json();
    expect(k.model_bericht_de).toBe("MODELLBERICHT_GEHEIM");
    expect(k.followups).toBeUndefined();
    const done = await step("done", { history: { a1: true }, differentials: { leading: true, others: { "0": true } }, bericht: { r1: true }, oral: { "11": true } });
    expect(done.status).toBe(200);
    const saved = (await done.json()).attempt;
    expect(saved.step).toBe("done");
    expect(saved.completed_at).toBeTruthy();
    expect(saved.scores.history).toBeCloseTo(2 / 3);
    expect(saved.scores.differential).toBeCloseTo(0.75);
    expect(saved.scores.bericht).toBeCloseTo(0.5);
    expect(saved.scores.followup).toBe(0.5);
    expect(saved.critical_missed).toBe(1);
    k = await (await key(post({ attemptId: ID }), ctx("fall-eins"))).json();
    expect(k.followups).toHaveLength(2);
    expect(k.sources[0].ref).toBe("QUELLE_GEHEIM");
  });
  it("ignores scores sent by the client", async () => {
    const res = await attempt(post(run({ history_score: 1, scores: { history: 1 } })));
    expect((await res.json()).attempt.scores.history).toBeNull();
    expect(db().tables.de_kp_case_attempts[0]).not.toHaveProperty("scores");
  });
  it("cannot skip a step, start past anamnese or submit an empty step", async () => {
    expect((await attempt(post(run({ step: "bericht" })))).status).toBe(409);
    await attempt(post(run()));
    expect((await attempt(post(run({ step: "bericht" })))).status).toBe(409);
    expect((await attempt(post(run({ step: "differentials", answers: {} })))).status).toBe(400);
    expect(db().tables.de_kp_case_attempts[0].step).toBe("anamnese");
  });
  it("a stale retry returns the saved row and never moves the step back", async () => {
    await attempt(post(run()));
    await attempt(post(run({ step: "differentials" })));
    const res = await attempt(post(run()));
    const body = await res.json();
    expect(body.duplicate).toBe(true);
    expect(body.attempt.step).toBe("differentials");
  });
  it("takes the user id from the session, never the body", async () => {
    await attempt(post(run({ user_id: "attacker", userId: "attacker" })));
    expect(db().tables.de_kp_case_attempts[0].user_id).toBe("u1");
  });
  it("a different user posting or asking for a known attempt id gets 404", async () => {
    await attempt(post(run()));
    await attempt(post(run({ step: "differentials" })));
    h.userId = "u2";
    let res = await attempt(post(run({ step: "differentials" })));
    expect(res.status).toBe(404);
    res = await key(post({ attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(404);
    res = await reveal(post({ stage: "findings", attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(404);
    expect(db().tables.de_kp_case_attempts).toHaveLength(1);
    expect(db().tables.de_kp_case_attempts[0].user_id).toBe("u1");
  });
  it("an attempt of another case cannot unlock this case's key", async () => {
    h.paid = true;
    await attempt(post(run({ slug: "fall-zwei" })));
    await attempt(post(run({ slug: "fall-zwei", step: "differentials" })));
    const res = await key(post({ attemptId: ID }), ctx("fall-eins"));
    expect(res.status).toBe(404);
  });
  it("validates ids and caps typed text", async () => {
    expect((await attempt(post(run({ attemptId: "nope" })))).status).toBe(400);
    expect((await attempt(post(run({ step: "fertig" })))).status).toBe(400);
    expect((await attempt(post(run({ slug: "../x" })))).status).toBe(400);
    await attempt(post(run({ answers: { anamnese: ["x".repeat(500)], evil: "q" } })));
    const stored = db().tables.de_kp_case_attempts[0].answers as { anamnese: string[] };
    expect(stored.anamnese[0]).toHaveLength(300);
    expect(stored).not.toHaveProperty("evil");
  });
  it("two runs of one learner are listed with scores but never the typed text", async () => {
    await attempt(post(run()));
    await attempt(post(run({ attemptId: ID2 })));
    const body = await (await listCases(new NextRequest(url))).json();
    expect(body.attempts).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain("Schmerzen?");
  });
  it("a case withdrawn mid-run answers 404 on key and attempt", async () => {
    await attempt(post(run()));
    await attempt(post(run({ step: "differentials" })));
    (db().tables.de_kp_cases[0] as Record<string, unknown>).is_active = false;
    expect((await key(post({ attemptId: ID }), ctx("fall-eins"))).status).toBe(404);
    expect((await attempt(post(run({ step: "bericht" })))).status).toBe(404);
  });
});
