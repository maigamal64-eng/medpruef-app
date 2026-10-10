/**
 * Round-2 grader audit (mentor loop): every widened allow-list is proven twice.
 * The real answer text from a saved live run passes (the extra value is a verified
 * fact the case did not allow), and the same case still FAILS when the answer is wrong:
 * a swapped deadline, a fee or a percentage that no fact prints, a forbidden date.
 * Texts are shortened copies of the saved live answers (act/mentor-loop/run1-r1-evidence).
 */
import { describe, expect, it } from "vitest";
import { scoreCase } from "./lib/score";
import { golden, mkCtx, mkOutcome } from "./helpers";

function grade(id: string, text: string, ids: string[]) {
  const c = golden.cases.find((x) => x.id === id);
  if (!c) throw new Error(`no golden case ${id}`);
  return scoreCase(c, mkOutcome({ blocks: [{ text, fact_ids: ids }] }), mkCtx());
}

describe("widened: the other 2027 Stichprobentest sittings (stichprobentest.dates.2027-sittings)", () => {
  const SITTINGS = "The 2027 sittings are 3 February at Innsbruck, 4 May at Vienna and 22 September at Graz";

  it("dl-stp-may: lists the real sittings next to the right deadline", () => {
    const text = `Your filing deadline for the Stichprobentest on 4 May 2027 is 17 March 2027 (Stand 2026-10-10). ${SITTINGS}.`;
    const s = grade("dl-stp-may-en", text, ["stichprobentest.dates.2027-05-04.both", "stichprobentest.dates.2027-sittings"]);
    expect(s.critical).toEqual([]);
    expect(s.pass).toBe(true);
  });

  it("dl-stp-may: a swapped deadline still fails (the other universities' cutoffs are not allowed)", () => {
    const wrongDeadline = grade("dl-stp-may-en", `Your deadline is 14 December 2026. ${SITTINGS}.`, ["stichprobentest.dates.2027-sittings"]);
    expect(wrongDeadline.critical).toContain("wrong_date:14 December 2026");
    expect(wrongDeadline.failures).toContain("missing_date:2027-03-17");
    const sittingAsDeadline = grade("dl-stp-may-en", `Your deadline is 3 February 2027.`, ["stichprobentest.dates.2027-sittings"]);
    expect(sittingAsDeadline.failures).toContain("missing_date:2027-03-17");
    expect(sittingAsDeadline.pass).toBe(false);
  });

  it("dl-stp-wien-feb: sittings pass, Innsbruck's cutoff stays forbidden", () => {
    const ok = grade("dl-stp-wien-feb-en", `For the sitting on 3 February 2027 the filing cutoff for a Vienna application is 14 December 2026. ${SITTINGS}.`, ["sitting.stichprobentest.2027-02-03.wien.filing", "stichprobentest.dates.2027-sittings"]);
    expect(ok.critical).toEqual([]);
    expect(ok.pass).toBe(true);
    const inns = grade("dl-stp-wien-feb-en", `The cutoff is 14 December 2026, in Innsbruck 7 January 2027. ${SITTINGS}.`, ["sitting.stichprobentest.2027-02-03.wien.filing"]);
    expect(inns.critical).toContain("forbidden_date:7 January 2027");
  });

  it("dl-stp-wien-sep: sittings pass, Innsbruck's cutoff stays forbidden", () => {
    const ok = grade("dl-stp-wien-sep-de", "Die Einreichungsfrist für den Stichprobentest in Graz am 22. September 2027 ist der 30. Juni 2027. Die Tests 2027 finden am 3. Februar in Innsbruck, am 4. Mai in Wien und am 22. September in Graz statt.", ["stichprobentest.dates.2027-09-22.wien-merkblatt", "stichprobentest.dates.2027-sittings"]);
    expect(ok.critical).toEqual([]);
    expect(ok.pass).toBe(true);
    const bad = grade("dl-stp-wien-sep-de", "Die Frist ist der 25. August 2027.", ["stichprobentest.dates.2027-09-22.wien-merkblatt"]);
    expect(bad.critical).toContain("forbidden_date:25. August 2027");
    expect(bad.failures).toContain("missing_date:2027-06-30");
  });
});

describe("widened: 150 EUR on the procedure steps (general.fee.application-taxe)", () => {
  const STEPS = "Zuerst wird der Nostrifizierungsantrag eingereicht. Danach folgt das Ermittlungsverfahren. Zum Schluss ergeht der Nostrifizierungsbescheid.";
  it("a steps answer may name the real 150 EUR fee", () => {
    const s = grade("pr-steps-de", `${STEPS} Die Nostrifizierungstaxe von 150 Euro ist im Voraus zu bezahlen.`, ["general.glossary.procedure-steps", "general.fee.application-taxe"]);
    expect(s.critical).toEqual([]);
    expect(s.pass).toBe(true);
  });
  it("any other amount is still a critical wrong fee", () => {
    const s = grade("pr-steps-en", "The procedure has an application with a fee of 160 euros, then the Ermittlungsverfahren, then the Bescheid.", ["general.glossary.procedure-steps"]);
    expect(s.critical).toContain("wrong_fee:160");
  });
  it("the case still demands the steps: no Ermittlungsverfahren and no expected citation still fails", () => {
    const s = grade("pr-steps-en", "The fee is 150 euros and then the Bescheid follows.", ["general.fee.application-taxe"]);
    expect(s.failures).toEqual(expect.arrayContaining(["missing_term_any:Ermittlungsverfahren", "missing_expected_citation"]));
    expect(s.pass).toBe(false);
  });
});

