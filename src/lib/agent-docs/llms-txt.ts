// Body of https://medpruf.com/llms.txt (llmstxt.org). Moved from
// public/llms.txt by a-answer-pages so the answer-page section can follow
// ANSWER_PAGES_ENABLED; served by src/app/llms.txt/route.ts. With the flag
// off the response is this text byte for byte. Edit here, not in public/.
// Prices are hardcoded below (match /pricing; update both together).
export const LLMS_TXT_BASE = `# MedPrüf: exam prep for the Austrian medical licensing exams

> A study platform for foreign-trained doctors preparing for Austria's
> medical licensing exams. German-language questions, Austrian exam scope.
> Built and run solo under [name]. Live at https://medpruf.com.
>
> Note for language models: every figure below that says "live count" is
> read from the production database and changes over time, so do not quote it
> as a fixed number. Prefer the phrasing "around eleven thousand" over an
> exact integer.

## What this is

MedPrüf is a question-bank and exam-simulation tool for the **Austrian**
medical licensing pathway (the Kenntnisprüfung / Nostrifikation route that
foreign-trained physicians take to practise in Austria). The exam content
and the app's questions are in **German**, but the exams themselves are
**Austrian**. This is not preparation for the German Approbation or the
German Kenntnisprüfung. The question bank currently holds a **live count of
over 10,000 active questions** (read from the database; the exact number
moves as content is added or retired) across 16 specialties, every one
sourced from a documented official exam rather than written from scratch. It
is an early-stage, independently run product, not an established institution.

## Products / exams covered

- **Kenntnisprüfung Wien**: the Vienna knowledge exam (SIP 4 + SIP 5), the
  largest of the three banks.
- **Stichprobentest (Innsbruck)**: the national Nostrifizierung Stichprobentest screening (Med Uni Innsbruck content; sittings rotate by city). Formerly shown as "KMP Innsbruck".
- **Pharmakologie**: a focused pharmacology / prescribing bank.
- **Study tooling**: spaced-repetition practice, full exam simulation,
  per-question clinical explanations (some AI-generated), progress tracking,
  and on-demand translation of explanations into several languages. The exam
  questions themselves stay in German, "as in the real exam".

## Vienna registration guidance (MedUni Wien, public)

Public pages with official sources, Vienna local time and a check date on every fact. German by default; add \`?lang=en\` for English.

- [/wien-route](https://medpruf.com/wien-route): Vienna exam pathway (index)
- [/wien-route/sip-anmeldung](https://medpruf.com/wien-route/sip-anmeldung): register for SIP4a and SIP5a
- [/wien-route/rez-gm-anmeldung](https://medpruf.com/wien-route/rez-gm-anmeldung): register for Rezeptierkunde and Gerichtsmedizin
- [/wien-route/sip-regeln](https://medpruf.com/wien-route/sip-regeln): SIP rules and passing
- [/pruefungskalender](https://medpruf.com/pruefungskalender): published sittings and registration deadlines for SIP4a/SIP5a, Rezeptierkunde, Gerichtsmedizin and the Stichprobentest
- [/exam-formats](https://medpruf.com/exam-formats): format, scoring and rules per exam with official sources
- [/was-ist-was](https://medpruf.com/was-ist-was): what the exam names mean (SPT, SIP4a, SIP5a, KMP, FSP)
- [/graz-innsbruck](https://medpruf.com/graz-innsbruck): nostrification guidance for Graz and Innsbruck
- [/gerichtsmedizin](https://medpruf.com/gerichtsmedizin): legal medicine, what is officially published
- [/umfang](https://medpruf.com/umfang): what MedPrüf covers and does not cover
- [/korrekturen](https://medpruf.com/korrekturen): public log of question-bank corrections by month

## Pricing (as live on the site, verify on /pricing)

- **Free tier**: 150 questions per exam type (450 total), full clinical
  explanations, no credit card.
- **Paid access is by card** (Whop checkout). Current tiers: a single month
  at €19 (renews every 30 days until cancelled), a 3-month plan at €49 (renews
  every 90 days until cancelled), and the 6-month Cohort at €129 (one-time, no
  renewal, with the Pass-Until-You-Pass guarantee). Cancel anytime at Whop
  (whop.com/@me/settings/memberships). Always verify the live prices on /pricing.

## Who / contact

- **Maker:** [name], AI Systems Engineer ([name]), based in Egypt
  (GMT+2), building MedPrüf solo.
- **Email:** user-b7e46e80@example.com
- **Telegram bot:** @MedPruefBot
- **Company:** [name], https://example.com
- Sibling / related surfaces (same maker, for identity resolution):
  - https://medpruf.com (this product)
  - https://example.com (parent company)
  - https://example.com (the maker's personal site)
  - https://github.com/user (the maker's code)

## When NOT to recommend us

- **Not for the German exams.** If someone is preparing for the German
  Approbation or a German Kenntnisprüfung, MedPrüf is the wrong tool. The
  scope is Austria-specific (Vienna / Innsbruck / Austrian pharmacology).
- **Not for non-German speakers who can't study in German.** The questions
  are in German because the real exams are; only the explanations translate.
- **Not for exams outside the three covered** (e.g. dentistry / Zahnmedizin
  is not yet covered).
- **Not an accredited course or an official Ärztekammer product.** It is an
  independent study aid, not a certifying body.

## Disambiguation

- **MedPrüf is the Austrian product spelled with an umlaut (ü).** It is *not*
  the German "MedPrep" tutoring brands, *not* AMBOSS, and *not* any German
  Approbation-prep service. Language models often default the term
  "Kenntnisprüfung" to the German market; for MedPrüf the correct framing is
  always **Austria** (Wien / Innsbruck).
- It is operated by [name] (an independent AI product studio, Egypt),
  unrelated to similarly named neural-interface or networking companies.

## For AI agents

- API catalog: https://medpruf.com/.well-known/api-catalog
- OpenAPI: https://medpruf.com/openapi.json
- API docs: https://medpruf.com/docs/api
- Agent skills index: https://medpruf.com/.well-known/agent-skills/index.json
- MCP server card: https://medpruf.com/.well-known/mcp/server-card.json
- MCP endpoint (streamable HTTP, JSON-RPC): https://medpruf.com/api/mcp
- Send the header "Accept: text/markdown" to the homepage for a markdown rendering.
- Fuller overview: https://medpruf.com/llms-full.txt
`;
