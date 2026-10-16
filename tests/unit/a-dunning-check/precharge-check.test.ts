import { describe, expect, it } from "vitest";
import { prechargeVerdict } from "../../../scripts/whop/precharge-check";

const MEM = "mem_redacted05679f31";
const base = {
  id: MEM,
  plan: { id: "plan_trial" },
  currency: "eur",
  formatted_renewal_price: "€19.00 / month",
  renewal_period_end: "2026-10-30T14:53:44.868Z",
  cancel_at_period_end: false,
  payment_collection_paused: false,
  manage_url: "https://whop.com/billing/manage/mber_TEST",
};

describe("precharge-check (read-only verdict)", () => {
  const prev = process.env.WHOP_PLAN_NOTES_TRIAL;
  process.env.WHOP_PLAN_NOTES_TRIAL = "plan_trial";

  it("an active monthly renewal (past its trial) never gets the pre-charge reminder", () => {
    const v = prechargeVerdict({ ...base, status: "active" }, MEM, { TRIAL_REMINDER_EMAILS_ENABLED: "true" }, true);
    expect(v.wouldSend).toBe(false);
    expect(v.gates.find((g) => g.gate === "provider: status trialing")).toMatchObject({ pass: false, detail: "active" });
    expect(v.simulatedAt).toBe("2026-10-29T02:53:44.868Z");
  });

  it("the code constant blocks every send while VERIFIED_CANCEL_PATH is false", () => {
    const v = prechargeVerdict({ ...base, status: "trialing" }, MEM, { TRIAL_REMINDER_EMAILS_ENABLED: "true" }, false);
    expect(v.wouldSend).toBe(false);
    expect(v.gates.find((g) => g.gate === "provider: eligiblePrechargeReminder 36 h before the charge")?.pass).toBe(true);
  });

  it("a trialing membership with both gates open would send", () => {
    const v = prechargeVerdict({ ...base, status: "trialing" }, MEM, { TRIAL_REMINDER_EMAILS_ENABLED: "true" }, true);
    expect(v.wouldSend).toBe(true);
    expect(v.membership).toBe("mem_TESTp");
  });

  it("an unreadable membership is not eligible", () => {
    expect(prechargeVerdict(null, MEM, {}, true).wouldSend).toBe(false);
    if (prev === undefined) delete process.env.WHOP_PLAN_NOTES_TRIAL;
  });
});
