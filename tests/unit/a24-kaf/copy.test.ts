import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { KAF_COPY, kafCopy, fill } from "@/lib/i18n-kaf";

const DASHES = /[–—]/;

describe("KAF copy", () => {
  it("has the same keys in de and en, no em or en dashes", () => {
    expect(Object.keys(KAF_COPY.de).sort()).toEqual(Object.keys(KAF_COPY.en).sort());
    for (const lang of ["de", "en"] as const) {
      for (const [key, value] of Object.entries(KAF_COPY[lang])) {
        expect(DASHES.test(value), `${lang}.${key}`).toBe(false);
        expect(value.trim(), `${lang}.${key}`).not.toBe("");
      }
    }
  });
  it("German is formal Sie, never du", () => {
    for (const [key, value] of Object.entries(KAF_COPY.de)) {
      expect(/\b(du|dich|dir|dein|deine|deinen|deiner)\b/i.test(value), key).toBe(false);
    }
  });
  it("states the practice clock, the scope and never claims original exam questions", () => {
    expect(KAF_COPY.de.clock).toBe("Übungszeit 240 Minuten, offizielle Dauer nicht bestätigt");
    expect(KAF_COPY.de.scopeNote).toBe("Die Musterantworten wurden von zwei medizinischen Prüfungen bestätigt. In der echten Prüfung bewerten Fachleute; hier bewerten Sie sich selbst.");
    expect(KAF_COPY.de.practiceLabel).toBe("Übung, selbst bewertet");
    expect(KAF_COPY.de.bankNote).toMatch(/keine Originalfragen/);
    const all = Object.values(KAF_COPY.de).join(" ") + Object.values(KAF_COPY.en).join(" ");
    expect(all).not.toMatch(/bestanden|nicht bestanden|\bpassed\b|\bfailed the exam\b/i);
  });
  it("falls back to English for unreviewed languages", () => {
    expect(kafCopy("ru")).toBe(KAF_COPY.en);
    expect(kafCopy("ar")).toBe(KAF_COPY.en);
    expect(fill("{a} von {n}", { a: 1, n: 2 })).toBe("1 von 2");
  });
  it("KAF UI files carry no dashes, getLang() or inline de ternaries", () => {
    const files = [
      ...readdirSync(resolve("src/components/exam-kaf")).map((f) => join("src/components/exam-kaf", f)),
      "src/app/exam/kaf/page.tsx",
    ];
    for (const file of files) {
      const text = readFileSync(resolve(file), "utf8");
      expect(/\bgetLang\s*\(/.test(text), file).toBe(false);
      expect(/\blang\s*===?\s*["']de["']\s*\?/.test(text), file).toBe(false);
      expect(DASHES.test(text), file).toBe(false);
    }
  });
});
