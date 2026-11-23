/**
 * a-open-answer-fix-1123, Fix B: the self-grade tap after an open-answer reveal.
 * Flag off sends nothing; a tap sends one normal answer with self:known or
 * self:unknown; a reveal without a tap sends nothing.
 */
import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { selfGradeBody, selfGradeLabel, submitSelfGrade, type SelfGradeDeps } from "@/lib/openAnswerSelfGrade";
import { answerKeyFingerprint } from "@/lib/answer-key-fingerprint";
import { openAnswerSelfGradeEnabled } from "@/lib/open-answer-self-grade/flag";
import { isUnscoredAnswerReveal } from "@/lib/quizAnswer";
import { t } from "@/lib/i18n";

// vitest compiles JSX with the classic runtime; the component file relies on Next's automatic one.
(globalThis as { React?: unknown }).React = React;
const { default: OpenAnswerSelfGrade } = await import("@/components/OpenAnswerSelfGrade");

const args = (known: boolean) => ({ userId: "u1", requestId: "00000000-0000-4000-8000-000000000009", questionId: 110753, known, timeSpentMs: 4200, keyFingerprint: answerKeyFingerprint(110753, null) });
const deps = (over: Partial<SelfGradeDeps> = {}): SelfGradeDeps & { posts: Record<string, unknown>[] } => {
  const posts: Record<string, unknown>[] = [];
  return {
    posts,
    online: true,
    post: async (body) => { posts.push(body); return { status: 200, ok: true, json: async () => ({ saved: true, xp: 2, gamification: null, review: { intervalDays: 1 } }) }; },
    queue: vi.fn(async () => "id"),
    isRetryable: (s) => s === null || s >= 500,
    ...over,
  };
};

describe("flag", () => {
  it("only the literal 'true' turns it on", () => {
    expect(openAnswerSelfGradeEnabled({})).toBe(false);
    expect(openAnswerSelfGradeEnabled({ OPEN_ANSWER_SELF_GRADE_ENABLED: "1" })).toBe(false);
    expect(openAnswerSelfGradeEnabled({ OPEN_ANSWER_SELF_GRADE_ENABLED: "TRUE" })).toBe(false);
    expect(openAnswerSelfGradeEnabled({ OPEN_ANSWER_SELF_GRADE_ENABLED: "true" })).toBe(true);
  });
});

describe("the reveal itself", () => {
  it("is still unscored: an empty-selection false answer is never sent (the 27 Sep rule)", () => {
    expect(isUnscoredAnswerReveal(false, [])).toBe(true);
  });
});

describe("OpenAnswerSelfGrade markup", () => {
  const html = renderToStaticMarkup(createElement(OpenAnswerSelfGrade, { lang: "de", onSelfGrade: async () => true }));
  const htmlEn = renderToStaticMarkup(createElement(OpenAnswerSelfGrade, { lang: "en", onSelfGrade: async () => true }));
  it("shows the two buttons in DE and EN", () => {
    expect(html).toContain(">Gewusst<");
    expect(html).toContain(">Nicht gewusst<");
    expect(htmlEn).toContain(">I knew it<");
    expect(htmlEn).toContain(">I did not know it<");
  });
  it("copy has no dashes and is in the Sie register", () => {
    for (const k of ["a_open_self_q", "a_open_self_known", "a_open_self_unknown", "a_open_self_saved", "a_open_self_error"] as const) {
      for (const l of ["de", "en"] as const) expect(t(k, l)).not.toMatch(/[–—-]/);
    }
    expect(t("a_open_self_q", "de")).toContain("Sie");
  });
});

describe("submitSelfGrade", () => {
  it("'Nicht gewusst' sends one answer with isCorrect false and userAnswer self:unknown", async () => {
    const d = deps();
    const out = await submitSelfGrade(args(false), d);
    expect(d.posts).toHaveLength(1);
    expect(d.posts[0]).toMatchObject({ questionId: 110753, isCorrect: false, userAnswer: "self:unknown", requestId: args(false).requestId });
    expect(out).toMatchObject({ state: "saved", xp: 2 });
  });
  it("'Gewusst' sends isCorrect true and self:known with the open-answer key fingerprint", async () => {
    const d = deps();
    await submitSelfGrade(args(true), d);
    expect(d.posts[0]).toMatchObject({ isCorrect: true, userAnswer: "self:known", keyFingerprint: answerKeyFingerprint(110753, null) });
  });
  it("offline queues the same row for the outbox, sends nothing", async () => {
    const d = deps({ online: false });
    const out = await submitSelfGrade(args(true), d);
    expect(d.posts).toHaveLength(0);
    expect(d.queue).toHaveBeenCalledWith(expect.objectContaining({ userAnswer: "self:known", isCorrect: true, questionId: 110753 }));
    expect(out).toEqual({ state: "queued", serverQueued: false });
  });
  it("a 503 queues for the server retry; a 402 is a paywall; a 409 is refused and nothing is queued", async () => {
    const mk = (status: number) => deps({ post: async () => ({ status, ok: false, json: async () => ({ limit: 150 }) }) });
    const d503 = mk(503);
    expect(await submitSelfGrade(args(false), d503)).toEqual({ state: "queued", serverQueued: true });
    expect(await submitSelfGrade(args(false), mk(402))).toEqual({ state: "paywall", limit: 150 });
    const d409 = mk(409);
    expect(await submitSelfGrade(args(false), d409)).toEqual({ state: "refused" });
    expect(d409.queue).not.toHaveBeenCalled();
  });
  it("a body is the normal /api/answer body, nothing extra", () => {
    expect(Object.keys(selfGradeBody(args(true))).sort()).toEqual(["isCorrect", "keyFingerprint", "questionId", "requestId", "timeSpentMs", "userAnswer", "userId"]);
  });
  it("history shows a readable label, other answers pass through", () => {
    expect(selfGradeLabel("self:known", "de")).toContain("Gewusst");
    expect(selfGradeLabel("self:unknown", "en")).toContain("did not know");
    expect(selfGradeLabel("Aspirin", "de")).toBeNull();
  });
});
