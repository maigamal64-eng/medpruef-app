import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PharmakologiePage, { dynamic } from "@/app/pharmakologie-pruefung-wien/page";
import type { ExamLandingContent } from "@/components/seo/ExamLandingShell";

vi.mock("@/components/seo/ExamLandingShell", () => ({ default: () => null }));

function dateTile() {
  const page = PharmakologiePage();
  return (page.props.content as ExamLandingContent).breakdown[1];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", { createElement });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Pharmakologie exam date tile", () => {
  it("computes dates on each request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("shows November and its registration window before the Vienna noon cutoff", () => {
    vi.setSystemTime(new Date("2026-10-20T11:59:59+02:00")); // date-ok: cutoff test fixture
    expect(dateTile()).toMatchObject({
      value: {
        de: "Woche 23. November bis 27. November 2026", // date-ok: official exam week test fixture
        en: "Week of 23 November to 27 November 2026", // date-ok: official exam week test fixture
      },
      sub: {
        de: "Anmeldung 7. Oktober bis 20. Oktober 2026, 12:00 Uhr (Wien)", // date-ok: official registration window test fixture
        en: "Registration 7 October to 20 October 2026, 12:00 Vienna time", // date-ok: official registration window test fixture
      },
    });
  });

  it.each([
    "2026-10-20T12:00:00+02:00", // date-ok: cutoff test fixture
    "2026-10-20T12:00:01+02:00", // date-ok: cutoff test fixture
  ])("switches to January at and after the Vienna noon cutoff (%s)", (now) => {
    vi.setSystemTime(new Date(now));
    expect(dateTile()).toMatchObject({
      value: {
        de: "Woche 18. Jänner bis 22. Jänner 2027", // date-ok: official MedUni Wien exam week test fixture, not the OeAEK sitting
        en: "Week of 18 January to 22 January 2027", // date-ok: official MedUni Wien exam week test fixture, not the OeAEK sitting
      },
      sub: {
        de: "Anmeldung 2. Dezember bis 15. Dezember 2026, 12:00 Uhr (Wien)", // date-ok: official registration window test fixture
        en: "Registration 2 December to 15 December 2026, 12:00 Vienna time", // date-ok: official registration window test fixture
      },
    });
  });

  it("does not reuse an expired tile after the final published registration window", () => {
    vi.setSystemTime(new Date("2026-12-15T12:00:00+01:00")); // date-ok: cutoff test fixture
    expect(dateTile()).toMatchObject({
      value: {
        de: "Noch kein offizieller Termin veröffentlicht",
        en: "No official date published yet",
      },
      sub: { de: "", en: "" },
    });
  });
});
