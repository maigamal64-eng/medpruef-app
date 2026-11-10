/**
 * Copy of the B2 lines on the mock-exam wall (growth pass 9 Nov 2026).
 * Source: reports/growth-weekly/2026-11-09/approved/in-app-lines.json
 * (sha256 e630f385a27cfe41..., Lektor APPROVE round 2). Byte-exact: change a
 * string only with a new Lektor APPROVE. {SITTING_LABEL} and {FIT_PLAN_LINE}
 * are filled by code; no date, price or plan name is typed here. The ask line
 * is the A1 ask line word for word (re-exported, not copied). German and
 * English only; any other language reads English.
 */
import { A1_ASK_LINE, freeEmptyLang, type FreeEmptyLang, type FreeEmptyLine } from "@/lib/free-empty-sitting/copy";

export type MockGateLang = FreeEmptyLang;
export const mockGateLang = freeEmptyLang;

export const B2_SITTING_LINE: Record<MockGateLang, FreeEmptyLine> = {
  de: {
    body: "Ihr Termin: {SITTING_LABEL}. {FIT_PLAN_LINE}",
    cta: "Tarif bis zu Ihrem Termin ansehen",
  },
  en: {
    body: "Your sitting: {SITTING_LABEL}. {FIT_PLAN_LINE}",
    cta: "See the plan up to your sitting",
  },
};

export const B2_ASK_LINE: Record<MockGateLang, FreeEmptyLine> = A1_ASK_LINE;
