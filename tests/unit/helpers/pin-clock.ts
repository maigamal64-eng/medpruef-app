import { afterEach, beforeEach, vi } from "vitest";

/**
 * Pins Date (only Date, timers stay real) for a test file whose fixtures use
 * fixed calendar dates as "the future". Without it such a file turns red the
 * day those dates pass. Call once at the top level of the file.
 */
export function pinClock(iso: string): void {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(iso));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
