/** Grader reads RU/UK/TR/FR deadline dates and gap wording (a-mentor-gate, 12 Oct 2026). */
import { describe, it, expect } from "vitest";
import { extractDates, dateEquals } from "./lib/values";
import { hasUnconfirmedMarker } from "./lib/lang";
import { replayFromReport } from "./lib/scripted";

const iso = (t: string) => extractDates(t).map((d) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`);

describe("localized day-month dates", () => {
  it("reads the deadline templates of every answer language", () => {
    expect(iso("**Регистрация SIP4a (MedUni Vienna): до 19 октября 2026 г., осталось 7 дней (открыта).**")).toEqual(["2026-10-19"]);
    expect(iso("Дата іспиту: 18 листопада 2026 р.")).toEqual(["2026-11-18"]);
    expect(iso("до 3 лютого 2027 року")).toEqual(["2027-02-03"]);
    expect(iso("son tarih 14 Aralık 2026, 63 gün kaldı")).toEqual(["2026-12-14"]);
    expect(iso("Sınav 18 Kasım 2026'da yapılacak.")).toEqual(["2026-11-18"]);
    expect(iso("jusqu’au 19 octobre 2026")).toEqual(["2026-10-19"]);
    expect(iso("du 23 au 27 novembre 2026")).toEqual(["2026-11-23", "2026-11-27"]);
    expect(iso("le 1er février 2027")).toEqual(["2027-02-01"]);
  });

  it("a wrong localized date is now visible to the grader", () => {
    const [d] = extractDates("до 20 октября 2026 г.");
    expect(dateEquals(d, "2026-10-19")).toBe(false);
  });

  it("German and English stay as before", () => {
    expect(iso("bis 19. Oktober 2026")).toEqual(["2026-10-19"]);
    expect(iso("until October 19, 2026")).toEqual(["2026-10-19"]);
    expect(iso("Mai 2027")).toEqual([]);
  });
});

describe("gap wording", () => {
  it("accepts the French app notice and the Ukrainian copula form", () => {
    expect(hasUnconfirmedMarker("Cette information n’est pas officiellement confirmée.")).toBe(true);
    expect(hasUnconfirmedMarker("Je ne peux pas confirmer officiellement la date.")).toBe(true);
    expect(hasUnconfirmedMarker("Підтвердженого терміну немає: він не є офіційно підтвердженим.")).toBe(true);
    expect(hasUnconfirmedMarker("La date est le 19 octobre 2026.")).toBe(false);
  });
});

describe("replay", () => {
  it("takes each case's last recorded final text", () => {
    const m = replayFromReport({ cases: [{ id: "a", callTrace: [{}, { rawText: "@@LANG de\n@@BLOCK\nx" }] }, { id: "b", callTrace: [{}] }] });
    expect([...m.entries()]).toEqual([["a", "@@LANG de\n@@BLOCK\nx"]]);
  });
});
