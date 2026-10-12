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

  // Round-1 grader audit: wordings taken from the live answers of the 2026-10-10 runs (act/r3/eval-live-haiku*.json).
  it.each([
    "Für diesen Termin liegt mir keine verifizierte Anmeldefrist für Ihre Einreichung in Graz vor.",
    "Für das Sommersemester 2027 liegt mir kein verifizierter Termin für Rezeptierkunde vor.",
    "Zur Abmeldung von der Rezeptierkunde liegt mir keine offiziell bestätigte Angabe vor.",
    "I can't find a verified price for a Mentor package with more messages.",
    "I have no verified fact about a Mentor package with more messages.",
    // Round-3 grader audit (fix-r3-live1 un-graz-de): noun before the participle.
    "Für den Stichprobentest im September 2027 ist kein Anmeldeschluss offiziell bestätigt.",
    "Für Graz ist keine Anmeldefrist veröffentlicht.",
    "Zur Anzahl der Fragen und zur Dauer der Gerichtsmedizin-Prüfung in Wien ist nichts offiziell bestätigt.",
  ])("labels the live wording: %s", (t) => expect(hasUnconfirmedMarker(t)).toBe(true));

  it.each([
    "Die Frist ist der 14. Dezember 2026.",
    "The exam is on 3 Feb 2027.",
    "Das läuft wie geplant.",
    "Die Anmeldefrist läuft bis 19. Oktober 2026.",
    "Es gibt keine Gebühr für die Abmeldung.",
    "I found the verified date on the calendar.",
    "There is no official reason to worry, the window is open until 19 Oct 2026.",
    "Der Termin ist offiziell bestätigt.",
    "Kein Problem, die Frist ist bestätigt: 19. Oktober 2026.",
  ])("does not label a confident answer: %s", (t) => expect(hasUnconfirmedMarker(t)).toBe(false));

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

  it("counts a direct request as asking (live wording), but not a statement or a request naming one university", () => {
    expect(asksFilingUniversity("Before I give a Stichprobentest deadline, please tell me where you filed your Nostrifizierung application: Wien, Graz or Innsbruck.")).toBe(true);
    expect(asksFilingUniversity("Bevor ich dir die Frist nenne, sag mir bitte, wo du deinen Nostrifizierungsantrag eingereicht hast: Wien, Graz oder Innsbruck.")).toBe(true);
    expect(asksFilingUniversity("Teilen Sie mir bitte mit, wo Sie eingereicht haben: Wien, Graz oder Innsbruck.")).toBe(true);
    expect(asksFilingUniversity("The deadlines differ for applications you filed in Wien, Graz or Innsbruck.")).toBe(false);
    expect(asksFilingUniversity("Tell me where you filed in Wien.")).toBe(false);
    expect(asksFilingUniversity("Let me explain what differs for applications filed in Wien, Graz or Innsbruck.")).toBe(false);
  });

  it("detects the flag flow, outcome promises, leaks, dashes, lists", () => {
    expect(mentionsFlagFlow("Bitte melde die Frage mit dem Flag-Button.")).toBe(true);
    expect(mentionsFlagFlow("Die Antwort ist A.")).toBe(false);
    expect(promisesOutcome("Damit bestehst du sicher.")).toBe(true);
    expect(promisesOutcome("Sie werden bestehen, wenn Sie so lernen.")).toBe(true);
    expect(promisesOutcome("Damit bestehen Sie sicher.")).toBe(true);
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
