import { describe, expect, it } from "vitest";
import { privacyPaidPlansLine } from "@/lib/legal/privacy-plans";

describe("privacyPaidPlansLine (a-legal-lektor-1027)", () => {
  it("names the live v2 ladder and never a Group plan", () => {
    const de = privacyPaidPlansLine("de", { v2: true, halfYear: true, cardTrial: true });
    expect(de).toBe(
      "Abwicklung kostenpflichtiger Tarife (Monatsabo, Prüfungspass, 6 Monate, Garantie-Ticket sowie früher gebuchter Tarife) und des Pro-Tests mit hinterlegter Karte einschließlich Rechnungsstellung.",
    );
    const en = privacyPaidPlansLine("en", { v2: true, halfYear: true, cardTrial: true });
    expect(en).toBe(
      "Processing of paid plans (Monthly plan, Sitting Pass, 6 months, Guarantee Ticket, and plans bought earlier) and the Pro trial with a card on file, including invoicing.",
    );
    for (const line of [de, en]) expect(line).not.toMatch(/Group|—/);
  });

  it("leaves out the 6-month plan while it is not on sale and the trial while its copy is off", () => {
    const de = privacyPaidPlansLine("de", { v2: true, halfYear: false, cardTrial: false });
    expect(de).toContain("(Monatsabo, Prüfungspass, Garantie-Ticket sowie");
    expect(de).not.toContain("6 Monate");
    expect(de).not.toContain("Pro-Test");
  });

  it("names the trial while the 6-month plan is not on sale", () => {
    expect(privacyPaidPlansLine("de", { v2: true, halfYear: false, cardTrial: true })).toBe(
      "Abwicklung kostenpflichtiger Tarife (Monatsabo, Prüfungspass, Garantie-Ticket sowie früher gebuchter Tarife) und des Pro-Tests mit hinterlegter Karte einschließlich Rechnungsstellung.",
    );
  });

  it("falls back to a generic Pro line with v2 off", () => {
    expect(privacyPaidPlansLine("de", { v2: false, halfYear: false, cardTrial: false })).toBe(
      "Abwicklung kostenpflichtiger Pro-Tarife einschließlich Rechnungsstellung.",
    );
    expect(privacyPaidPlansLine("en", { v2: false, halfYear: true, cardTrial: true })).toBe(
      "Processing of paid Pro plans including invoicing.",
    );
  });
});
