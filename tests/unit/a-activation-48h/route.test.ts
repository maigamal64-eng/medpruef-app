import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { freeOpeningIds, freeSetIds } from "@/lib/free-set";

const h = vi.hoisted(() => ({
  db: vi.fn(),
  tables: [] as string[],
  profile: { createdAt: "2026-10-15T08:00:00Z", activeExam: "kmp_innsbruck", examDate: null } as Record<string, unknown> | undefined,
  answered: [] as number[],
  translated: [] as number[],
  translationsFail: false,
}));

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({
  requireUser: async () => ({
    userId: "33333333-3333-4333-8333-333333333333", role: "user", tier: "free", tierExpiresAt: null,
    profile: h.profile ? { emailStatus: null, languageCode: "de", onboardingCompletedAt: null, referralsEnabled: false, dailyGoal: 20, ...h.profile } : undefined,
  }),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceClient: () => {
    h.db();
    return {
      from: (table: string) => {
        h.tables.push(table);
        const q = {
          select: () => q,
          eq: () => q,
          in: async () => (h.translationsFail ? { data: null, error: { message: "boom" } } : { data: h.translated.map((question_id) => ({ question_id })), error: null }),
          limit: async () => ({ data: h.answered.map((question_id) => ({ question_id })), error: null }),
          maybeSingle: async () => ({ data: { created_at: "2026-10-15T08:00:00Z", active_exam: "kenntnispruefung", exam_date: null }, error: null }),
        };
        return q;
      },
    };
  },
}));

import { GET } from "@/app/api/activation/route";

const get = (lang = "en") => GET(new NextRequest(`https://medpruf.com/api/activation?lang=${lang}`));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  h.db.mockClear();
  h.tables.length = 0;
  h.profile = { createdAt: "2026-10-15T08:00:00Z", activeExam: "kmp_innsbruck", examDate: null };
  h.answered = [];
  h.translated = [];
  h.translationsFail = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/api/activation", () => {
  it("answers {enabled:false} with no read while the flag is off", async () => {
    const r = await get();
    expect(await r.json()).toEqual({ enabled: false });
    expect(h.db).not.toHaveBeenCalled();
  });

  it("outside the 48 hours it reads nothing beyond the guard", async () => {
    vi.stubEnv("ACTIVATION_48H_ENABLED", "true");
    h.profile = { createdAt: "2026-10-01T08:00:00Z", activeExam: "kmp_innsbruck", examDate: null };
    const body = await (await get()).json();
    expect(body).toEqual({ enabled: true, stage: "outside" });
    expect(h.tables).toEqual([]);
  });

  it("a new learner gets the starter set: opening first, translated next, no users read", async () => {
    vi.stubEnv("ACTIVATION_48H_ENABLED", "true");
    const opening = freeOpeningIds("kmp_innsbruck");
    const translated = freeSetIds("kmp_innsbruck").filter((id) => !opening.includes(id)).slice(0, 2);
    h.translated = [...translated];
    const body = await (await get("en")).json();
    expect(body).toMatchObject({ enabled: true, stage: "starter", exam: "kmp_innsbruck", segment: "stichprobentest", answered: 0, named: false, first_win_size: 10 });
    expect(body.starter.ids).toHaveLength(10);
    expect(body.starter.ids.slice(0, opening.length)).toEqual([...opening]);
    expect(body.starter.ids.slice(opening.length, opening.length + 2).sort()).toEqual([...translated].sort());
    expect(body.starter).toMatchObject({ translated: 2, lang: "en" });
    expect(body.starter.href).toContain("starter=1");
    expect(h.tables).not.toContain("users");
    expect(h.tables).toEqual(["answer_history", "question_translations"]);
  });

  it("German readers get no translation read; a failed translation read still forms the set", async () => {
    vi.stubEnv("ACTIVATION_48H_ENABLED", "true");
    const de = await (await get("de")).json();
    expect(de.starter).toMatchObject({ translated: null, lang: null });
    expect(h.tables).toEqual(["answer_history"]);
    h.tables.length = 0;
    h.translationsFail = true;
    const ru = await (await get("ru")).json();
    expect(ru.starter.ids).toHaveLength(10);
    expect(ru.starter.translated).toBeNull();
  });

  it("continues with the remaining count and stops at 10", async () => {
    vi.stubEnv("ACTIVATION_48H_ENABLED", "true");
    h.answered = freeSetIds("kmp_innsbruck").slice(0, 4);
    const mid = await (await get("de")).json();
    expect(mid).toMatchObject({ stage: "continue", answered: 4 });
    expect(mid.starter.ids).toHaveLength(6);
    for (const id of h.answered) expect(mid.starter.ids).not.toContain(id);
    h.answered = freeSetIds("kmp_innsbruck").slice(0, 10);
    const won = await (await get("de")).json();
    expect(won).toMatchObject({ stage: "after_win", answered: 10, starter: null });
    expect(typeof won.reminder_hour).toBe("number");
  });

  it("names the sitting from the profile date and reads users only without a guard profile", async () => {
    vi.stubEnv("ACTIVATION_48H_ENABLED", "true");
    h.profile = undefined;
    const body = await (await get("de")).json();
    expect(h.tables[0]).toBe("users");
    expect(body).toMatchObject({ exam: "kenntnispruefung", segment: "vienna_sip" });
  });
});
