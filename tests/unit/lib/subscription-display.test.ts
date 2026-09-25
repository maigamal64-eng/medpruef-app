import { describe, expect, it } from "vitest";
import { getSubscriptionDisplayNames } from "@/lib/subscription-display";

describe("getSubscriptionDisplayNames", () => {
  it.each(["first_month_19", "first_3mo_27"])(
    "uses cadence-neutral names for legacy tier %s",
    (tierKey) => {
      expect(
        getSubscriptionDisplayNames(
          tierKey,
          "One-time plan, no auto-renewal",
          "Einmalig, keine automatische Verlängerung",
        ),
      ).toEqual({
        humanName: "MedPrüf Pro access",
        humanNameDe: "MedPrüf Pro-Zugang",
      });
    },
  );

  it("keeps provider-distinct tier labels", () => {
    expect(
      getSubscriptionDisplayNames(
        "notes_pro_trial",
        "7-day Pro trial",
        "7-Tage-Pro-Test",
      ),
    ).toEqual({
      humanName: "7-day Pro trial",
      humanNameDe: "7-Tage-Pro-Test",
    });
  });
});
