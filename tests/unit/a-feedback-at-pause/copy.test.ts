import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FEEDBACK_ASK_COPY, feedbackAskCopy } from "@/lib/i18n-feedback-ask";

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

describe("round-end ask copy (Lektor 17 Oct)", () => {
  it("has no em or en dashes, no exclamation marks, and German uses Sie", () => {
    for (const lang of ["de", "en"] as const) {
      for (const line of Object.values(FEEDBACK_ASK_COPY[lang])) {
        expect(line).not.toMatch(/[–—!]/);
      }
    }
    const de = Object.values(FEEDBACK_ASK_COPY.de).join(" ");
    expect(de).not.toMatch(/\b(du|dir|dich|dein\w*)\b/i);
    expect(de).toMatch(/\bIhnen\b|\bSie\b/);
  });

  it("falls back to English for languages without a native review", () => {
    expect(feedbackAskCopy("ar")).toBe(FEEDBACK_ASK_COPY.en);
    expect(feedbackAskCopy("ru")).toBe(FEEDBACK_ASK_COPY.en);
    expect(feedbackAskCopy("de")).toBe(FEEDBACK_ASK_COPY.de);
  });

  it("keeps the approved bytes", () => {
    const pinned = Object.fromEntries((["de", "en"] as const).map((l) => [l, sha(JSON.stringify(FEEDBACK_ASK_COPY[l]))]));
    expect(FEEDBACK_ASK_COPY.de.question).toBe("Eine kurze Frage zum Schluss: Was würde Ihnen beim Lernen mit MedPrüf am meisten helfen?");
    expect(FEEDBACK_ASK_COPY.en.question).toBe("One short question to finish: what would help you most when studying with MedPrüf?");
    expect(FEEDBACK_ASK_COPY.de.failed).toBe("Ihre Antwort wurde nicht gesendet. Bitte versuchen Sie es erneut.");
    expect(FEEDBACK_ASK_COPY.de.sending).toBe("Wird gesendet…");
    expect(FEEDBACK_ASK_COPY.en.sending).toBe("Sending…");
    expect(pinned).toMatchSnapshot();
  });
});
