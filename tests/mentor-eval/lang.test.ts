import { describe, expect, it } from "vitest";
import {
  asksFilingUniversity, countEmDashes, detectLang, hasHeadingOrTable, hasNumberedList, hasUnconfirmedMarker, languageMatches, leakedMarkers, mentionsFlagFlow, promisesOutcome, wordCount,
} from "./lib/lang";

describe("language", () => {
  it("tells German from English and stays unknown on short text", () => {
    expect(detectLang("Die Anmeldung ist nur mit dem Formular möglich und nicht später.")).toBe("de");
    expect(detectLang("You can register only with the form and not later than the deadline.")).toBe("en");
    expect(detectLang("SIP4a 18 Nov")).toBe("unknown");
    expect(languageMatches("Die Anmeldung ist nur mit dem Formular möglich und nicht später.", "en")).toBe(false);
    expect(languageMatches("SIP4a 18 Nov", "en")).toBe(true);
  });
});

describe("unconfirmed marker", () => {
  it.each([
    "Das ist nicht offiziell bestätigt.",
    "Das ist nicht eindeutig bestätigt, die Quellen widersprechen sich.",
    "Die Frist ist noch nicht veröffentlicht.",
    "Das kann ich nicht bestätigen.",
    "That is not officially confirmed.",
    "This has not been published yet.",
    "I can't confirm that.",
    "The two documents are conflicting.",
    "Es gibt keine offizielle Angabe dazu.",
  ])("labels: %s", (t) => expect(hasUnconfirmedMarker(t)).toBe(true));

  it.each(["Die Frist ist der 14. Dezember 2026.", "The exam is on 3 Feb 2027.", "Das läuft wie geplant."])("does not label: %s", (t) =>
    expect(hasUnconfirmedMarker(t)).toBe(false),
  );
});

describe("other text checks", () => {
  it("asks for the filing university only when two universities are named in a question", () => {
    expect(asksFilingUniversity("Wo hast du deine Nostrifizierung eingereicht: Wien, Graz oder Innsbruck?")).toBe(true);
    expect(asksFilingUniversity("Where did you file your application: Wien or Graz?")).toBe(true);
    expect(asksFilingUniversity("Die Frist ist 14. Dezember 2026 in Wien.")).toBe(false);
    expect(asksFilingUniversity("Wo hast du eingereicht?")).toBe(false);
  });

  it("detects the flag flow, outcome promises, leaks, dashes, lists", () => {
    expect(mentionsFlagFlow("Bitte melde die Frage mit dem Flag-Button.")).toBe(true);
    expect(mentionsFlagFlow("Die Antwort ist A.")).toBe(false);
    expect(promisesOutcome("Damit bestehst du sicher.")).toBe(true);
    expect(promisesOutcome("Das erhöht deine Chancen nicht garantiert.")).toBe(true);
    expect(promisesOutcome("Lerne zuerst Neurologie.")).toBe(false);
    expect(leakedMarkers("ok @@BLOCK und FACT SHEET")).toEqual(["@@BLOCK", "FACT SHEET"]);
    expect(leakedMarkers("normal answer")).toEqual([]);
    expect(countEmDashes("a — b, c - d")).toBe(1);
    expect(hasNumberedList("1. erst\n2. dann")).toBe(true);
    expect(hasNumberedList("- erst\n- dann")).toBe(false);
    expect(hasHeadingOrTable("## Titel")).toBe(true);
    expect(hasHeadingOrTable("| a | b |")).toBe(true);
    expect(wordCount("eins zwei  drei")).toBe(3);
  });
});
