import { describe, expect, it } from "vitest";
import {
  buildTranslationSystem,
  buildTranslationUser,
  detectSourceLanguage,
  isUsableTranslation,
  looksUntranslated,
  translationSourceLabel,
} from "@/lib/explanation-translation";

// a-reeval-haiku55-1020: Haiku 5.5 returned the German source for Cyrillic targets.
const DE =
  "**Valsartan** ist ein Angiotensin-II-Rezeptorblocker: Er senkt die Aldosteronwirkung und damit die renale Kaliumausscheidung. Zusammen mit dem Aldosteronantagonisten steigt das Risiko einer Hyperkaliämie.";
const UK =
  "**Valsartan** є блокатором рецепторів ангіотензину II: він знижує дію альдостерону і, відповідно, ниркове виведення калію. Разом з антагоністом альдостерону зростає ризик гіперкаліємії.";
const EN =
  "**Valsartan** is an angiotensin II receptor blocker: it lowers the aldosterone effect and thereby renal potassium excretion. Together with the aldosterone antagonist the risk of hyperkalaemia rises.";
const AR = "فالسارتان هو حاصر لمستقبلات الأنجيوتنسين الثاني ويخفض تأثير الألدوستيرون وبالتالي إفراز البوتاسيوم الكلوي.";

describe("detectSourceLanguage", () => {
  it("names German, English and Arabic sources", () => {
    expect(detectSourceLanguage(DE)).toBe("de");
    expect(detectSourceLanguage(EN)).toBe("en");
    expect(detectSourceLanguage(AR)).toBe("ar");
  });
  it("cannot tell a Cyrillic or a tiny source", () => {
    expect(detectSourceLanguage(UK)).toBeNull();
    expect(detectSourceLanguage("Antwort A.")).toBeNull();
  });
});

describe("untranslated replies are not translations", () => {
  it("the German source returned for a Ukrainian or English target is rejected", () => {
    expect(isUsableTranslation(DE, DE, "uk")).toBe(false);
    expect(isUsableTranslation(`  ${DE.replace(/ /g, "  ")}\n`, DE, "en")).toBe(false);
    expect(looksUntranslated(DE.replace("Risiko", "risk"), DE, "ru")).toBe(true);
  });
  it("real translations that keep drug names pass", () => {
    expect(isUsableTranslation(UK, DE, "uk")).toBe(true);
    expect(isUsableTranslation(EN, DE, "en")).toBe(true);
  });
  it("a real translation that keeps many Latin terms passes (reviewer P2)", () => {
    const src = "Richtig: Musculus biceps brachii, Arteria brachialis und Nervus medianus verlaufen in der Fossa cubitalis.";
    expect(isUsableTranslation("Correct: Musculus biceps brachii, Arteria brachialis and Nervus medianus run in the Fossa cubitalis.", src, "en")).toBe(true);
    expect(isUsableTranslation("Exact : le Musculus biceps brachii, l'Arteria brachialis et le Nervus medianus passent dans la Fossa cubitalis.", src, "fr")).toBe(true);
    expect(isUsableTranslation("Doğru: Musculus biceps brachii, Arteria brachialis ve Nervus medianus Fossa cubitalis içinde seyreder.", src, "tr")).toBe(true);
    // Serbian and Turkish "da" never reads as German (reviewer P2, second pass).
    expect(isUsableTranslation("Tačno: Musculus biceps brachii, Arteria brachialis i Nervus medianus prolaze kroz Fossa cubitalis, pa je važno da se zna da su tu.", src, "sr")).toBe(true);
    expect(isUsableTranslation("Doğru: Musculus biceps brachii, Arteria brachialis ve Nervus medianus da Fossa cubitalis içinde seyreder; burada da görülür.", src, "tr")).toBe(true);
    // The same text returned in German is still caught.
    expect(isUsableTranslation(src, src, "en")).toBe(false);
  });

  it("a source already in the target, or an undetected source, never trips the check", () => {
    expect(isUsableTranslation(EN, EN, "en")).toBe(true);
    expect(isUsableTranslation(UK, UK, "uk")).toBe(true);
  });
  it("without the target language the old rule holds (UI and cache reads)", () => {
    expect(isUsableTranslation(DE, DE)).toBe(true);
  });
});

describe("translation prompt names the source and the target", () => {
  it("a detected German source is named and a German reply called a failure", () => {
    const label = translationSourceLabel(DE, "uk");
    expect(label).toBe("German");
    const p = buildTranslationSystem("Ukrainian", label);
    expect(p).toMatch(/from German into Ukrainian/);
    expect(p).toMatch(/A reply in German, even in part, is a failure/);
    expect(p).not.toMatch(/return it unchanged/);
  });
  it("a source already in the target gets no label and keeps the unchanged rule", () => {
    expect(translationSourceLabel(EN, "en")).toBeNull();
    expect(buildTranslationSystem("English", null)).toMatch(/Only if every sentence of the source is already written in English, return it unchanged/);
  });
  it("the user message closes with the target language", () => {
    expect(buildTranslationUser(DE, "Ukrainian").trim().endsWith("in Ukrainian only.")).toBe(true);
    expect(buildTranslationUser(DE)).toBe(`SOURCE TEXT:\n${DE}`);
  });
});
