import { describe, expect, it } from "vitest";
import { flagResolutionLang, renderFlagResolution } from "@/lib/email/flag-resolution";
import { REPORTER_OUTCOMES } from "@/lib/reports/report-status";

const base = { questionId: 4711, firstName: "Amira", reportedAtIso: "2026-10-01T09:00:00Z" } as const;

describe("TR-10 renderFlagResolution", () => {
  for (const lang of ["de", "en"] as const) {
    for (const outcome of REPORTER_OUTCOMES) {
      it(`${lang}/${outcome} renders with and without a note, no em dash`, () => {
        const withNote = renderFlagResolution({ ...base, lang, outcome, adminNote: "Neuer Schlüssel: B" });
        const without = renderFlagResolution({ ...base, lang, outcome, adminNote: null });
        for (const mail of [withNote, without]) {
          expect(`${mail.subject}${mail.htmlBody}${mail.textBody}`).not.toMatch(/[–—]/);
          expect(mail.subject).toContain("#4711");
          expect(mail.htmlBody).toContain("/quiz?questionId=4711");
          expect(mail.htmlBody).toContain("/settings#meine-meldungen");
        }
        expect(withNote.htmlBody).toContain("Neuer Schlüssel: B");
        expect(without.htmlBody).not.toContain(lang === "de" ? "Anmerkung aus unserem Team" : "Note from our team");
      });
    }
  }

  it("uses formal Sie in German", () => {
    for (const outcome of REPORTER_OUTCOMES) {
      const mail = renderFlagResolution({ ...base, lang: "de", outcome, adminNote: null });
      expect(mail.textBody).not.toMatch(/\b(du|dich|dir|dein|deine|deinen|deiner)\b/i);
      expect(mail.textBody).toMatch(/\bIhre?\b|\bSie\b/);
    }
  });

  it("escapes the admin note and the name", () => {
    const mail = renderFlagResolution({ ...base, lang: "en", outcome: "fixed", firstName: "<b>x</b>", adminNote: "<script>alert(1)</script>" });
    expect(mail.htmlBody).not.toContain("<script>");
    expect(mail.htmlBody).toContain("&lt;script&gt;");
    expect(mail.htmlBody).not.toContain("<b>x</b>");
  });

  it("names nobody but the recipient", () => {
    const mail = renderFlagResolution({ ...base, lang: "de", outcome: "not_an_error", adminNote: null, firstName: null });
    expect(mail.textBody.startsWith("Guten Tag,")).toBe(true);
  });

  it("maps the account language: none or German reads German, anything else English", () => {
    expect(flagResolutionLang(null)).toBe("de");
    expect(flagResolutionLang("de")).toBe("de");
    expect(flagResolutionLang("en")).toBe("en");
    expect(flagResolutionLang("ar")).toBe("en");
  });
});
