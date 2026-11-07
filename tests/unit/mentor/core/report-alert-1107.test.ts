// a-sentry-retry-warn-1107: a recovered guard retry is a Sentry warning, a failed turn an error.
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }));
vi.mock("@/lib/sentry-capture", () => ({ captureServerError: m.error, captureServerWarning: m.warning }));

import type { MentorSseEvent } from "@/lib/mentor/contract";
import { createRunMentorTurn, type MentorAlert } from "@/lib/mentor/turn";
import { reportMentorAlert, withTurnFailureAlert } from "@/lib/mentor/report-alert";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { AiRefusal, AiTimeout } from "@/lib/ai/anthropic";
import { collect, makeDeps, turnInput, usage } from "./helpers";

beforeEach(() => {
  m.error.mockClear();
  m.warning.mockClear();
});

const alertOf = (kind: MentorAlert["kind"] | "turn_failed", detail?: string) => ({ kind, userId: "u", requestId: "r", detail });
const replaced: ValidatedAnswer = {
  blocks: [{ text: "Teil.", fact_ids: [] }, { text: "Nicht bestätigt.", fact_ids: [], replaced: true }],
  citations: [], replaced: true, rejected: [{ value: "2", reason: "not_in_cited_facts" as never }],
};
const clean: ValidatedAnswer = { blocks: [{ text: "Ganze Antwort.", fact_ids: [] }], citations: [], replaced: false, rejected: [] };

describe("reportMentorAlert", () => {
  it("sends a recovered citation repair through the warning path", () => {
    reportMentorAlert(alertOf("retry", "citation repair: 1 value(s) outside the cited facts"));
    expect(m.warning).toHaveBeenCalledTimes(1);
    expect(m.warning.mock.calls[0][0]).toBe("mentor retry: citation repair: 1 value(s) outside the cited facts");
    expect(m.warning.mock.calls[0][1]).toMatchObject({ route: "/api/mentor/chat", userId: "u", mentorAlert: "retry" });
    expect(m.error).not.toHaveBeenCalled();
  });

  it.each(["overrun", "settle_failed", "release_failed", "unpriced_model", "dropped_block", "tool_error", "brain_error", "validator_error", "house_policy_error", "duplicate_reserve", "turn_failed"] as const)(
    "keeps %s an error",
    (kind) => {
      reportMentorAlert(alertOf(kind, "x"));
      expect(m.error).toHaveBeenCalledTimes(1);
      expect(m.warning).not.toHaveBeenCalled();
    },
  );
});

describe("a turn through the real alert sink", () => {
  it("a repaired answer reports only a warning", async () => {
    const env = makeDeps(
      [{ text: "FIRST In Graz zwei Jahre.", usage: usage(1200, 300) }, { text: "SECOND", usage: usage(1300, 320) }],
      { grantMicro: 200_000, brain: { validate: (a: string) => (a.includes("FIRST") ? replaced : clean) } },
    );
    await collect<MentorSseEvent>(createRunMentorTurn({ alert: reportMentorAlert })(env.deps, turnInput()));
    expect(m.warning).toHaveBeenCalled();
    expect(m.error).not.toHaveBeenCalled();
  });

  it("a turn that fails after a retry reports an error", async () => {
    const env = makeDeps(
      [{ throw: new AiTimeout("timeout", {}) }, { throw: new AiTimeout("timeout", {}) }],
      { grantMicro: 200_000 },
    );
    const events = await collect<MentorSseEvent>(withTurnFailureAlert(createRunMentorTurn({ alert: reportMentorAlert }))(env.deps, turnInput()));
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(m.warning).toHaveBeenCalled();
    expect(m.error.mock.calls.some(([e]) => String((e as Error).message).startsWith("mentor turn_failed"))).toBe(true);
  });

  it("a refusal after a retry reports an error; a clean answer after a retry reports none", async () => {
    const env = makeDeps([{ throw: new AiTimeout("timeout", {}) }, { throw: new AiRefusal("refusal", {}) }], { grantMicro: 200_000 });
    const events = await collect<MentorSseEvent>(withTurnFailureAlert(createRunMentorTurn({ alert: reportMentorAlert }))(env.deps, turnInput()));
    expect(events.some((e) => e.type === "final" && e.result === "refusal")).toBe(true);
    expect(m.error.mock.calls.some(([e]) => String((e as Error).message).startsWith("mentor turn_failed: refusal"))).toBe(true);

    m.error.mockClear();
    const ok = makeDeps([{ throw: new AiTimeout("timeout", {}) }, { text: "Die Anmeldung läuft online.", usage: usage(1300, 320) }], { grantMicro: 200_000 });
    await collect<MentorSseEvent>(withTurnFailureAlert(createRunMentorTurn({ alert: reportMentorAlert }))(ok.deps, turnInput()));
    expect(m.error).not.toHaveBeenCalled();
  });
});
