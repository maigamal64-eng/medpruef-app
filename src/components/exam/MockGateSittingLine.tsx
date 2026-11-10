"use client";

/**
 * The B2 line under gate_body on the mock-exam wall (a-b2-mock-gate-1110) and
 * the one plans button that replaces the gate's own while the line renders.
 * Renders nothing when the line is "none", so the gate stays as before.
 */
import Link from "next/link";
import { trackEvent } from "@/lib/tracker";
import { mockGateClick, type MockGateLine } from "@/lib/mock-gate-sitting";

export function MockGateLineText({ line }: { line: MockGateLine }) {
  if (line.state === "none") return null;
  return (
    <>
      {line.lines.map((l) => (
        <p key={l} className="text-sm text-[var(--mp-fg)]" data-testid="mock-gate-b2-line">{l}</p>
      ))}
    </>
  );
}

/** Logs paywall_click with line "b2" (target pricing for the sitting line, add_sitting for the ask line). */
export function trackMockGateClick(line: MockGateLine): void {
  const click = mockGateClick(line);
  if (click) trackEvent("paywall_click", { ...click, gate: "mock_exam" });
}

export function MockGateCta({ line, className, onClick }: { line: MockGateLine; className: string; onClick?: () => void }) {
  if (line.state === "none") return null;
  return (
    <Link href={line.cta.href} className={className} data-testid="mock-gate-b2-cta" onClick={() => { trackMockGateClick(line); onClick?.(); }}>
      {line.cta.label}
    </Link>
  );
}
