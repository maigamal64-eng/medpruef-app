import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sanitizeEventData } from "@/lib/analytics-events";
import { te } from "@/lib/i18n-exam";

describe("mock exam gate opens the one paywall in place (issue 12)", () => {
  const src = readFileSync("src/app/exam/page.tsx", "utf8");
  it("no hard redirect to /pricing from /exam", () => {
    expect(src).not.toMatch(/window\.location\.(href|assign|replace)[^;]*pricing\?gate=mock_exam/);
  });
  it("free accounts get the paywall with gate mock_exam, surface exam, and a logged hit", () => {
    expect(src).toContain('<PaywallUpgradeModal open={gateOpen} onOpenChange={setGateOpen} lang={lang} gate="mock_exam" surface="exam" />');
    expect(src).toContain('trackEvent("paywall_hit", { gate: "mock_exam", surface: "exam"');
  });
  it("paywall_hit keeps gate, surface, exam and trigger through the allowlist", () => {
    expect(sanitizeEventData("paywall_hit", { gate: "mock_exam", surface: "exam", exam: "kenntnispruefung", trigger: "open" }))
      .toEqual({ gate: "mock_exam", surface: "exam", exam: "kenntnispruefung", trigger: "open" });
  });
  it("gate copy is formal German and has no dashes", () => {
    for (const k of ["gate_body", "gate_plans", "gate_back_practice"] as const) {
      expect(te(k, "de")).not.toMatch(/[—–]/);
      expect(te(k, "de")).not.toMatch(/\b(du|dein|dich)\b/i);
      expect(te(k, "en").length).toBeGreaterThan(3);
    }
  });
});
