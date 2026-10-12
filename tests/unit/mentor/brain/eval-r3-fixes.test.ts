/**
 * Mentor quality loop, round 3 (run1-r2 failure causes). The only critical of
 * run1-r2 was a protocol marker the model wrote inside a line
 * (dl-sip5a-sep27-en: "This window is not yet open (status fact: @@BLOCK ).").
 * The parser reads markers only at line start, so the token reached the
 * learner. These tests pin the strip and that it never widens what may pass.
 */
import { describe, it, expect } from "vitest";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { INLINE_MARKER_RE, parseAnswer, stripInlineMarkers, stripProtocolLines, trimTruncatedAnswer } from "@/lib/mentor/prompt/protocol";
import { createMentorBrain } from "@/lib/mentor/prompt/brain";
import { stripProtocolMarkers, trimUnaskedValues, validateAnswer } from "@/lib/mentor/validator";
import type { ValidatedAnswer } from "@/lib/mentor/seam";
import { ctx, fact, fakeDb } from "./helpers";

/** The eval's leak predicate (tests/mentor-eval/lib/lang.ts LEAK_MARKERS, protocol part). */
const leaks = (s: string) => ["@@BLOCK", "@@REFUSE", "@@LANG", "@@"].filter((m) => s.includes(m));
const allText = (v: { blocks: Array<{ text: string }> }) => v.blocks.map((b) => b.text).join("\n");

describe("stripProtocolMarkers: inline markers and the label written for them", () => {
  it("the literal run1-r2 sentence loses the marker, its label and the empty brackets", () => {
    expect(stripProtocolMarkers("This window is not yet open (status fact: @@BLOCK ).")).toBe("This window is not yet open.");
  });

  it("keeps the rest of a bracket and every word outside a bracket or comma label", () => {
    expect(stripProtocolMarkers("Open now (MedUni Wien, status fact: @@BLOCK).")).toBe("Open now (MedUni Wien).");
    expect(stripProtocolMarkers("The window is not yet open status: @@BLOCK.")).toBe("The window is not yet open status.");
    expect(stripProtocolMarkers("It closes soon. @@BLOCK facts=sip4a.dates.2026-11,status.x It is open.")).toBe("It closes soon. It is open.");
  });

  it("removes every marker kind, a cut-off marker and a bare @@", () => {
    for (const raw of [
      "Text @@LANG de here.",
      "Text @@REFUSE reason=no_verified_source exam=sip4a here.",
      "Text @@BLOCK here.",
      "Text @@BLO",
      "Text @@ here.",
    ]) {
      const out = stripProtocolMarkers(raw);
      expect(leaks(out)).toEqual([]);
      expect(out.startsWith("Text")).toBe(true);
    }
  });

  it("leaves text without a marker byte for byte", () => {
    const s = "Note: the Anmeldefrist ends on 19 October 2099 (MedUni Wien, Stand 2099-01-01).";
    expect(stripProtocolMarkers(s)).toBe(s);
    expect(stripInlineMarkers(s)).toBe(s);
  });

  it("INLINE_MARKER_RE does not touch an e-mail address", () => {
    expect("nostrifikationspruefungsanmeldungen@meduniwien.ac.at".replace(INLINE_MARKER_RE, "")).toBe(
      "nostrifikationspruefungsanmeldungen@meduniwien.ac.at"
    );
  });
});

