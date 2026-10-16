import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRAM_DE, CRAM_EN, CRAM_KEYS, tc, type CramKey } from "@/lib/i18n-cram";

const KITS = "./reports/backlog-out";
const read = (p: string) => { try { return JSON.parse(readFileSync(`${KITS}/${p}`, "utf8")); } catch { return null; } };
const sip = read("a-cramstart-copy/home-cram-card.json");
const rez = read("a-rezgm-cram-kit/cram-card-copy.json");
const rezVerdict = read("a-rezgm-cram-kit/lektor-verdict.json");
const kitsPresent = Boolean(sip && rez && rezVerdict);

/** Kit key -> dictionary key. */
const SIP_MAP: Record<string, CramKey> = {
  cram_m4_title: "m4_title", cram_m4_body: "m4_body", cram_m4_title_bank: "m4_title_bank", cram_m4_body_bank: "m4_body_bank",
  cram_m4_how: "m4_how", cram_m4_format: "m4_format", cram_m4_cta_primary: "m4_cta_primary", cram_m4_plan: "m4_plan",
  cram_m4_plan_cta: "m4_plan_cta", cram_m4_credits: "m4_credits",
};
const REZ_MAP: Record<string, CramKey> = {
  cram_rezgm_a_title: "rezgm_a_title", cram_rezgm_a_body: "rezgm_a_body", cram_rezgm_a_how: "rezgm_a_how",
  cram_rezgm_a_countdown: "rezgm_a_countdown", cram_rezgm_b_title: "rezgm_b_title", cram_rezgm_b_body: "rezgm_b_body",
  cram_rezgm_b_gmnote: "rezgm_b_gmnote", cram_rezgm_dismiss: "rezgm_dismiss", cram_rezgm_official: "rezgm_official",
};
/**
 * Lines the Lektor re-gated after the kit (15 Oct, a-cram-card): the kit's state B body promises the 7-day plan
 * page, which is not built, so the card carries Lektor's softer replacement until that page ships.
 */
const LEKTOR_OVERRIDES: Record<string, { de: string; en: string }> = {
  cram_rezgm_b_body: {
    de: "Falls Sie für die Prüfungswoche der MedUni Wien angemeldet sind ({weekRange}): Üben Sie Rezeptierkunde und Gerichtsmedizin in eigenen Übungsblöcken.",
    en: "If you are registered for the MedUni Wien exam week ({weekRange}): practise Rezeptierkunde and Gerichtsmedizin in separate practice blocks.",
  },
};

describe.skipIf(!kitsPresent)("strings equal the Lektor-gated kits", () => {
  it("SIP lines (incl. one-day forms)", () => {
    for (const line of sip.lines as Array<Record<string, string>>) {
      const k = SIP_MAP[line.key];
      if (!k) continue;
      expect(CRAM_DE[k], line.key).toBe(line.de);
      expect(CRAM_EN[k], line.key).toBe(line.en);
      if (line.de_one) {
        expect(CRAM_DE[`${k}_one` as CramKey], `${line.key} one`).toBe(line.de_one);
        expect(CRAM_EN[`${k}_one` as CramKey]).toBe(line.en_one);
      }
    }
  });
  it("Rez/GM lines with Lektor APPROVE or EDIT and ready:true (incl. one-day countdown)", () => {
    for (const line of rez.lines as Array<Record<string, string | boolean>>) {
      const k = REZ_MAP[line.key as string];
      if (!k) continue;
      expect(line.ready, line.key as string).toBe(true);
      expect(["APPROVE", "EDIT"]).toContain(line.lektor);
      const o = LEKTOR_OVERRIDES[line.key as string];
      expect(CRAM_DE[k], line.key as string).toBe(o ? o.de : line.de);
      expect(CRAM_EN[k], line.key as string).toBe(o ? o.en : line.en);
      if (line.de_one) expect(CRAM_DE[`${k}_one` as CramKey]).toBe(line.de_one);
    }
  });
  it("no held (HOLD_VISITE / ready:false) or medical line is in the dictionary", () => {
    const held = (rez.lines as Array<Record<string, unknown>>).filter((l) => l.ready === false || l.medical === true || l.lektor === "HOLD_VISITE");
    expect(held.length).toBeGreaterThan(0);
    const all = [...Object.values(CRAM_DE), ...Object.values(CRAM_EN)];
    for (const l of held) {
      for (const v of [l.de, l.en]) if (typeof v === "string") expect(all).not.toContain(v);
    }
    expect(CRAM_KEYS.some((k) => k.startsWith("plan_"))).toBe(false);
  });
});

describe("house rules on every string", () => {
  const strings = [...Object.entries(CRAM_DE), ...Object.entries(CRAM_EN)];
  it("no dash characters, no exclamation marks", () => {
    for (const [k, v] of strings) {
      expect(v, k).not.toMatch(/[–—]/);
      expect(v, k).not.toContain("!");
    }
  });
  it("no typed date, month name or price", () => {
    for (const [k, v] of strings) {
      expect(v, k).not.toMatch(/\b\d{1,2}\.\s?\d{1,2}\.|\b20\d\d\b|€|EUR|Euro/);
      expect(v, k).not.toMatch(/\b(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|January|February|March|June|July|October|December)\b/);
    }
  });
  it("German uses Sie, never du", () => {
    for (const [k, v] of Object.entries(CRAM_DE)) expect(v, k).not.toMatch(/\b(du|dein|deine|dir|dich)\b/i);
  });
  it("every placeholder is one the card fills", () => {
    const allowed = new Set(["sittingLabel", "sittingDate", "daysLeft", "weekRange", "balance", "expiryDate"]);
    for (const [k, v] of strings) for (const m of v.matchAll(/\{(\w+)\}/g)) expect(allowed.has(m[1]), `${k} ${m[1]}`).toBe(true);
  });
  it("fills variables and falls back to English for other languages, Arabic included", () => {
    expect(tc("m4_title", "de", { daysLeft: 5, sittingLabel: "X" })).toBe("Noch 5 Tage bis X");
    expect(tc("m4_title", "ru", { daysLeft: 5, sittingLabel: "X" })).toBe("5 days to X");
    expect(tc("rezgm_dismiss", "ar")).toBe("Hide");
  });
});
