import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// a-release-int-5 reviewer P2: with CHECKOUT_RETURN_READ_ENABLED off the browser writes no
// marker before Whop and sends no return request (build mirror NEXT_PUBLIC_CHECKOUT_RETURN_READ).
describe("checkout return read: browser side behind the build mirror", () => {
  it("next.config mirrors the server flag", () => {
    const cfg = readFileSync("next.config.ts", "utf8");
    expect(cfg).toContain('NEXT_PUBLIC_CHECKOUT_RETURN_READ: process.env.CHECKOUT_RETURN_READ_ENABLED === "true" ? "true" : ""');
  });
  it("the marker write and the reader both check it", () => {
    expect(readFileSync("src/app/pricing/PricingClient.tsx", "utf8")).toContain("if (CHECKOUT_RETURN_READ_BUILD) markCheckoutLeft(tier)");
    expect(readFileSync("src/components/CheckoutReturnReader.tsx", "utf8")).toContain("if (!CHECKOUT_RETURN_READ_BUILD || busy.current) return;");
    expect(readFileSync("src/lib/checkout-return-marker.ts", "utf8")).toContain('process.env.NEXT_PUBLIC_CHECKOUT_RETURN_READ === "true"');
  });
  it("is off in a build without the flag", async () => {
    delete process.env.NEXT_PUBLIC_CHECKOUT_RETURN_READ;
    const m = await import("@/lib/checkout-return-marker");
    expect(m.CHECKOUT_RETURN_READ_BUILD).toBe(false);
  });
});
