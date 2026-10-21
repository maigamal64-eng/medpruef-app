import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseText, toHtml } from "../../../scripts/mail/send-one";

function file(text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "send-one-"));
  const p = path.join(dir, "mail.txt");
  writeFileSync(p, text);
  return p;
}

describe("scripts/mail/send-one (scheduled feedback and flag replies)", () => {
  it("needs the Subject line format and refuses dashes", () => {
    expect(parseText(file("Subject: Danke für Ihre Meldung\n\nGuten Tag Ada,\n\nwir haben es korrigiert."))).toEqual({
      subject: "Danke für Ihre Meldung",
      body: "Guten Tag Ada,\n\nwir haben es korrigiert.",
    });
    expect(typeof parseText(file("Danke\n\nBody"))).toBe("string");
    expect(parseText(file("Subject: Hallo\n\nViele Grüße\n[name] — MedPrüf"))).toBe("em or en dash found; fix the text");
  });

  it("escapes HTML and links https URLs", () => {
    const html = toHtml("Hallo <b>Ada</b>,\n\nsiehe https://medpruf.com/quiz.");
    expect(html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(html).toContain('<a href="https://medpruf.com/quiz">https://medpruf.com/quiz</a>.');
  });
});