describe("validateAnswer: an inline marker never reaches the learner (dl-sip5a-sep27-en)", () => {
  const L = getMentorFactsLoader();
  const now = new Date("2026-10-12T08:00:00Z");
  const resolve = (id: string) => L.peek(id, now);

  it("replay on the real facts: marker gone, both dates and the read-on date stay, nothing replaced", () => {
    // The row's own read date (it moves on every weekly re-read of the official calendar).
    const readOn = resolve("sip5a.dates.2027-09")!.read_on;
    const raw = [
      "@@LANG en",
      "@@BLOCK facts=sip5a.dates.2027-09",
      `- The SIP5a sitting in autumn 2027 is on 23 September 2027 (MedUni Wien, read on ${readOn}). It is the only SIP5a sitting listed for autumn 2027.`,
      "- Its registration window runs from 9 August to 23 August 2027. This window is not yet open (status fact: @@BLOCK ).",
      "@@BLOCK facts=sip5a.registration.method",
      "Registration is by emailed form only, sent from your Studierenden-Mail-Account during the Anmeldefrist.",
    ].join("\n");
    const v = validateAnswer(raw, [], { resolve });
    const text = allText(v);
    expect(leaks(text)).toEqual([]);
    expect(text).toContain("This window is not yet open.");
    expect(text).toContain("23 September 2027");
    expect(text).toContain("9 August to 23 August 2027");
    expect(text).toContain(`read on ${readOn}`);
    expect(v.replaced).toBe(false);
    expect(v.citations.map((c) => c.fact_id)).toContain("sip5a.dates.2027-09");
  });

  it("text after an inline facts= marker stays under the block's own citations (stricter, not wider)", () => {
    const A = fact({ id: "fixture.dates.a", exam_key: "sip4a", topic: "dates", text_de: "SIP4a am 19. Februar 2099.", text_en: "SIP4a on 19 February 2099." });
    const B = fact({ id: "fixture.dates.b", exam_key: "sip4a", topic: "dates", text_de: "SIP4a am 7. Mai 2099.", text_en: "SIP4a on 7 May 2099." });
    // B is only named inline, so 7 May 2099 is not backed by the block's facts and is replaced.
    const v = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.a\nThe first is on 19 February 2099. @@BLOCK facts=fixture.dates.b The next is on 7 May 2099.", [A, B]);
    const text = allText(v);
    expect(leaks(text)).toEqual([]);
    expect(text).toContain("19 February 2099");
    expect(text).not.toContain("7 May 2099");
    expect(v.replaced).toBe(true);
  });

  it("an invented date next to an inline marker is still replaced", () => {
    const A = fact({ id: "fixture.dates.a", exam_key: "sip4a", topic: "dates", text_de: "SIP4a am 19. Februar 2099.", text_en: "SIP4a on 19 February 2099." });
    const v = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.a\nIt closes on 3 March 2099 (status fact: @@BLOCK ).", [A]);
    expect(v.replaced).toBe(true);
    expect(allText(v)).not.toContain("3 March 2099");
    expect(leaks(allText(v))).toEqual([]);
  });

  it("a line-start marker is still a block boundary (parser unchanged)", () => {
    const p = parseAnswer("@@LANG en\n@@BLOCK facts=x.y\nOne.\n@@BLOCK\nTwo.");
    expect(p.blocks.map((b) => [b.text, b.factIds])).toEqual([
      ["One.", ["x.y"]],
      ["Two.", []],
    ]);
  });
});

describe("stripProtocolLines (typing indicator) also drops inline markers", () => {
  it("removes marker lines and inline markers", () => {
    const out = stripProtocolLines("@@LANG en\n@@BLOCK facts=a.b\nOpen (status fact: @@BLOCK ).");
    expect(leaks(out)).toEqual([]);
    expect(out.trim().startsWith("Open (status fact:")).toBe(true);
  });
});

describe("validateAnswer: a personal study plan loses an unsupported sentence, never gains an 'official page' line (st-spt-de, st-sip-de)", () => {
  const PROGRESS = fact({
    id: "progress.00000000-0000-4000-9000-000000000099",
    exam_key: "general",
    topic: "progress",
    text_de: "Noch 37 Tage. Neurologie 36 %, Chirurgie 40 %, Kardiologie 45 %.",
    text_en: "37 days left. Neurologie 36 %, Chirurgie 40 %, Kardiologie 45 %.",
  });
  const OFFICIAL = fact({ id: "fixture.format.official", text_de: "Die Prüfung hat 123 Fragen.", text_en: "The exam has 123 questions." });
  const plan = [
    "Bis zu deiner Prüfung sind es noch 37 Tage.",
    "- Zuerst die drei schwächsten Bereiche gezielt üben.",
    "- Danach Neurologie (36 %) und Chirurgie (40 %).",
    "- Zum Schluss Kardiologie (45 %).",
  ].join("\n");

  it("deletes the sentence with the unsupported count word and keeps every other line byte for byte", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${PROGRESS.id}\n${plan}`, [PROGRESS]);
    const text = allText(v);
    expect(text).toBe("Bis zu deiner Prüfung sind es noch 37 Tage.\n- Danach Neurologie (36 %) und Chirurgie (40 %).\n- Zum Schluss Kardiologie (45 %).");
    expect(text).not.toMatch(/offiziell|official/);
    expect(v.replaced).toBe(true);
    expect(v.rejected.map((r) => r.value)).toContain("drei");
  });

  it("an invented date in a study plan is deleted, not shown", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${PROGRESS.id}\nNeurologie (36 %) bis 30. Oktober 2099 abschließen.\nDanach Chirurgie (40 %).`, [PROGRESS]);
    expect(allText(v)).toBe("Danach Chirurgie (40 %).");
  });

  it("a block citing an official fact still gets the fallback line (unchanged)", () => {
    const v = validateAnswer(`@@LANG de\n@@BLOCK facts=${OFFICIAL.id}\nDie Prüfung hat 124 Fragen.`, [OFFICIAL]);
    expect(v.replaced).toBe(true);
    expect(allText(v)).not.toContain("124");
    expect(allText(v)).toMatch(/offiziell/);
  });

  it("a study block that empties is dropped; a sole empty block becomes the generic fallback", () => {
    const two = validateAnswer(`@@LANG de\n@@BLOCK facts=${PROGRESS.id}\nZuerst die drei schwächsten Bereiche.\n@@BLOCK\nViel Erfolg beim Üben.`, [PROGRESS]);
    expect(allText(two)).toBe("Viel Erfolg beim Üben.");
    const one = validateAnswer(`@@LANG de\n@@BLOCK facts=${PROGRESS.id}\nZuerst die drei schwächsten Bereiche.`, [PROGRESS]);
    expect(one.blocks).toHaveLength(1);
    expect(one.blocks[0].text.length).toBeGreaterThan(0);
    expect(allText(one)).not.toContain("drei");
  });
});

