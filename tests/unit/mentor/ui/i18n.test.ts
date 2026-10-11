import { describe, it, expect } from "vitest";
import { MENTOR_DICTS, MENTOR_KEYS, MENTOR_NATIVE_REVIEW_PENDING_KEYS, MENTOR_EN_FALLBACK_KEYS, hasOwnMentorString, mentorT, type MentorEntry, type MentorUiLang } from "@/lib/i18n-mentor";

const LANGS: MentorUiLang[] = ["de", "en", "ru", "uk", "tr", "ar"];
const FULL: MentorUiLang[] = ["de", "en", "ru", "uk", "tr"];

function texts(e: MentorEntry): string[] {
  return typeof e === "string" ? [e] : Object.values(e).filter((x): x is string => typeof x === "string");
}
function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("mentor dictionary", () => {
  it("de and en cover every key; untranslated product copy and pending patient wording use English", () => {
    for (const l of FULL) {
      const fallbackKeys = [...MENTOR_EN_FALLBACK_KEYS, ...MENTOR_NATIVE_REVIEW_PENDING_KEYS];
      const missing = MENTOR_KEYS.filter((k) => !hasOwnMentorString(k, l) && (["de", "en"].includes(l) || !fallbackKeys.includes(k)));
      expect(missing, `${l} missing`).toEqual([]);
    }
  });

  it("RU, UK and TR own recurring and one-time purchase labels and the Whop return note", () => {
    for (const l of ["ru", "uk", "tr"] as const) {
      for (const k of ["pkg_buy_subscription", "pkg_buy_once", "pkg_pay_note"] as const) {
        expect(hasOwnMentorString(k, l), `${l}.${k}`).toBe(true);
        expect(mentorT(k, l, { price: "server price", n: 30 })).not.toBe(mentorT(k, "en", { price: "server price", n: 30 }));
      }
    }
  });

  it("the patient safety line alone is held for native review and remains the fixed English fallback", () => {
    expect(MENTOR_NATIVE_REVIEW_PENDING_KEYS).toEqual(["refusal_patient_advice"]);
    for (const l of ["ru", "uk", "tr"] as const) {
      expect(hasOwnMentorString("refusal_patient_advice", l)).toBe(false);
      expect(mentorT("refusal_patient_advice", l)).toBe(mentorT("refusal_patient_advice", "en"));
    }
  });

  it("Arabic ships empty and falls back to English ([name] signs the wording first)", () => {
    expect(Object.keys(MENTOR_DICTS.ar)).toHaveLength(0);
    expect(mentorT("page_title", "ar")).toBe(mentorT("page_title", "en"));
    expect(mentorT("disclaimer", "ar")).toBe(mentorT("disclaimer", "en"));
  });

  it("no string contains an em dash", () => {
    for (const l of LANGS) for (const [k, e] of Object.entries(MENTOR_DICTS[l])) for (const t of texts(e as MentorEntry)) expect(t, `${l}.${k}`).not.toContain(String.fromCharCode(0x2014));
  });

  it("no string mentions dollars or micro-units, and none carries a year, a month-day date or a euro amount", () => {
    for (const l of LANGS) {
      for (const [k, e] of Object.entries(MENTOR_DICTS[l])) {
        for (const t of texts(e as MentorEntry)) {
          expect(t, `${l}.${k}`).not.toMatch(/\$|USD|dollar|micro|доллар|долар|dolar/i);
          expect(t, `${l}.${k}`).not.toMatch(/\b20\d\d\b/);
          expect(t, `${l}.${k}`).not.toMatch(/€|EUR|\bEuro\b/);
        }
      }
    }
  });

  it("every language uses the same placeholders as German for each key", () => {
    for (const l of FULL) {
      for (const k of MENTOR_KEYS) {
        const de = new Set(texts(MENTOR_DICTS.de[k]!).flatMap(placeholders));
        for (const t of texts(MENTOR_DICTS[l][k] ?? MENTOR_DICTS.en[k]!)) {
          expect(new Set(placeholders(t)), `${l}.${k}`).toEqual(de);
        }
      }
    }
  });

  it("plural entries have an other form; ru and uk define few and many", () => {
    for (const l of FULL) {
      for (const k of MENTOR_KEYS) {
        const e = MENTOR_DICTS[l][k] ?? MENTOR_DICTS.en[k]!;
        if (typeof e !== "string") expect(e.other, `${l}.${k}`).toBeTruthy();
      }
    }
    for (const l of ["ru", "uk"] as const) {
      const e = MENTOR_DICTS[l].credits_count as { few?: string; many?: string };
      expect(e.few && e.many).toBeTruthy();
    }
  });

  it("falls back to the key itself only when no language has it", () => {
    expect(mentorT("nope" as never, "de")).toBe("nope");
  });

  it("fills placeholders", () => {
    expect(mentorT("composer_counter", "de", { n: 3, max: 1500 })).toBe("3 / 1500");
    expect(mentorT("expiry_note", "en", { date: "x" })).toContain("x");
  });
});
