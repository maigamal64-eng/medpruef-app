/**
 * a-release-int-6 seam (cram-card x tg-miniapp-welcome): sitting_set is a
 * server-only row. The Home cram card names its sitting through the same PATCH
 * with source cram_card; /api/track never accepts sitting_set.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAllowedEvent } from "@/lib/analytics-events";
import { SITTING_SET_SOURCES, sittingSetEventData } from "@/lib/tg-welcome/sitting-event";

describe("sitting_set stays server-only", () => {
  it("the tracker allowlist refuses it", () => {
    expect(isAllowedEvent("sitting_set")).toBe(false);
  });
  it("cram_card is a known server source next to tg_welcome", () => {
    expect([...SITTING_SET_SOURCES].sort()).toEqual(["cram_card", "tg_welcome"]);
    expect(sittingSetEventData({ source: "cram_card", activeExam: "kenntnispruefung", examDate: "2026-11-18", now: new Date("2026-10-20T10:00:00Z") })).toMatchObject({ source: "cram_card", exam: "kenntnispruefung" });
  });
  it("the cram card sends source cram_card in its PATCH and never tracks sitting_set", () => {
    const src = readFileSync(join(process.cwd(), "src/components/HomeCramCard.tsx"), "utf8");
    expect(src).toMatch(/JSON\.stringify\(\{ examDate: row\.date, source: "cram_card" \}\)/);
    expect(src).not.toMatch(/trackEvent\("sitting_set"/);
  });
});

describe("sitting_set sources follow their flags (reviewer P3)", () => {
  it("every flag off: no source writes", async () => {
    const { activeSittingSetSources } = await import("@/lib/tg-welcome/sitting-event");
    expect(activeSittingSetSources({})).toEqual([]);
    expect(activeSittingSetSources({ TG_MINIAPP_WELCOME_ENABLED: "true" })).toEqual(["tg_welcome"]);
    expect(activeSittingSetSources({ HOME_CRAM_CARD_ENABLED: "true" })).toEqual(["cram_card"]);
    expect(activeSittingSetSources({ TG_MINIAPP_WELCOME_ENABLED: "TRUE", HOME_CRAM_CARD_ENABLED: "1" })).toEqual([]);
  });
  it("selftest_saved is not a client event either", () => {
    expect(isAllowedEvent("selftest_saved")).toBe(false);
  });
});
