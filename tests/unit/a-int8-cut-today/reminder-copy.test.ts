import { describe, expect, it } from "vitest";
import { renderReminderConfirmation } from "@/lib/email/reminder-confirm-template";
import { resultPage } from "@/lib/reminders/link-page";
import { examReminderCopy } from "@/components/reminders/exam-reminder-copy";
import { CHANGELOG } from "@/lib/changelog";

// a-int8-cut-today: 878c25e4 (Lektor 17 Oct, decision reminder-copy-on-int8) on int-8, whose
// sender already uses optInDeadlineSchedule (at most two mails per deadline, first not before 2 Dec).
describe("reminder consent copy on int-8", () => {
  it("confirmation mail names the two-mail cadence", () => {
    for (const lang of ["de", "en"] as const) {
      const { htmlBody } = renderReminderConfirmation("exam", lang, "https://medpruf.com/x");
      expect(htmlBody).not.toMatch(/14, 7, 3/);
      expect(htmlBody).toMatch(lang === "de" ? /höchstens zweimal pro Frist.*nicht vor dem 2\. Dezember 2026/ : /at most twice per deadline.*not before 2 December 2026/);
    }
  });

  it("confirm page, opt-in lead and the staged changelog entry carry the same promise", async () => {
    expect(await resultPage("de", "exam", "confirmed").text()).toContain("Danke. Wir erinnern Sie vor jedem Anmeldeschluss höchstens zweimal, nicht vor dem 2. Dezember 2026.");
    expect(await resultPage("en", "exam", "confirmed").text()).toContain("Thank you. We will remind you at most twice before each registration deadline, and not before 2 December 2026.");
    expect(examReminderCopy("de").lead("SIP4a und SIP5a (Wien)")).toBe("Wir erinnern Sie per E-Mail an die offiziellen Anmeldefristen für SIP4a und SIP5a (Wien): höchstens zweimal pro Frist, nur solange die Anmeldung offen ist, und nicht vor dem 2. Dezember 2026.");
    expect(examReminderCopy("en").lead("SIP4a and SIP5a (Vienna)")).toBe("We email you about the official registration deadlines for SIP4a and SIP5a (Vienna): at most twice per deadline, only while registration is open, and not before 2 December 2026.");
    const entry = CHANGELOG.find((e) => e.title.de === "Anmeldefristen per E-Mail");
    expect(entry?.description.de).toContain("höchstens zweimal pro Frist, die erste Erinnerung nicht vor dem 2. Dezember 2026.");
    expect(entry?.description.en).toContain("at most twice per deadline, the first reminder not before 2 December 2026.");
    for (const text of [entry?.description.de, entry?.description.en]) expect(text).not.toMatch(/14, 7, 3/);
  });
});
