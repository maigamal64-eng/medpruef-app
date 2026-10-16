import { describe, expect, it } from "vitest";
import {
  ACTIVATION_STEPS,
  FIRST_WIN_SIZE,
  activationEnabled,
  activationSegment,
  activationStage,
  inActivationWindow,
  pickStarterIds,
  readingLang,
  reminderHourFor,
  starterHref,
  translatedCount,
} from "@/lib/activation/rules";
import { CANONICAL_EVENTS } from "@/lib/analytics-events";
import { SURFACES } from "@/lib/announcements/queue";

describe("activation flag and window", () => {
  it("is on only for the literal true", () => {
    expect(activationEnabled({})).toBe(false);
    expect(activationEnabled({ ACTIVATION_48H_ENABLED: "1" })).toBe(false);
    expect(activationEnabled({ ACTIVATION_48H_ENABLED: "TRUE" })).toBe(false);
    expect(activationEnabled({ ACTIVATION_48H_ENABLED: " true " })).toBe(true);
  });

  it("covers the first 48 hours after signup", () => {
    const created = "2026-10-15T08:00:00Z";
    expect(inActivationWindow(created, new Date("2026-10-15T08:00:00Z"))).toBe(true);
    expect(inActivationWindow(created, new Date("2026-10-17T07:59:59Z"))).toBe(true);
    expect(inActivationWindow(created, new Date("2026-10-17T08:00:00Z"))).toBe(false);
    expect(inActivationWindow(null, new Date())).toBe(false);
    expect(inActivationWindow("not a date", new Date())).toBe(false);
    // An hour of clock skew in the future is not "just created".
    expect(inActivationWindow("2026-10-15T09:00:00Z", new Date("2026-10-15T08:00:00Z"))).toBe(false);
  });

  it("stages by answers inside the window", () => {
    expect(activationStage({ inWindow: false, answered: 0 })).toBe("outside");
    expect(activationStage({ inWindow: true, answered: 0 })).toBe("starter");
    expect(activationStage({ inWindow: true, answered: FIRST_WIN_SIZE - 1 })).toBe("continue");
    expect(activationStage({ inWindow: true, answered: FIRST_WIN_SIZE })).toBe("after_win");
  });
});

describe("starter set", () => {
  const topicOf = new Map<number, string>([
    [1, "A"], [2, "A"], [3, "A"], [4, "B"], [5, "B"], [6, "C"], [7, "C"], [8, "D"], [9, "D"], [10, "E"], [11, "E"], [12, "F"],
  ]);
  const free = [...topicOf.keys()];

  it("puts the opening first, then translated ids across subjects, then the rest", () => {
    const ids = pickStarterIds({ opening: [3, 1], free, topicOf, translated: new Set([9, 8, 11]), answered: new Set(), size: 10 });
    expect(ids.slice(0, 2)).toEqual([3, 1]);
    // Translated next: one per subject, subjects not yet used first (D before E).
    expect(ids.slice(2, 5)).toEqual([8, 11, 9]);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("skips answered and non-free ids and stops at the size", () => {
    const ids = pickStarterIds({ opening: [1, 99], free, topicOf, translated: new Set(), answered: new Set([1, 4]), size: 3 });
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(4);
    expect(ids).not.toContain(99);
    expect(ids).toHaveLength(3);
    expect(pickStarterIds({ opening: [], free, topicOf, translated: new Set(), answered: new Set(), size: 0 })).toEqual([]);
  });

  it("spreads the rest one per subject per round", () => {
    const ids = pickStarterIds({ opening: [], free, topicOf, translated: new Set(), answered: new Set(), size: 6 });
    expect(ids.map((id) => topicOf.get(id))).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  it("is deterministic and counts translations", () => {
    const a = pickStarterIds({ opening: [2], free, topicOf, translated: new Set([5]), answered: new Set(), size: 10 });
    const b = pickStarterIds({ opening: [2], free, topicOf, translated: new Set([5]), answered: new Set(), size: 10 });
    expect(a).toEqual(b);
    expect(translatedCount(a, new Set([5, 77]))).toBe(1);
  });

  it("links the quiz ids hand-off with the starter mark", () => {
    const href = starterHref("kmp_innsbruck", [5, 6]);
    const u = new URL(href, "https://medpruf.com");
    expect(u.pathname).toBe("/quiz");
    expect(u.searchParams.get("ids")).toBe("5,6");
    expect(u.searchParams.get("starter")).toBe("1");
    expect(u.searchParams.get("examSource")).toBe("kmp_innsbruck");
  });
});

describe("language, segment, reminder hour", () => {
  it("reads a translation target; German needs none", () => {
    expect(readingLang("de")).toBeNull();
    expect(readingLang("en")).toBe("en");
    expect(readingLang("ru-RU")).toBe("ru");
    expect(readingLang("fa")).toBeNull();
    expect(readingLang(null)).toBeNull();
  });

  it("segments by the named sitting first, then the bank", () => {
    expect(activationSegment("rez_gm", "kenntnispruefung")).toBe("rez_gm");
    expect(activationSegment(null, "kmp_innsbruck")).toBe("stichprobentest");
    expect(activationSegment(null, "kenntnispruefung")).toBe("vienna_sip");
    expect(activationSegment(null, "pharma")).toBe("rez_gm");
    expect(activationSegment(null, null)).toBe("unknown");
  });

  it("offers this Vienna hour, kept inside 06 to 22", () => {
    expect(reminderHourFor(new Date("2026-10-15T16:30:00Z"))).toBe(18); // CEST
    expect(reminderHourFor(new Date("2026-10-15T01:00:00Z"))).toBe(6);
    expect(reminderHourFor(new Date("2026-10-15T21:30:00Z"))).toBe(22);
    expect(reminderHourFor(new Date("2026-12-15T17:00:00Z"))).toBe(18); // CET
  });
});

describe("wiring", () => {
  it("the event allowlist carries activation_step with step, exam, lang", () => {
    expect(CANONICAL_EVENTS.activation_step).toEqual(["step", "exam", "lang"]);
    expect(ACTIVATION_STEPS).toContain("first_win");
  });

  it("the Home card is a non-marketing priority-2 inline surface that sorts after a stalled checkout and before the journey", () => {
    expect(SURFACES.first_steps).toMatchObject({ kind: "inline", priority: 2, marketing: false });
    const twos = (Object.keys(SURFACES) as (keyof typeof SURFACES)[]).filter((k) => SURFACES[k].priority === 2 && SURFACES[k].kind === "inline").sort();
    expect(twos.indexOf("checkout_stall")).toBeLessThan(twos.indexOf("first_steps"));
    expect(twos.indexOf("first_steps")).toBeLessThan(twos.indexOf("journey_sitting_prompt"));
  });
});