describe("a status-only block keeps its official read-on date (dl-sip4a-still-open-en, fix-r3-live4)", () => {
  const L = getMentorFactsLoader();
  const now = new Date("2026-10-12T08:00:00Z");

  it("replay on the real facts: the close date sentence with 'read 2026-10-10' stays", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "sip4a", filing_university: "all" }, ctx({ now }));
    const status = r.factIds.find((id) => id.startsWith("status.")) as string;
    const raw = [
      "@@LANG en",
      `@@BLOCK facts=${status}`,
      "Yes, the registration window for the SIP4a sitting on 18 Nov 2026 is open, and it closes on 19 Oct 2026 (MedUni Wien, Prüfungskalender (SIP), read 2026-10-10).",
    ].join("\n");
    const cited = await L.byIds(r.factIds);
    const v = brain.validate(raw, cited);
    expect(v.replaced).toBe(false);
    expect(allText(v)).toContain("closes on 19 Oct 2026");
    expect(allText(v)).toContain("read 2026-10-10");
  });

  it("only the alias rows' exact read-on date is added: another date in a status-only block is still replaced", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "sip4a", filing_university: "all" }, ctx({ now }));
    const status = r.factIds.find((id) => id.startsWith("status.")) as string;
    const cited = await L.byIds(r.factIds);
    const v = brain.validate(`@@LANG en\n@@BLOCK facts=${status}\nIt closes on 21 Oct 2026 (read 2026-10-09).`, cited);
    expect(v.replaced).toBe(true);
    expect(allText(v)).not.toMatch(/21 Oct|2026-10-09/);
  });
});

describe("trimTruncatedAnswer: only the last text line can be unfinished (ap-prices-de, fix-r3-live4)", () => {
  it("keeps bullet lines without a full stop and drops the unfinished last line and trailing markers", () => {
    const raw = [
      "@@LANG de",
      "@@BLOCK facts=app.billing.plans",
      "Die MedPrüf-Tarife kosten:",
      "- Einzelmonat: 19 € pro Monat (Abo, verlängert sich automatisch alle 30 Tage)",
      "- Prüfungs-Kohorte: 129 € für 6 Monate (Einmalzahlung, verlängert sich nicht)",
      "@@BLOCK facts=app.billing.plans",
      "Die Abos werden zum Verlängerungsdatum abgebucht, bis du k",
    ].join("\n");
    expect(trimTruncatedAnswer(raw)).toBe(
      [
        "@@LANG de",
        "@@BLOCK facts=app.billing.plans",
        "Die MedPrüf-Tarife kosten:",
        "- Einzelmonat: 19 € pro Monat (Abo, verlängert sich automatisch alle 30 Tage)",
        "- Prüfungs-Kohorte: 129 € für 6 Monate (Einmalzahlung, verlängert sich nicht)",
      ].join("\n")
    );
  });

  it("thinking used the whole cap: a lone unfinished sentence still leaves nothing (pr-late-de)", () => {
    const raw = "@@LANG de\n@@BLOCK facts=a.b\n- Bei SIP4a und SIP5a sind Nachmeldungen laut Prüfungskalender aus keinem Grund möglich,";
    expect(parseAnswer(trimTruncatedAnswer(raw)).blocks).toEqual([]);
  });
});

