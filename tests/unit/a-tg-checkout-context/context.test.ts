import { describe, expect, it } from "vitest";
import {
  CHECKOUT_CONTEXTS, TELEGRAM_RETURN_URL, contextMetadata, parseCheckoutContext, parseReturnHint, withReturnHint,
} from "@/lib/checkout-context";
import { TG_CHECKOUT_COPY } from "@/lib/tg-checkout-copy";

describe("checkout context enum (a-tg-checkout-context)", () => {
  it("accepts exactly the four values and drops everything else", () => {
    for (const c of CHECKOUT_CONTEXTS) expect(parseCheckoutContext(c)).toBe(c);
    for (const bad of [undefined, null, "", "TG_WEBAPP", "telegram", 1, {}, ["browser"], "browser "]) expect(parseCheckoutContext(bad)).toBeNull();
  });
  it("metadata carries only a valid context", () => {
    expect(contextMetadata("pwa")).toEqual({ context: "pwa" });
    expect(contextMetadata("<script>")).toEqual({});
    expect(contextMetadata(undefined)).toEqual({});
  });
  it("the return hint is added only with the flag on and a Mini App opener", () => {
    const url = "https://medpruf.com/checkout/success?tier=flex_month";
    expect(withReturnHint(url, "tg_webapp", false)).toBe(url);
    expect(withReturnHint(url, "tg_inapp", true)).toBe(url);
    expect(withReturnHint(url, "browser", true)).toBe(url);
    expect(withReturnHint(url, "nonsense", true)).toBe(url);
    expect(withReturnHint(url, "tg_webapp", true)).toBe(`${url}&via=tg_webapp`);
    expect(withReturnHint("https://medpruf.com/x", "tg_webapp", true)).toBe("https://medpruf.com/x?via=tg_webapp");
  });
  it("the flag default is off (server env unset)", () => {
    const url = "https://medpruf.com/checkout/success?tier=flex_month";
    expect(withReturnHint(url, "tg_webapp")).toBe(url);
  });
  it("the page accepts only the enum hint and the way back is hard-coded", () => {
    expect(parseReturnHint("tg_webapp")).toBe("tg_webapp");
    for (const bad of [null, undefined, "", "https://evil.example", "tg_inapp"]) expect(parseReturnHint(bad)).toBeNull();
    expect(TELEGRAM_RETURN_URL).toBe("https://t.me/MedPruefBot");
  });
  it("copy has no dashes and German uses Sie", () => {
    for (const [key, v] of Object.entries(TG_CHECKOUT_COPY)) {
      expect(v.de, key).not.toMatch(/[–—]| - /);
      expect(v.en, key).not.toMatch(/[–—]| - /);
      expect(v.de, key).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    }
  });
});
