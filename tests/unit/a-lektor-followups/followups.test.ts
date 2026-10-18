import { describe, expect, it } from "vitest";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";
import { publicRegistrationRows } from "@/lib/study-plan-public";
import { registrationRows, registrationLineVisible } from "@/lib/study-plan-view";
import { pc } from "@/lib/study-plan-public/copy";
import { publisherName } from "@/lib/answer-pages/copy";

// A sitting whose window opens in the future relative to the injected clock.
const sip = OFFICIAL_SITTINGS.find((s) => s.exam_key === "sip4a" && s.registration_opens && s.registration_closes && !s.window_unconfirmed)!;
const BEFORE_OPEN = new Date(`${sip.registration_opens}T00:00:00Z`);
BEFORE_OPEN.setUTCDate(BEFORE_OPEN.getUTCDate() - 20);
const todayISO = BEFORE_OPEN.toISOString().slice(0, 10);

describe("llms base claims", () => {
  it("no longer claims official sourcing or SIP 4 + SIP 5 as Kenntnisprüfung Wien", () => {
    expect(LLMS_TXT_BASE).not.toMatch(/documented official exam/);
    expect(LLMS_TXT_BASE).not.toMatch(/Kenntnisprüfung Wien\*\*: the Vienna knowledge exam/);
    expect(LLMS_TXT_BASE).toMatch(/SIP4a \/ SIP5a Wien/);
  });
});

describe("opening date of a window that has not opened", () => {
  it("public plan rows carry opensLater only before the opening day", () => {
    const before = publicRegistrationRows("kenntnispruefung", sip.date, BEFORE_OPEN);
    expect(before.some((r) => r.opensLater === sip.registration_opens)).toBe(true);
    const after = publicRegistrationRows("kenntnispruefung", sip.date, new Date(`${sip.registration_opens}T12:00:00Z`));
    expect(after.every((r) => r.opensLater === undefined)).toBe(true);
  });
  it("signed-in rows carry it and make the line visible even when far away", () => {
    const rows = registrationRows("kenntnispruefung", sip.date, todayISO, BEFORE_OPEN);
    expect(rows[0].opensLater).toBe(sip.registration_opens);
    expect(registrationLineVisible(rows)).toBe(true);
  });
  it("copy reads from and to, DE Sie-neutral and EN", () => {
    expect(pc("registration_window_future", "de", { kind: "Anmeldung", publisher: "MedUni Wien", from: "4. Jänner 2027", date: "18. Jänner 2027" })).toBe("Anmeldung (MedUni Wien): vom 4. Jänner 2027 bis 18. Jänner 2027");
    expect(pc("registration_window_future", "en", { kind: "Registration", publisher: "MedUni Vienna", from: "a", date: "b" })).toContain("from a to b");
  });
  it("English publisher names reuse PUBLISHER_EN", () => {
    expect(publisherName("MedUni Wien", "en")).toBe("MedUni Vienna");
    expect(publisherName("MedUni Wien", "de")).toBe("MedUni Wien");
  });
});
