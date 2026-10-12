# Legacy AI explanation tab: one trust standard now, dated retirement plan (MUX-90, TR-30)

Status: stage 1 in source (a37, 2026-10-12). Stages 2 and 3 are later owner decisions.

## Context

Learners see two AIs: the quiz "KI-Erklärung" tab (`AIChatAssistant`, `/api/ai-chat`, Pro follow-ups, 15 attempts a day, no fact validator) and the dark KI-Mentor (credits, fact rows, validator, sources). Spec MUX-90 rollout B: coexist, one name table, one trust standard, keep the cached free explanation until mentor explain mode passes the medical-content review lane.

## Stage 1 (this change)

- Name table: `MENTOR_NAMES` in `src/lib/i18n-mentor.ts`. The tab stays "KI-Erklärung" / "AI Explanation" with the same "KI" / "AI" text badge as the mentor; the old "MedPrüf Assistent" header is gone.
- Trust line under every real AI answer: "KI-generiert, kann Fehler enthalten." plus "Falsch? Frage melden", which opens the question report form with reason `ai_explanation_wrong`. Bank text shown in the tab is labelled "Erklärung aus der Fragenbank, nicht von der KI". Flashcards label an AI-only explanation the same way.
- Sources: `/api/ai-chat` tells the model its only sources are the question row and to say it is not sure otherwise; `src/lib/ai/citation-guard.ts` removes invented citations (URLs, papers, guideline editions, source lists) before caching or showing, and appends one "not sure" note.
- German copy in Sie (pick-copy-register B).

## Dates

| Date | Step | Owner |
|---|---|---|
| 2026-10-12 | Stage 1 in source, dark mentor unchanged | track-A |
| Mentor beta start ([name]'s GO, flags in order) | Coexistence window opens, 30 days | [name] |
| Beta start + 30 days, not before 2026-11-26 | Review: mentor explain-mode report rate vs legacy tab report rate (`ai_explanation_wrong` reports per 100 AI answers), medical review lane result, legacy spend | [name] with Praxis |
| After a passed review | Stage 2: the tab body becomes mentor explain mode; `/api/ai-chat` keeps only translate and notes | separate package |
| Stage 2 + 30 days | Stage 3: retire the legacy chat, fold its spend into the mentor cap | separate package |

Stages 2 and 3 change pricing promises ("unlimited clinical AI explanations") and spend accounting, so each needs its own GO. Nothing here changes a flag, price or limit.
