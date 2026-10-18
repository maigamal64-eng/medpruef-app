import { describe, expect, it } from "vitest";
import { freeSampleUsedUp, freeWallUpgradeEnabled, isBehindFreeWall, quizEmptyView, upgradeHref, wallSeen } from "@/lib/free-wall";
import { readFreeTopicEmpty } from "@/components/FreeTopicEmpty";

const base = { enabled: true, loadError: false, wall: null, freeTopicEmpty: false, serverEmpty: true, audience: "free" as const };

describe("freeWallUpgradeEnabled", () => {
  it("is off unless the literal true", () => {
    expect(freeWallUpgradeEnabled({})).toBe(false);
    expect(freeWallUpgradeEnabled({ NEXT_PUBLIC_FREE_WALL_UPGRADE: "1" })).toBe(false);
    expect(freeWallUpgradeEnabled({ NEXT_PUBLIC_FREE_WALL_UPGRADE: "TRUE" })).toBe(false);
    expect(freeWallUpgradeEnabled({ NEXT_PUBLIC_FREE_WALL_UPGRADE: "true" })).toBe(true);
  });
});

describe("quizEmptyView", () => {
  it("flag off keeps the legacy screens (load errors still win)", () => {
    expect(quizEmptyView({ ...base, enabled: false, wall: { gate: "qbank_limit", limit: 150 } })).toBe("legacy");
    expect(quizEmptyView({ ...base, enabled: false, freeTopicEmpty: true })).toBe("legacy");
    expect(quizEmptyView({ ...base, enabled: false, loadError: true })).toBe("load_error");
  });
  it("a load failure is never an upgrade screen", () => {
    expect(quizEmptyView({ ...base, loadError: true, wall: { gate: "qbank_limit" } })).toBe("load_error");
  });
  it("free at the cap keeps the wall card after the modal closes", () => {
    expect(quizEmptyView({ ...base, wall: { gate: "qbank_limit", seen: 150, limit: 150 } })).toBe("wall");
    expect(quizEmptyView({ ...base, wall: { gate: "qbank_limit" }, freeTopicEmpty: true })).toBe("wall");
  });
  it("a mode gate (review / wrong) also keeps its card, whatever the audience", () => {
    expect(quizEmptyView({ ...base, audience: "trial", wall: { gate: "spaced_repetition" } })).toBe("wall");
  });
  it("free topic wall", () => {
    expect(quizEmptyView({ ...base, freeTopicEmpty: true })).toBe("free_topic");
  });
  it("free or lapsed with an empty selection gets the upgrade line, never a bare done", () => {
    expect(quizEmptyView(base)).toBe("free_done");
    expect(quizEmptyView({ ...base, audience: "lapsed" })).toBe("free_done");
    expect(quizEmptyView({ ...base, audience: "guest" })).toBe("free_done");
  });
  it("an empty run that is not a server answer for an unfiltered selection keeps today's text", () => {
    expect(quizEmptyView({ ...base, serverEmpty: false })).toBe("legacy");
  });
  it("paid learners who finished keep the honest done state", () => {
    expect(quizEmptyView({ ...base, audience: "pro" })).toBe("done");
    expect(quizEmptyView({ ...base, audience: "trial" })).toBe("done");
  });
});

describe("isBehindFreeWall", () => {
  it("trial and pro have full access", () => {
    expect(isBehindFreeWall("trial")).toBe(false);
    expect(isBehindFreeWall("pro")).toBe(false);
    expect(isBehindFreeWall("free")).toBe(true);
  });
});

describe("upgradeHref", () => {
  it("carries the gate and a known bank only", () => {
    expect(upgradeHref("qbank_limit", "kmp_innsbruck")).toBe("/pricing?gate=qbank_limit&bank=kmp_innsbruck");
    expect(upgradeHref("wrong_only", "pharma")).toBe("/pricing?gate=mistakes&bank=pharma");
    expect(upgradeHref("full_bank", "evil&x=1")).toBe("/pricing?gate=full_bank");
    expect(upgradeHref("spaced_repetition", null)).toBe("/pricing?gate=spaced_repetition");
  });
});

describe("wallSeen", () => {
  it("only below the limit", () => {
    expect(wallSeen({ gate: "qbank_limit", seen: 140, limit: 150 })).toBe(140);
    expect(wallSeen({ gate: "qbank_limit", seen: 150, limit: 150 })).toBeNull();
    expect(wallSeen({ gate: "qbank_limit", seen: 162, limit: 150 })).toBeNull();
    expect(wallSeen({ gate: "qbank_limit", limit: 150 })).toBeNull();
    expect(wallSeen({ gate: "qbank_limit", seen: 40 })).toBeNull();
    expect(wallSeen({ gate: "qbank_limit", seen: 0, limit: 150 })).toBeNull();
  });
});

describe("freeSampleUsedUp (Home)", () => {
  it("true only when every subject reports 0 left and the bank has free questions", () => {
    expect(freeSampleUsedUp([{ freeTotal: 30, freeLeft: 0 }, { freeTotal: 0, freeLeft: 0 }], "free")).toBe(true);
    expect(freeSampleUsedUp([{ freeTotal: 30, freeLeft: 1 }, { freeTotal: 0, freeLeft: 0 }], "free")).toBe(false);
  });
  it("a missing count is never read as used up", () => {
    expect(freeSampleUsedUp([{ freeTotal: 30, freeLeft: 0 }, {}], "free")).toBe(false);
    expect(freeSampleUsedUp([{ freeLeft: 0 }], "free")).toBe(false);
    expect(freeSampleUsedUp([], "free")).toBe(false);
    expect(freeSampleUsedUp([{ freeTotal: 0, freeLeft: 0 }], "free")).toBe(false);
  });
  it("never for paid audiences", () => {
    expect(freeSampleUsedUp([{ freeTotal: 30, freeLeft: 0 }], "pro")).toBe(false);
    expect(freeSampleUsedUp([{ freeTotal: 30, freeLeft: 0 }], "trial")).toBe(false);
  });
});

describe("readFreeTopicEmpty", () => {
  it("keeps the free sample left when the server sends it", () => {
    expect(readFreeTopicEmpty({ freeTopicEmpty: true, reason: "all_seen", topics: [], freeLeft: 12 })).toEqual({ reason: "all_seen", topics: [], freeLeft: 12 });
    expect(readFreeTopicEmpty({ freeTopicEmpty: true, reason: "x", topics: [], freeLeft: "3" })).toEqual({ reason: "other", topics: [], freeLeft: null });
    expect(readFreeTopicEmpty({ freeTopicEmpty: true, freeLeft: -1 })?.freeLeft).toBeNull();
  });
});
