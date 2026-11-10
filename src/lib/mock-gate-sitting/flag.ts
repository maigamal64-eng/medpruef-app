/**
 * Switch and window of the mock-exam wall sitting line (a-b2-mock-gate-1110, angle B2).
 *
 *   MOCK_GATE_SITTING_ENABLED  server, default OFF: only the literal "true"
 *                              turns the line on. Off, the exam Pro gate card
 *                              and the mock_exam upgrade modal render exactly
 *                              as before.
 *
 * The window ends by itself: after MOCK_GATE_WINDOW_END (Cairo calendar day)
 * the line is dark even when the flag stays on. track-A may extend the end
 * only after the 23 Nov read, by changing the constant in a new commit.
 *
 * Pure: reads only the env object and the instant it is given.
 */
type Env = Record<string, string | undefined>;

/** Sun 22 Nov 2026, last day the line may show (Africa/Cairo). */
export const MOCK_GATE_WINDOW_END = "2026-11-22";

/** The calendar day (YYYY-MM-DD) of an instant in Cairo. */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function mockGateWindowOpen(now: Date = new Date()): boolean {
  return cairoToday(now) <= MOCK_GATE_WINDOW_END;
}

export function mockGateSittingEnabled(env: Env = process.env, now: Date = new Date()): boolean {
  return env.MOCK_GATE_SITTING_ENABLED === "true" && mockGateWindowOpen(now);
}
