import { describe, expect, it } from "vitest";
import { SURFACES, electSurfaces, type QueueContext } from "@/lib/announcements/queue";

const ctx: QueueContext = { onboardingOpen: false, firstSession: false, answeredTotal: 10, fieldFocused: false, msSincePointerDown: 10_000 };
const now = Date.parse("2026-11-17T08:00:00Z");

describe("sitting-week promotion pause", () => {
  it("only access and renewal, the learner's own stalled payment, own moments, own first steps and the cram card are not promotion", () => {
    expect(Object.entries(SURFACES).filter(([, s]) => !s.marketing).map(([id]) => id).sort()).toEqual([
      "checkout_stall",
      "email_validation",
      "first_steps",
      "home_cram",
      "journey_cram",
      "journey_sitting_prompt",
      "renewal",
      "renewal_recovery",
    ]);
  });

  it("blocks promotion surfaces while paused and keeps them otherwise", () => {
    expect(electSurfaces(["trial_card", "orientation"], ctx, {}, {}, now)).toEqual({ modal: "orientation", inline: "trial_card" });
    expect(electSurfaces(["trial_card", "orientation", "install_card"], { ...ctx, marketingPaused: true }, {}, {}, now)).toEqual({ modal: null, inline: null });
    expect(electSurfaces(["trial_card", "checkout_stall"], { ...ctx, marketingPaused: true }, {}, {}, now).inline).toBe("checkout_stall");
  });

  it("renewal and the journey card still show in the sitting week", () => {
    expect(electSurfaces(["trial_card", "renewal"], { ...ctx, marketingPaused: true }, {}, {}, now).inline).toBe("renewal");
    expect(electSurfaces(["trial_card", "journey_cram"], { ...ctx, marketingPaused: true }, {}, {}, now).inline).toBe("journey_cram");
  });

  it("a promotion card already shown this session steps aside when the pause starts", () => {
    expect(electSurfaces(["trial_card"], { ...ctx, marketingPaused: true }, {}, { inline: "trial_card" }, now).inline).toBeNull();
    expect(electSurfaces(["trial_card"], ctx, {}, { inline: "trial_card" }, now).inline).toBe("trial_card");
  });
});
