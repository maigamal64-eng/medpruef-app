import { describe, expect, it } from "vitest";
import { nextScreen, nextServerStep, parseSession, screenStep, DE_KP_SCREENS, type DeKpSession } from "@/lib/de-kp/case-run";
import { syncRun, type Poster } from "@/lib/de-kp/sync";
import { isAllowedEvent, sanitizeEventData, FUNNEL_EVENTS } from "@/lib/analytics-events";

const ID = "5b1e2c4a-3f6d-4a8b-9c1d-0e2f3a4b5c6d";
const base = (over: Partial<DeKpSession> = {}): DeKpSession => ({
  v: 1, attemptId: ID, slug: "fall-eins", startedAt: 1, step: "anamnese", source: "de_kp_landing",
  answers: { anamnese: ["Schmerzen"], differentials: { leading: "ACS", others: [] }, bericht: { anamnese: "x", diagnose: "", prognose: "", behandlungsplan: "", epikrise: "" }, oral: {} },
  marks: { history: {}, differentials: { others: {} }, bericht: {}, oral: {} }, berichtClockStartedAt: null, savedAt: 1,
  screen: "anamnese_input", serverStep: null, finalAcked: false, ...over,
});
const ok = (log: string[]): Poster => async (b) => { log.push(b.step); return { status: 200, step: b.step }; };

describe("screens and server steps", () => {
  it("each marking screen needs the step after its input step, and the order never goes back", () => {
    expect(DE_KP_SCREENS.map(screenStep)).toEqual(["anamnese", "differentials", "differentials", "bericht", "bericht", "oral", "oral", "done", "done"]);
    expect(nextScreen("result")).toBe("result");
  });
  it("a new run starts at the first step, then moves one step at a time", () => {
    expect(nextServerStep(null, "bericht_input")).toBe("anamnese");
    expect(nextServerStep("anamnese", "bericht_input")).toBe("differentials");
    expect(nextServerStep("differentials", "bericht_input")).toBe("bericht");
    expect(nextServerStep("bericht", "bericht_input")).toBeNull();
  });
});

describe("outbox replay (syncRun)", () => {
  it("replays every missing step in order from a fresh attempt", async () => {
    const log: string[] = [];
    const r = await syncRun(base({ screen: "bericht_mark" }), ok(log));
    expect(log).toEqual(["anamnese", "differentials", "bericht", "oral"]);
    expect(r.state).toBe("synced");
    expect(r.session.serverStep).toBe("oral");
  });
  it("posts done once more with the final marks at the result, and acknowledges it", async () => {
    const log: string[] = [];
    const r = await syncRun(base({ screen: "result", serverStep: "done" }), ok(log));
    expect(log).toEqual(["done"]);
    expect(r.session.finalAcked).toBe(true);
    const again = await syncRun(r.session, ok(log));
    expect(again.posts).toEqual([]);
  });
  it("a result reached while the server is behind posts the steps and then done once", async () => {
    const log: string[] = [];
    await syncRun(base({ screen: "result", serverStep: "bericht" }), ok(log));
    expect(log).toEqual(["oral", "done"]);
  });
  it("a network failure or 5xx stops and keeps the run for the next try; a 4xx is rejected", async () => {
    const down = await syncRun(base(), async () => ({ status: 0 }));
    expect(down.state).toBe("offline");
    expect(down.session.serverStep).toBeNull();
    expect((await syncRun(base(), async () => ({ status: 503 }))).state).toBe("offline");
    expect((await syncRun(base(), async () => ({ status: 429 }))).state).toBe("offline");
    expect((await syncRun(base(), async () => ({ status: 403 }))).state).toBe("rejected");
  });
  it("keeps what was acknowledged when a later post fails", async () => {
    let n = 0;
    const r = await syncRun(base({ screen: "bericht_mark" }), async (b) => (++n <= 2 ? { status: 200, step: b.step } : { status: 0 }));
    expect(r.session.serverStep).toBe("differentials");
    expect(r.state).toBe("offline");
  });
});

describe("local session", () => {
  it("round-trips the screen and the server step and discards a foreign shape", () => {
    const s = parseSession(JSON.stringify(base({ screen: "diff_mark", serverStep: "bericht" })));
    expect(s?.screen).toBe("diff_mark");
    expect(s?.serverStep).toBe("bericht");
    expect(parseSession(JSON.stringify({ ...base(), screen: "nope", serverStep: "nope" }))?.screen).toBe("anamnese_input");
    expect(parseSession("{}")).toBeNull();
  });
});

describe("events (spec 7)", () => {
  it("are allowed, keep only their keys and never carry typed text", () => {
    for (const n of ["de_kp_landing_view", "de_kp_case_start", "de_kp_case_step_done", "de_kp_case_complete"]) expect(isAllowedEvent(n)).toBe(true);
    expect(sanitizeEventData("de_kp_case_step_done", { case: "fall-eins", step: "bericht", answer: "Freitext", text: "x" })).toEqual({ case: "fall-eins", step: "bericht" });
    expect(sanitizeEventData("de_kp_case_complete", { case: "fall-eins", free: true, critical_missed: "2+", email: "user-12c2d785@example.com" })).toEqual({ case: "fall-eins", free: true, critical_missed: "2+" });
  });
  it("only the landing view is anonymous; the waitlist has no event", () => {
    expect(FUNNEL_EVENTS).toContain("de_kp_landing_view");
    expect(FUNNEL_EVENTS.filter((e) => e.startsWith("de_kp")).length).toBe(1);
    expect(isAllowedEvent("de_kp_waitlist")).toBe(false);
  });
});
