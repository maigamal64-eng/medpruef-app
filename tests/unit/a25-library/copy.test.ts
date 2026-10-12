/**
 * a25 library copy catalogue: every key has DE and EN, German is in Sie (no
 * du/dein/dich), no em dashes, glossary nouns (UX-GLOBAL-05: Lernnotiz, never
 * Lernkarte, Flash-Notiz or Lesezeichen), American English spelling, and
 * the plural and failure helpers.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIBRARY_STRINGS,
  legacyNoteCount,
  listFailure,
  meterState,
  noteCount,
  remainingLine,
  sectionCount,
  tl,
} from "@/lib/i18n-library";
import { GLOSSARY } from "@/lib/master-locale/glossary";

const entries = Object.entries(LIBRARY_STRINGS);
const DU = /\b(du|dich|dir|dein|deine|deinen|deinem|deiner|deines|euch|euer|eure)\b/i;
const DU_VERBS = /\b(wähle|füge|lege|speichere|öffne|erstelle|passe|beantworte|melde|schreibe|tippe)\b/i;

describe("library copy catalogue", () => {
  it("has DE and EN for every key", () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const [key, v] of entries) {
      expect(v.de.trim(), key).not.toBe("");
      expect(v.en.trim(), key).not.toBe("");
    }
  });

  it("uses Sie in German, never du forms", () => {
    for (const [key, v] of entries) {
      expect(v.de, key).not.toMatch(DU);
      expect(v.de, key).not.toMatch(DU_VERBS);
    }
  });

  it("has no em or en dashes", () => {
    for (const [key, v] of entries) {
      expect(`${v.de} ${v.en}`, key).not.toMatch(/[—–]/);
    }
  });

  it("uses the glossary nouns and retires the old ones", () => {
    const de = entries.map(([, v]) => v.de).join("\n");
    const en = entries.map(([, v]) => v.en).join("\n");
    expect(de).toContain(GLOSSARY.study_note.de);
    expect(de).toContain(GLOSSARY.flashcards.de);
    for (const retired of [...GLOSSARY.flashcards.retired, ...GLOSSARY.saved_question.retired, "Flash-Notiz", "Karteikarte wiederholen"]) {
      expect(de).not.toContain(retired);
    }
    expect(en.toLowerCase()).not.toMatch(/flash-note|bookmark/);
    expect(de).not.toMatch(/Anmelden|melden Sie sich an|Pro freischalten/);
  });

  it("uses American English spelling", () => {
    const en = entries.map(([, v]) => v.en).join("\n");
    expect(en).not.toMatch(/practis|organis|emphasis(e|ing)|colour|favourite/);
  });

  it("renders English for unreviewed languages and fills variables", () => {
    expect(tl("meter", "ru", { used: 4, limit: 10 })).toBe("4 of 10 study notes");
    expect(tl("meter", "de", { used: 4, limit: 10 })).toBe("4 von 10 Lernnotizen");
    expect(tl("delete_body_free", "de", { limit: 10 })).toContain("insgesamt 10 Lernnotizen");
  });
});

describe("library helpers", () => {
  it("pluralizes sections, notes and legacy notes", () => {
    expect(sectionCount(1, "de")).toBe("1 Abschnitt");
    expect(sectionCount(3, "de")).toBe("3 Abschnitte");
    expect(sectionCount(1, "en")).toBe("1 section");
    expect(sectionCount(2, "ar")).toBe("2 sections");
    expect(noteCount(1, "de")).toBe("1 Lernnotiz");
    expect(noteCount(5, "en")).toBe("5 study notes");
    expect(legacyNoteCount(2, "de")).toBe("2 Notizen zur Frage");
  });

  it("warns quietly from 8 of 10 and says full at 10", () => {
    expect(meterState(4, 10)).toBe("calm");
    expect(meterState(7, 10)).toBe("calm");
    expect(meterState(8, 10)).toBe("warn");
    expect(meterState(10, 10)).toBe("full");
    expect(meterState(12, 10)).toBe("full");
    expect(remainingLine(1, "de")).toMatch(/^Noch 1 kostenlose Lernnotiz\./);
    expect(remainingLine(2, "en")).toMatch(/^2 free study notes left\./);
  });

  it("names what failed and why for list actions", () => {
    expect(listFailure("create", null, "de")).toEqual({
      title: "Liste konnte nicht erstellt werden.",
      body: "Keine Verbindung. Prüfen Sie Ihre Verbindung und versuchen Sie es noch einmal.",
    });
    expect(listFailure("rename", 404, "en").body).toBe("This list no longer exists.");
    expect(listFailure("delete", 403, "de").body).toBe("Diese Liste gehört nicht zu Ihrem Konto.");
    expect(listFailure("add", 402, "de").body).toContain("Pro");
    expect(listFailure("create", 500, "en").title).toBe("The list could not be created.");
  });
});

describe("library learner files", () => {
  const files = [
    "src/app/library/page.tsx",
    "src/app/library/_parts/NoteActions.tsx",
    "src/components/CollectionsPanel.tsx",
    "src/components/TurnIntoNoteButton.tsx",
  ];
  it("no longer use window.confirm, du-form strings or retired nouns", () => {
    for (const file of files) {
      const text = readFileSync(resolve(file), "utf8");
      expect(text, file).not.toMatch(/window\.confirm\(/);
      expect(text, file).not.toMatch(/"[^"\n]*\b(Deine|deine|Melde dich|Erstelle Listen|Lesezeichen)\b[^"\n]*"/);
      expect(text, file).not.toMatch(/Vollständige Notiz öffnen/);
    }
  });
});
