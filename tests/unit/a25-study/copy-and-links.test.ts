import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { STUDY_STRINGS, ts } from "@/lib/i18n-study";
import { studyReturn, buildQuizHref } from "@/lib/quiz-links";

const DU = /\b(du|dein|deine|deinen|deinem|deiner|dich|dir)\b/i;
const BANNED = /(Prognose|garantiert|bestehen sicher|Erfolgsquote|pass rate|guarantee)/i;

describe("a25 study copy (UX-STU-63)", () => {
  it("every key has German and English, no em dash, Sie only, no prediction words", () => {
    for (const [key, v] of Object.entries(STUDY_STRINGS)) {
      expect(v.de, key).toBeTruthy();
      expect(v.en, key).toBeTruthy();
      expect(v.de + v.en, key).not.toMatch(/—/);
      expect(v.de, key).not.toMatch(DU);
      // "Das ist keine Vorhersage" is the required disclaimer, not a prediction.
      expect((v.de + " " + v.en).replace(/keine Vorhersage|not a prediction|keine Prognose|not a forecast/gi, ""), key).not.toMatch(BANNED);
    }
  });
  it("American English, no 'Tight window' or '20 q' shorthand", () => {
    const en = Object.values(STUDY_STRINGS).map((v) => v.en).join(" ");
    expect(en).not.toMatch(/practise|Tight window|Plan capped|\b20 q\b/);
  });
  it("unreviewed languages render English, never a raw key", () => {
    expect(ts("plan_title", "ar")).toBe("Study plan");
    expect(ts("hero_days", "de", { n: 34 })).toBe("Noch 34 Tage bis zur Prüfung");
  });
  it("the mock-exam trend always carries the not-a-prediction line", () => {
    expect(ts("sims_not_prediction", "de")).toBe("Das ist keine Vorhersage Ihres Ergebnisses.");
  });
});

describe("UX-STU-06 / STU-20 links", () => {
  it("quiz links never carry an account id", () => {
    const href = buildQuizHref({ topic: "Neurologie", examSource: "kenntnispruefung", practiceMode: "unseen", limit: 7, returnTo: "/study-plan?userId=abc#heute" });
    expect(href).not.toMatch(/userId/);
    expect(new URL(href, "https://x.test").searchParams.get("returnTo")).toBe("/study-plan#heute");
  });
  it("study pages emit no userId in hrefs", () => {
    for (const f of ["src/app/study-plan/page.tsx", "src/app/progress/page.tsx", "src/app/curriculum/page.tsx", "src/app/stats/page.tsx", "src/app/library/page.tsx", "src/app/page.tsx"]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/[?&]userId=/);
    }
  });
  it("returnTo is limited to same-origin study routes", () => {
    expect(studyReturn("/study-plan#heute")).toEqual({ href: "/study-plan#heute", key: "plan" });
    expect(studyReturn("/progress")?.key).toBe("progress");
    expect(studyReturn("https://evil.example/study-plan")).toBeNull();
    expect(studyReturn("//evil.example")).toBeNull();
    expect(studyReturn("/pricing")).toBeNull();
    expect(studyReturn(null)).toBeNull();
  });
});
