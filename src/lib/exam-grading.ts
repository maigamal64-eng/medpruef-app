/** W0 contract name for exam grading and pass rules; the engine lives in src/lib/master-exam (b34). */
export { gradeQuestion, aggregateBySubject, evaluatePassRule, PASS_RULES, STP_POSITIVE_FIELDS_REQUIRED, type PassRuleId, type PassEvaluation, type SubjectResult } from "@/lib/master-exam";
export { runVerdict, ruleStatusFor, type RunVerdict, type VerdictKind } from "@/lib/exam-run";
