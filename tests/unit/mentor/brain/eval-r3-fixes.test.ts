/**
 * Mentor quality loop, round 3 (run1-r2 failure causes). The only critical of
 * run1-r2 was a protocol marker the model wrote inside a line
 * (dl-sip5a-sep27-en: "This window is not yet open (status fact: @@BLOCK ).").
 * The parser reads markers only at line start, so the token reached the
 * learner. These tests pin the strip and that it never widens what may pass.
 */
import { describe, it, expect } from "vitest";
import { getMentorFactsLoader } from "@/lib/mentor/facts-loader";
import { INLINE_MARKER_RE, parseAnswer, stripInlineMarkers, stripProtocolLines } from "@/lib/mentor/prompt/protocol";
import { stripProtocolMarkers, validateAnswer } from "@/lib/mentor/validator";
import { fact } from "./helpers";

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
    const raw = [
      "@@LANG en",
      "@@BLOCK facts=sip5a.dates.2027-09",
      "- The SIP5a sitting in autumn 2027 is on 23 September 2027 (MedUni Wien, read on 2026-10-10). It is the only SIP5a sitting listed for autumn 2027.",
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
    expect(text).toContain("read on 2026-10-10");
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
