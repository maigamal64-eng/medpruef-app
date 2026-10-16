import { afterEach, describe, expect, it } from "vitest";
import { arrivalPathKey, captureTypedCodeAttribution, getStoredAttribution } from "@/lib/attribution";

// a-release-int-5: a typed code (a-code-front-door) beats an organic arrival record,
// including a sitting page arrival (a-sitting-pages), and never a real campaign link.
function fakeWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    },
  };
  return store;
}
afterEach(() => { delete (globalThis as { window?: unknown }).window; });

describe("first touch: utm link > typed code > arrival", () => {
  it("keys a sitting page as sitting:<slug>", () => {
    expect(arrivalPathKey("/pruefungskalender/sip4a-2027-02-19")).toBe("sitting:sip4a-2027-02-19");
    expect(arrivalPathKey("/pruefungskalender")).toBeNull();
  });
  it("a typed code replaces a sitting page arrival", () => {
    const store = fakeWindow();
    const key = "medpruef_attribution";
    store.set(key, JSON.stringify({ utm_source: "arrival", utm_medium: "organic", utm_campaign: "sitting:sip4a-2027-02-19", captured_at: "2026-10-15T00:00:00Z" }));
    captureTypedCodeAttribution("WIEN-GRUPPE");
    const written = JSON.parse(store.get(key) as string);
    expect(written).toMatchObject({ utm_source: "code", utm_medium: "typed", utm_campaign: "wien-gruppe" });
    expect(getStoredAttribution()).toMatchObject({ utm_source: "code" });
  });
  it("a real campaign link stays", () => {
    const store = fakeWindow();
    store.set("medpruef_attribution", JSON.stringify({ utm_source: "telegram", utm_medium: "group", utm_campaign: "spt", captured_at: "2026-10-15T00:00:00Z" }));
    captureTypedCodeAttribution("WIEN-GRUPPE");
    expect(JSON.parse(store.get("medpruef_attribution") as string)).toMatchObject({ utm_source: "telegram" });
  });
});
