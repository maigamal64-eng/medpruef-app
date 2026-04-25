import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNowpaymentsInvoice } from "@/lib/nowpayments";

/**
 * Unit test for the NOWPayments invoice creation request body.
 *
 * Why this exists: in PR #5 we discovered the rescue-sprint prompt
 * §1.5 explicitly required that every invoice we create has:
 *   - pay_currency: 'usdttrc20'
 *   - is_fixed_rate: true
 *   - ipn_callback_url present (not relying on dashboard config)
 *   - order_description includes "MedPrüf ([name])"
 *
 * The 5 stuck Apr-23 invoices were likely caused by a missing
 * dashboard URL config; locking this in code lets us catch a
 * regression before it ships.
 */

describe("createNowpaymentsInvoice — request body shape", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: "inv_test_1",
          invoice_url: "https://nowpayments.io/payment/?iid=inv_test_1",
          order_id: "sub_test_1",
          order_description: "test",
          price_amount: 19,
          price_currency: "EUR",
          pay_currency: "usdttrc20",
          ipn_callback_url: "https://medpruf.com/api/webhooks/nowpayments",
          success_url: "https://medpruf.com/?welcome=cohort",
          cancel_url: "https://medpruf.com/pricing?cancelled=true",
          created_at: "2026-04-24T00:00:00Z",
          updated_at: "2026-04-24T00:00:00Z",
        }),
    });
    // @ts-expect-error — global fetch override
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults pay_currency to usdttrc20 when not specified", async () => {
    await createNowpaymentsInvoice(
      {
        priceAmount: 19,
        priceCurrency: "EUR",
        orderId: "sub_test_1",
        orderDescription: "MedPrüf ([name]) — Erster Monat — paid access",
        ipnCallbackUrl: "https://medpruf.com/api/webhooks/nowpayments",
        successUrl: "https://medpruf.com/?welcome=cohort",
        cancelUrl: "https://medpruf.com/pricing?cancelled=true",
      },
      "fake-api-key",
    );
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pay_currency).toBe("usdttrc20");
    expect(body.is_fixed_rate).toBe(true);
    expect(body.ipn_callback_url).toBe("https://medpruf.com/api/webhooks/nowpayments");
    expect(body.order_description).toContain("MedPrüf");
    expect(body.order_description).toContain("[name]");
    expect(body.success_url).toBe("https://medpruf.com/?welcome=cohort");
    expect(body.cancel_url).toBe("https://medpruf.com/pricing?cancelled=true");
  });

  it("respects an explicit payCurrency override", async () => {
    await createNowpaymentsInvoice(
      {
        priceAmount: 114,
        priceCurrency: "EUR",
        orderId: "sub_test_2",
        orderDescription: "MedPrüf — Cohort",
        ipnCallbackUrl: "https://medpruf.com/api/webhooks/nowpayments",
        successUrl: "https://medpruf.com/?welcome=cohort",
        cancelUrl: "https://medpruf.com/pricing?cancelled=true",
        payCurrency: "usdcerc20",
      },
      "fake-api-key",
    );
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pay_currency).toBe("usdcerc20");
  });

  it("omits pay_currency when payCurrency is explicitly null", async () => {
    await createNowpaymentsInvoice(
      {
        priceAmount: 19,
        priceCurrency: "EUR",
        orderId: "sub_test_3",
        orderDescription: "test",
        ipnCallbackUrl: "https://medpruf.com/api/webhooks/nowpayments",
        successUrl: "https://medpruf.com/",
        cancelUrl: "https://medpruf.com/pricing",
        payCurrency: null,
      },
      "fake-api-key",
    );
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.pay_currency).toBeUndefined();
  });

  it("respects isFixedRate=false override", async () => {
    await createNowpaymentsInvoice(
      {
        priceAmount: 19,
        priceCurrency: "EUR",
        orderId: "sub_test_4",
        orderDescription: "test",
        ipnCallbackUrl: "https://medpruf.com/api/webhooks/nowpayments",
        successUrl: "https://medpruf.com/",
        cancelUrl: "https://medpruf.com/pricing",
        isFixedRate: false,
      },
      "fake-api-key",
    );
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.is_fixed_rate).toBe(false);
  });

  it("throws when apiKey is missing", async () => {
    await expect(
      createNowpaymentsInvoice(
        {
          priceAmount: 19,
          priceCurrency: "EUR",
          orderId: "sub_test_5",
          orderDescription: "test",
          ipnCallbackUrl: "https://medpruf.com/api/webhooks/nowpayments",
          successUrl: "https://medpruf.com/",
          cancelUrl: "https://medpruf.com/pricing",
        },
        "",
      ),
    ).rejects.toThrow(/NOWPAYMENTS_API_KEY/);
  });
});