describe("widened: the 60 percent field rule (stichprobentest.pass_rule.field-sixty)", () => {
  it("structure, repeat and not-confirmed duration answers may state the real 60 percent rule", () => {
    const structure = grade("pr-spt-structure-de", "Der Stichprobentest umfasst 250 Fragen. Ein Fachbereich gilt als positiv, wenn mindestens 60 Prozent richtig sind.", ["stichprobentest.format.structure"]);
    expect(structure.pass).toBe(true);
    const once = grade("pr-spt-once-en", "No, you can take it only once (not possible to repeat). A field counts as passed at 60 percent.", ["stichprobentest.attempts.single"]);
    expect(once.pass).toBe(true);
    const duration = grade("un-stp-duration-de", "Die Dauer ist nicht offiziell bestätigt. Ein Fachbereich gilt bei mindestens 60 Prozent als bestanden.", ["stichprobentest.format.structure"]);
    expect(duration.failures).not.toContain("unexpected_percent:60");
  });
  it("an invented percentage is still rejected, and the 250 questions are still required", () => {
    expect(grade("pr-spt-structure-de", "Der Test hat 250 Fragen, bestanden bei 75 Prozent.", ["stichprobentest.format.structure"]).failures).toContain("unexpected_percent:75");
    expect(grade("pr-spt-structure-en", "A field is passed at 60 percent.", ["stichprobentest.format.structure"]).failures).toContain("missing_number:250");
    expect(grade("pr-spt-once-de", "Nein, nur einmal. Bestanden bei 90 Prozent.", ["stichprobentest.attempts.single"]).failures).toContain("unexpected_percent:90");
  });
});

describe("widened: the following Gerichtsmedizin sitting and the November SIP4a anchor", () => {
  it("dl-gm-next: the real following sitting is allowed, but the next one is still required", () => {
    const text = "The next Gerichtsmedizin exam at MedUni Wien is the exam week 23 to 27 November 2026. Registration closes on 20 October 2026. The following sitting is 18 to 22 January 2027, with registration from 2 December to 15 December 2026.";
    const s = grade("dl-gm-next-en", text, ["sitting.gerichtsmedizin.2026-11-23.wien.registration", "gerichtsmedizin.dates.2027-01"]);
    expect(s.critical).toEqual([]);
    expect(s.pass).toBe(true);
    const onlyJan = grade("dl-gm-next-en", "The next exam is 18 to 22 January 2027, registration until 15 December 2026.", ["gerichtsmedizin.dates.2027-01"]);
    expect(onlyJan.failures).toEqual(expect.arrayContaining(["missing_date:2026-10-20"]));
    expect(onlyJan.pass).toBe(false);
    const invented = grade("dl-gm-next-en", `${text} Another sitting is on 10 February 2027.`, ["gerichtsmedizin.dates.2027-01"]);
    expect(invented.critical.some((c) => c.startsWith("wrong_date"))).toBe(true);
  });

  it("dl-sip4a-feb: the November anchor the question names is allowed, the February sitting is still required", () => {
    const text = "The next SIP4a sitting after 18 November 2026 is on 19 February 2027. Its registration window runs from 4 January to 18 January 2027. The November sitting has registration from 5 October to 19 October 2026.";
    const s = grade("dl-sip4a-feb-en", text, ["sitting.sip4a.2027-02-19.wien.registration", "sip4a.dates.2026-11"]);
    expect(s.critical).toEqual([]);
    expect(s.pass).toBe(true);
    const onlyNov = grade("dl-sip4a-feb-en", "The sitting is on 18 November 2026, registration until 19 October 2026.", ["sip4a.dates.2026-11"]);
    expect(onlyNov.failures).toContain("missing_date:2027-02-19");
    expect(onlyNov.pass).toBe(false);
  });
});

describe("NOT widened: the app read-on date stays a finding", () => {
  it("ap-mentor-price: a not-confirmed answer that asserts the bookkeeping date 2026-10-02 is still critical", () => {
    const s = grade("ap-mentor-price-de", "Zu einem Mentor-Paket gibt es keine bestätigten Angaben. Es ist nicht offiziell bestätigt, was es kostet. Die Tarife stehen in der App (Stand der App-Angaben: 2026-10-02).", []);
    expect(s.critical).toContain("wrong_date:2026-10-02");
  });
});
