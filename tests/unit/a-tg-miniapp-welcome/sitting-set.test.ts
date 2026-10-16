import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeHandler } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ db: vi.fn(), guard: vi.fn(), capture: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.db }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: m.capture }));

import { PATCH } from "@/app/api/user/exam-preference/route";
import { sittingSetEventData } from "@/lib/tg-welcome/sitting-event";

const UID = "00000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-11-06T10:00:00Z");

function db(handler: FakeHandler = () => ({ data: null })) {
  const fake = createFakeSupabase(handler);
  m.db.mockReturnValue(fake.sb);
  return fake;
}
const patch = (body: unknown) =>
  PATCH(new NextRequest("https://medpruf.com/api/user/exam-preference", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.guard.mockResolvedValue({ userId: UID });
  // a-release-int-6: a source writes only while its own flag is on.
  vi.stubEnv("TG_MINIAPP_WELCOME_ENABLED", "true");
});

describe("sittingSetEventData", () => {
  it("an official Stichprobentest sitting is named, segment from the journey rule", () => {
    expect(sittingSetEventData({ source: "tg_welcome", activeExam: "kmp_innsbruck", examDate: "2027-02-03", now: NOW })).toEqual({ source: "tg_welcome", exam: "kmp_innsbruck", named: true, segment: "stichprobentest" });
  });
  it("a custom date is saved but not named", () => {
    expect(sittingSetEventData({ source: "tg_welcome", activeExam: "kmp_innsbruck", examDate: "2027-02-04", now: NOW })).toMatchObject({ named: false, segment: null });
  });
  it("unknown or missing sources and empty dates write nothing", () => {
    expect(sittingSetEventData({ source: "settings", activeExam: "pharma", examDate: "2027-02-03", now: NOW })).toBeNull();
    expect(sittingSetEventData({ source: undefined, activeExam: "pharma", examDate: "2027-02-03", now: NOW })).toBeNull();
    expect(sittingSetEventData({ source: "tg_welcome", activeExam: "pharma", examDate: null, now: NOW })).toBeNull();
  });
});

describe("PATCH /api/user/exam-preference with source tg_welcome", () => {
  it("saves exam and date, then writes one sitting_set row for the account", async () => {
    const fake = db();
    const res = await patch({ activeExam: "kmp_innsbruck", examDate: "2027-02-03", source: "tg_welcome" });
    expect(res.status).toBe(200);
    const update = fake.calls.find((c) => c.table === "users" && c.op === "update");
    expect(update?.payload).toEqual({ active_exam: "kmp_innsbruck", exam_date: "2027-02-03" });
    const events = fake.calls.filter((c) => c.table === "user_events" && c.op === "insert");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ user_id: UID, event_type: "sitting_set", event_data: { source: "tg_welcome", exam: "kmp_innsbruck", named: true } });
  });
  it("without a bank in the body, the stored bank is read", async () => {
    const fake = db((c) => (c.table === "users" && c.op === "select" ? { data: { active_exam: "kmp_innsbruck" } } : { data: null }));
    await patch({ examDate: "2027-02-03", source: "tg_welcome" });
    expect(fake.calls.find((c) => c.table === "user_events")?.payload).toMatchObject({ event_data: { exam: "kmp_innsbruck", named: true } });
  });
  it("no source, an unknown source or 'noch offen' (null): no event", async () => {
    for (const body of [{ examDate: "2027-02-03" }, { examDate: "2027-02-03", source: "home" }, { examDate: null, source: "tg_welcome" }]) {
      const fake = db();
      expect((await patch(body)).status).toBe(200);
      expect(fake.calls.some((c) => c.table === "user_events")).toBe(false);
    }
  });
  it("a failed event write never fails the save", async () => {
    db((c) => (c.table === "user_events" ? { error: { message: "boom" } } : { data: null }));
    const res = await patch({ activeExam: "pharma", examDate: "2027-01-18", source: "tg_welcome" });
    expect(res.status).toBe(200);
    expect(m.capture).toHaveBeenCalledOnce();
  });
});
