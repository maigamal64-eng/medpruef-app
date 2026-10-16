import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { JOURNEY_COPY, jt } from "@/lib/journey/copy";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Per-line sha256 of the F16 lines (copy-audit F16 block shas de 56fddff3..., en 9b23412b...). */
const F16 = {
  de: {
    registered_button: "d9dfb7ee78e9e6bed9ffad136fef5107caeaf3f43fc811c89f74a59148c2b5c5",
    registered_confirmation: "07ef64d42a1a76a946b1b9c9341744c3b0f8397f6b7bab3cc7b1b5a2f59ad487",
    exam_day: "f5178b2aa7c7f0868188a159e1a4ccb6d6a5d24e94aee29d0416c030788808c8",
    results_handoff: "a49022ce07dae131dfc4be5e24791f63ff455160eb17809676957dc5d207021d",
  },
  en: {
    registered_button: "366779dc58fdeb2f637a1092886180d76a60add03272aa6cc81934564a842e40",
    registered_confirmation: "e1b2b60dbd2c75ad794da066038d2b732d531bc940eea8a0e9f5ab45cb7444c3",
    exam_day: "d4cbfe39ecacdfc4f5e1364b8d4f3e39c7ec667650d4e178538250e65265aae9",
    results_handoff: "1fb1984bd015e7f80d0fe6006ce137d9c92b37686322573bb4bc4d9305ab45ac",
  },
} as const;

/** Lektor gate 15 Oct (a-journey-engine): sha256 of every new line, DE then EN. */
const LEKTOR: Record<string, [string, string]> = {
  region: ["27ddb5ec3eb381ca69e3b6bdd1e48f7012757a11f3e484b37b40b1cc07e40549", "efd0f4ed7286671ddb3591da6365621549ad6cee67d021604045f5435d1db9b1"],
  registered_saving: ["fd18cde89026f3419f87eeb555d0f84d776e12a4f9c40c250ce012ae3a3b694d", "096b73624b092bdc6c7377ec5e6e989e2ce826b9f294de8368fb8f3ec1341f30"],
  registered_failed: ["5a8d00d8c524f1c95cad88076e76e04f6c8586cbce7677886cd152cf946d079b", "4ebb2e696b305491a7425c4bac926974dc900ec0426bd9721d6d0cb78b8b13e2"],
  cram_mock: ["aefecd6af12698151e7445647bbec1f4b2f2e099cd151307e524640db489d4e1", "fa761d1d3429effef47c28f57c0df126b9a05d7c55631db6d3a59c979c96b1a4"],
  cram_kaf: ["719397e5dcc9b53a3e478f32f48702f6b21b72c4e585e5ad790ea51caaff974b", "8c482eebbcc729d00f152978eec79a52c34790dc202738c663acb98ffb662e00"],
  ask_body: ["8fff43587bffc931312ac9ceb9722546441967fc281317c9c0ee0341bcc85c1a", "efadc0c2bc41f2602fbfe69bf20907febfc0ceac6b37b1969b008139c6a45b73"],
  ask_button: ["a0deadeef6e46675fbb15b0d83e85d1e8adc55e2e47ed92ba371eb16858c9421", "58cb96d1b3495519dce70ed4898958c68e1ca4d89da9b460ff1c6166b8bb3cd2"],
};

describe("journey copy", () => {
  it("every new line is the Lektor-approved text", () => {
    for (const [key, [de, en]] of Object.entries(LEKTOR)) {
      expect(sha(JOURNEY_COPY.de[key as keyof (typeof JOURNEY_COPY)["de"]]), `de ${key}`).toBe(de);
      expect(sha(JOURNEY_COPY.en[key as keyof (typeof JOURNEY_COPY)["en"]]), `en ${key}`).toBe(en);
    }
  });

  it("F16 lines are byte-exact", () => {
    for (const lang of ["de", "en"] as const) {
      for (const [key, hash] of Object.entries(F16[lang])) {
        expect(sha(JOURNEY_COPY[lang][key as keyof (typeof JOURNEY_COPY)["de"]]), `${lang} ${key}`).toBe(hash);
      }
    }
  });

  it("the M4 line is the journey section 7 pillar", () => {
    expect(JOURNEY_COPY.de.cram_body).toBe("Noch vier Wochen. Jetzt zählt das Üben unter Prüfungsbedingungen: mit Zeitlimit und mit Erklärungen in Ihrer Sprache.");
    expect(JOURNEY_COPY.en.cram_body).toBe("Four weeks to go. Now practise under exam conditions: timed, with explanations in your language.");
  });

  it("no dashes, exclamation marks, prices, digits or dates; Sie, never du", () => {
    for (const lang of ["de", "en"] as const) {
      for (const [key, text] of Object.entries(JOURNEY_COPY[lang])) {
        expect(text, key).not.toMatch(/[–—!€]|\bEUR\b|\d/);
      }
    }
    for (const text of Object.values(JOURNEY_COPY.de)) expect(text).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
  });

  it("every other language renders English", () => {
    for (const lang of ["ar", "ru", "uk", "tr", "fr"]) expect(jt("exam_day", lang)).toBe(JOURNEY_COPY.en.exam_day);
    expect(jt("exam_day", "de")).toBe(JOURNEY_COPY.de.exam_day);
  });
});
