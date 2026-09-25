import { afterEach, describe, expect, it, vi } from "vitest";
import { createWhopCheckoutSession, tierToWhopPlan, whopPlanToTier } from "@/lib/whop";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Whop plan ID whitespace normalization", () => {
  it("trims plan IDs from environment variables in both directions", () => {
    vi.stubEnv("WHOP_PLAN_FIRST_3MO_27", "plan_quarterly\n");

    expect(tierToWhopPlan("first_3mo_27")).toBe("plan_quarterly");
    expect(whopPlanToTier("plan_quarterly")).toBe("first_3mo_27");
  });

  it("sends and returns the normalized plan ID for checkout", async () => {
    vi.stubEnv("WHOP_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "checkout_1", purchase_url: "https://checkout.example/1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const session = await createWhopCheckoutSession({
      planId: "plan_quarterly\n",
      metadata: {},
      redirectUrl: "https://medpruf.com/checkout/success",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).plan_id).toBe("plan_quarterly");
    expect(session.planId).toBe("plan_quarterly");
  });
});
