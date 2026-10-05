const MIN_TRACKED_TIME = Date.parse("2020-01-01T00:00:00.000Z");
const CLOCK_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Clamp malformed or implausible client clocks to trusted server receipt time. */
export function normalizeEventTimestamp(value: unknown, now = new Date()): string {
  if (typeof value !== "string") return now.toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || parsed < MIN_TRACKED_TIME || parsed > now.getTime() + CLOCK_FUTURE_TOLERANCE_MS) {
    return now.toISOString();
  }
  return new Date(parsed).toISOString();
}

/** Keep route telemetry useful while dropping query strings, fragments, and raw IDs. */
export function normalizeTrackedPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const pathname = new URL(value, "https://medpruf.invalid").pathname;
    const segments = pathname.split("/").map((segment) => {
      if (!segment) return segment;
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) || /^\d{4,}$/.test(segment)) return ":id";
      if (/^[A-Za-z0-9_-]{24,}$/.test(segment)) return ":id";
      return segment;
    });
    return segments.join("/").slice(0, 300) || "/";
  } catch {
    return null;
  }
}
