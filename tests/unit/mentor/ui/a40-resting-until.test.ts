// a40 (MUX-99): a learner blocked by the monthly breaker sees when the mentor is expected back.
import { describe, expect, it } from "vitest";
import { restingUntilText } from "@/components/mentor/view-model";

const NOW = new Date("2026-10-20T10:00:00Z");
const resting = { state: "resting" as const, resting_until: "2026-11-01T00:00:00.000Z" };

describe("restingUntilText", () => {
  it("states the Vienna resume date in German (Sie-neutral) and English", () => {
    expect(restingUntilText(resting, "de", NOW)).toBe("Voraussichtlich wieder ab 1. November 2026.");
    expect(restingUntilText(resting, "en", NOW)).toBe("Expected back from 1 November 2026.");
  });

  it("untranslated languages get the English line with an English date", () => {
    expect(restingUntilText(resting, "ru", NOW)).toBe("Expected back from 1 November 2026.");
  });

  it("shows nothing for a manual pause, a past date, an invalid date or another state", () => {
    expect(restingUntilText({ state: "resting", resting_until: null }, "de", NOW)).toBeNull();
    expect(restingUntilText({ state: "resting", resting_until: "2026-10-01T00:00:00Z" }, "de", NOW)).toBeNull();
    expect(restingUntilText({ state: "resting", resting_until: "nope" }, "de", NOW)).toBeNull();
    expect(restingUntilText({ state: "ok", resting_until: "2026-11-01T00:00:00Z" }, "de", NOW)).toBeNull();
    expect(restingUntilText(null, "de", NOW)).toBeNull();
  });
});
