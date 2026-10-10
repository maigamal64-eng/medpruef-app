import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

import { timingSafeEqual } from "node:crypto";
import { safeEqual } from "@/lib/security/timing-safe";

describe("safeEqual (C11 constant-time compare)", () => {
  it("returns true for identical secrets", () => {
    expect(safeEqual("s3cr3t-token", "s3cr3t-token")).toBe(true);
  });

  it("returns false for different secrets of the same length", () => {
    expect(safeEqual("s3cr3t-token", "s3cr3t-tokeN")).toBe(false);
  });

  it("returns false (does not throw) for different lengths", () => {
    expect(() => safeEqual("short", "much-longer-secret")).not.toThrow();
    expect(safeEqual("short", "much-longer-secret")).toBe(false);
  });

  it("guards on byte length, not string length", () => {
    // Same .length (1), different UTF-8 byte length (2 vs 1): raw
    // timingSafeEqual would throw here.
    expect("é".length).toBe("e".length);
    expect(() => safeEqual("é", "e")).not.toThrow();
    expect(safeEqual("é", "e")).toBe(false);
    expect(safeEqual("ünïcødé", "ünïcødé")).toBe(true);
  });

  it("fails closed on null, undefined, non-strings and empty values", () => {
    expect(safeEqual(null, "x")).toBe(false);
    expect(safeEqual("x", undefined)).toBe(false);
    expect(safeEqual(undefined, undefined)).toBe(false);
    expect(safeEqual(123, 123)).toBe(false);
    expect(safeEqual("", "")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });

  it("uses crypto.timingSafeEqual on both the equal and the length-mismatch path", () => {
    const spy = vi.mocked(timingSafeEqual);
    spy.mockClear();
    safeEqual("abc", "abc");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    safeEqual("abc", "abcd");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
