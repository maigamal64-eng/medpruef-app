import { describe, expect, it } from "vitest";
import { addTrialCondition, APP_TRIAL_FACT_ID } from "@/lib/mentor/app-trial";
import type { MentorFact, ValidatedAnswer } from "@/lib/mentor/seam";
import { appBillingFacts } from "@/lib/mentor/facts-loader";
import { withCaseFlags } from "../../mentor-eval/lib/flags";

const flipFact = () => withCaseFlags({ pricing_v2: true, reverse_trial: true }, () => appBillingFacts().find((f) => f.id === APP_TRIAL_FACT_ID)) as MentorFact;
const answer = (text: string, ids: string[] = [APP_TRIAL_FACT_ID], extra: Partial<ValidatedAnswer> = {}): ValidatedAnswer => ({ blocks: [{ text, fact_ids: ids }], citations: [], replaced: false, rejected: [], ...extra });

describe("addTrialCondition (live gate 17 Oct ap2-trial-after-de/en)", () => {
  it("adds the fact's Telegram sentence when a trial answer leaves it out (de, en)", () => {
    const f = flipFact();
    const de = addTrialCondition(answer("Danach üben Sie mit der kostenlosen Probe weiter. Es wird nichts abgebucht."), "de", f);
    expect(de.blocks).toHaveLength(2);
    expect(de.blocks[1]).toEqual({ text: expect.stringContaining("verknüpftem Telegram"), fact_ids: [] });
    expect(f.text_de.startsWith(de.blocks[1].text)).toBe(true);
    expect(de.replaced).toBe(false);
    const en = addTrialCondition(answer("Afterwards you keep practising with the free sample."), "en", f);
    expect(en.blocks[1].text).toContain("linked Telegram account");
    expect(f.text_en.startsWith(en.blocks[1].text)).toBe(true);
  });

  it("leaves answers alone that name Telegram, did not cite the trial, are refusals or other languages", () => {
    const f = flipFact();
    const named = answer("Neue Konten mit verknüpftem telegram erhalten 3 Tage.");
    expect(addTrialCondition(named, "de", f)).toBe(named);
    const other = answer("Das Monatsabo kostet 24 €.", []);
    expect(addTrialCondition(other, "de", undefined)).toBe(other);
    const refused = answer("x", [APP_TRIAL_FACT_ID], { refused: "no_verified_source" });
    expect(addTrialCondition(refused, "de", f)).toBe(refused);
    const fallback = answer("Diese Angabe ist nicht offiziell bestätigt.", [APP_TRIAL_FACT_ID], { replaced: true });
    expect(addTrialCondition(fallback, "de", f)).toBe(fallback);
    const ru = answer("Пробный доступ 3 дня.");
    expect(addTrialCondition(ru, "ru", f)).toBe(ru);
  });

  it("adds nothing under the card trial (its fact names no Telegram)", () => {
    const card = withCaseFlags({ pricing_v2: false, reverse_trial: false }, () => appBillingFacts().find((x) => x.id === APP_TRIAL_FACT_ID)) as MentorFact;
    const a = answer("Der Pro-Test dauert 7 Tage.");
    expect(addTrialCondition(a, "de", card)).toBe(a);
    expect(addTrialCondition(a, "de", null)).toBe(a);
  });
});
