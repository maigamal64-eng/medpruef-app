/**
 * Active-exam contract (UX-GLOBAL-30). The account preference
 * (users.active_exam via /api/user/exam-preference) is the single source;
 * the browser value is only a mirror. Pure, so it is unit-tested without React.
 *
 * Rules:
 *  - Never fall back to a hard-coded exam.
 *  - A URL exam that disagrees with the account never silently wins: the
 *    account exam is used and the mismatch is reported for an explicit switch.
 *  - With no account preference the learner picks first. The one exception is
 *    a browser choice made just now (onboarding writes the mirror and PATCHes
 *    in the background): when the mirror equals the URL exam, that choice is
 *    used and must be persisted.
 *  - If the account read failed, the mirror is a fallback; otherwise the picker.
 *  - Signed out there is no account, so the browser choice is the source.
 *
 * Note: users.active_exam defaults to 'kenntnispruefung' in the database and
 * GET /api/user/exam-preference returns that default for a null column, so a
 * signed-in account almost always has an exam. The picker therefore shows when
 * the preference cannot be read and no browser value exists. Telling a chosen
 * exam from a defaulted one needs a schema change (not part of this package).
 */
import { EXAM_SOURCE_IDS, type ExamSourceId } from "@/lib/topics";

export type AccountExamState =
  | { kind: "loading" }
  | { kind: "loaded"; exam: string | null }
  | { kind: "failed" }
  | { kind: "signed-out" };

export type ActiveExamResolution =
  | { status: "loading" }
  | {
      status: "ready";
      exam: ExamSourceId;
      source: "account" | "mirror";
      /** A URL exam that differs from the active exam; offer an explicit switch. */
      urlMismatch: ExamSourceId | null;
      /** True when the exam came from the mirror and should be saved to the account. */
      persist: boolean;
    }
  | { status: "needs-picker"; suggested: ExamSourceId | null };

export function asExamSourceId(value: unknown): ExamSourceId | null {
  return typeof value === "string" && (EXAM_SOURCE_IDS as readonly string[]).includes(value) ? (value as ExamSourceId) : null;
}

export function resolveActiveExam(input: { account: AccountExamState; mirror: string | null; url: string | null }): ActiveExamResolution {
  const mirror = asExamSourceId(input.mirror);
  const url = asExamSourceId(input.url);
  const ready = (exam: ExamSourceId, source: "account" | "mirror", persist: boolean): ActiveExamResolution => ({
    status: "ready", exam, source, persist, urlMismatch: url && url !== exam ? url : null,
  });

  switch (input.account.kind) {
    case "loading":
      return { status: "loading" };
    case "loaded": {
      const account = asExamSourceId(input.account.exam);
      if (account) return ready(account, "account", false);
      if (mirror && url && mirror === url) return ready(mirror, "mirror", true);
      return { status: "needs-picker", suggested: url ?? mirror };
    }
    case "failed":
      if (mirror) return ready(mirror, "mirror", false);
      return { status: "needs-picker", suggested: url };
    case "signed-out":
      if (mirror) return ready(mirror, "mirror", false);
      return { status: "needs-picker", suggested: url };
  }
}
