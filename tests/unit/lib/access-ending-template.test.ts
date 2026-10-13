import { describe, expect, it } from "vitest";
import { formatAccessEnd, renderAccessEndingReminder } from "@/lib/email/access-ending-template";
import { whopExtensionsEnabled } from "@/lib/whop-extension";
import { WHOP_MANAGE_URL } from "@/lib/billing-copy";

// D2 ([name] 14 Oct, Lektor APPROVE on the AFTER blocks): the access-ending mail
// lists the recurring plans first (3 Monate recommended, then Monatsabo) and the
// Cohort last, and says booking is not possible before the access end.
const NOW = new Date("2026-10-26T07:00:00Z");
const END = "2026-10-30T21:59:00Z";

function render(lang: "de" | "en") {
  return renderAccessEndingReminder({
    firstName: "Mira",
    lang,
    accessEndsAtIso: END,
    qsAnswered: 120,
    accuracyPct: 75,
    streakDays: 3,
    now: NOW,
  });
}

const OLD_DE = ["selbst einen Tarif wählen", "sofortiger Vollzugang", "3-Monats-Tarif"];
const OLD_EN = ["choose a plan yourself", "instant full access", "Single Month", "3-Month plan"];

describe("access-ending mail, D2 plan order", () => {
  it("DE: 3 Monate, then Monatsabo, then Prüfungs-Kohorte", () => {
    const { htmlBody } = render("de");
    const a = htmlBody.indexOf("<strong>3 Monate</strong>");
    const b = htmlBody.indexOf("<strong>Monatsabo</strong>");
    const c = htmlBody.indexOf("<strong>Prüfungs-Kohorte</strong>");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(htmlBody).toContain("(empfohlen)");
  });

  it("EN: 3 months, then Monthly plan, then Exam Cohort", () => {
    const { htmlBody } = render("en");
    const a = htmlBody.indexOf("<strong>3 months</strong>");
    const b = htmlBody.indexOf("<strong>Monthly plan</strong>");
    const c = htmlBody.indexOf("<strong>Exam Cohort</strong>");
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(htmlBody).toContain("(recommended)");
  });

  it("DE: old wording gone; lead, Stopp line and cancel link present", () => {
    const { htmlBody } = render("de");
    for (const s of OLD_DE) expect(htmlBody).not.toContain(s);
    const endFmt = formatAccessEnd(END, "de");
    expect(htmlBody).toContain(`Sobald Ihr Zugang am <strong>${endFmt}</strong> endet`);
    expect(htmlBody).toContain("Vorher ist eine Buchung hier noch nicht möglich");
    expect(htmlBody).toContain("antworten Sie mit „Stopp“");
    expect(htmlBody).toContain(`href="${WHOP_MANAGE_URL}"`);
    expect(htmlBody).toContain('href="https://medpruf.com/pricing"');
  });

  it("EN: old wording gone; lead, Stop line and cancel link present", () => {
    const { htmlBody } = render("en");
    for (const s of OLD_EN) expect(htmlBody).not.toContain(s);
    const endFmt = formatAccessEnd(END, "en");
    expect(htmlBody).toContain(`once your access ends on <strong>${endFmt}</strong>`);
    expect(htmlBody).toContain("Booking is not possible here before then");
    expect(htmlBody).toContain('reply "Stop"');
    expect(htmlBody).toContain(`href="${WHOP_MANAGE_URL}"`);
    expect(htmlBody).toContain('href="https://medpruf.com/pricing"');
  });

  it("no em dash in either language", () => {
    for (const lang of ["de", "en"] as const) {
      const { subject, htmlBody } = render(lang);
      expect(htmlBody).not.toContain("—");
      expect(subject).not.toContain("—");
    }
  });

  // Coupling: "Vorher ist eine Buchung hier noch nicht möglich" / "Booking is
  // not possible here before then" is true only while WHOP_EXTENSIONS_ENABLED
  // is off (checkout answers EXTENSION_UNAVAILABLE before the access end).
  // Turning extensions on requires Lektor to re-approve this mail's lead and
  // this test to be updated in the same change.
  it("pre-expiry lead stays true: Whop extensions are off", () => {
    expect(process.env.WHOP_EXTENSIONS_ENABLED).not.toBe("true");
    expect(whopExtensionsEnabled()).toBe(false);
    expect(whopExtensionsEnabled({ WHOP_EXTENSIONS_ENABLED: "true" })).toBe(true);
  });
});