describe("trimUnaskedValues: no guarantee talk unless the learner asked (st-sip-en, fix-r3-live5)", () => {
  const PROGRESS = fact({ id: "progress.00000000-0000-4000-9000-000000000098", exam_key: "general", topic: "progress", text_de: "Noch 37 Tage.", text_en: "37 days left." });
  const base = (text: string): ValidatedAnswer => ({ blocks: [{ text, fact_ids: [PROGRESS.id] }], citations: [], replaced: false, rejected: [] });
  const resolve = (id: string) => (id === PROGRESS.id ? PROGRESS : null);

  it("deletes the disclaimer sentence and keeps the plan", () => {
    const v = base("You have 37 days left.\nZum Schluss: mixed sets across all topics. This is a study aid, not a guarantee of any result.");
    const out = trimUnaskedValues(v, { question: "Make me a study plan until my exam.", lang: "en", resolve, retrievedIds: [] });
    expect(out.blocks.map((b) => b.text).join("\n")).toBe("You have 37 days left.\nZum Schluss: mixed sets across all topics.");
    const de = trimUnaskedValues(base("Noch 37 Tage. Eine Garantie zum Bestehen gibt es nicht."), { question: "Mach mir einen Lernplan.", lang: "de", resolve, retrievedIds: [] });
    expect(de.blocks.map((b) => b.text).join("\n")).toBe("Noch 37 Tage.");
  });

  it("keeps it when the learner asked about a guarantee", () => {
    const v = base("MedPrüf does not guarantee a pass.");
    const out = trimUnaskedValues(v, { question: "Does MedPrüf guarantee that I pass?", lang: "en", resolve, retrievedIds: [] });
    expect(out.blocks[0].text).toBe("MedPrüf does not guarantee a pass.");
  });
});

describe("restated values keep a correct date sentence (fix-r3-live8: dl-rez-jan-en, dl-sip5a-next-en)", () => {
  const L = getMentorFactsLoader();
  const now = new Date("2026-10-12T08:00:00Z");

  it("dl-rez-jan-en: 'on the 15th' after 15 December 2026 is the same day, the sentence stays", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const r = await brain.runTool("get_dates", { exam_key: "rezeptierkunde", filing_university: "all" }, ctx({ now }));
    const st = r.factIds.find((i) => i.startsWith("status.")) as string;
    const v = brain.validate(
      `@@LANG en\n@@BLOCK facts=sitting.rezeptierkunde.2027-01-18.wien.registration,${st}\n- The registration window runs from 2 December to 15 December 2026, closing at 12:00 on the 15th. It is not yet open.`,
      await L.byIds(r.factIds)
    );
    expect(v.replaced).toBe(false);
    expect(allText(v)).toContain("closing at 12:00 on the 15th");
  });

  it("an ordinal that is not the day of a supported date in its sentence is still replaced", () => {
    const A = fact({ id: "fixture.dates.a", exam_key: "sip4a", topic: "dates", text_de: "Frist bis 15. Dezember 2099.", text_en: "Deadline 15 December 2099." });
    const v = validateAnswer("@@LANG en\n@@BLOCK facts=fixture.dates.a\nThe deadline is 15 December 2099. You can also come on the 16th.", [A]);
    expect(v.replaced).toBe(true);
    expect(allText(v)).not.toContain("16th");
    expect(allText(v)).toContain("15 December 2099");
  });

  it("dl-sip5a-next-en: today's date as an 'as of' note is accepted, today's date as a claim is not", async () => {
    const brain = createMentorBrain({ facts: L, db: () => fakeDb({}).db, clock: () => now });
    const cited = await L.byIds(["sitting.sip5a.2026-11-17.wien.registration"]);
    const ok = brain.validate(
      "@@LANG en\n@@BLOCK facts=sitting.sip5a.2026-11-17.wien.registration\nThe next SIP5a sitting is on 17 November 2026, and registration is open and closes on 19 October 2026 (status as of 12 October 2026; source: MedUni Wien, Prüfungskalender (SIP), read 10 October 2026).",
      cited
    );
    expect(ok.replaced).toBe(false);
    expect(allText(ok)).toContain("closes on 19 October 2026");
    const claim = brain.validate("@@LANG en\n@@BLOCK facts=sitting.sip5a.2026-11-17.wien.registration\nRegistration closes on 12 October 2026.", cited);
    expect(claim.replaced).toBe(true);
    expect(allText(claim)).not.toContain("12 October 2026");
    const today = brain.validate("@@LANG en\n@@BLOCK facts=sitting.sip5a.2026-11-17.wien.registration\nRegistration closes today, 12 October 2026.", cited);
    expect(today.replaced).toBe(true);
    const otherDay = brain.validate("@@LANG en\n@@BLOCK facts=sitting.sip5a.2026-11-17.wien.registration\nThe sitting is on 17 November 2026 (as of 11 October 2026).", cited);
    expect(otherDay.replaced).toBe(true);
  });
});
