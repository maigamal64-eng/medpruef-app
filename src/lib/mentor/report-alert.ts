import { captureServerError, captureServerWarning } from "@/lib/sentry-capture";
import type { MentorAlert } from "@/lib/mentor/turn";
import type { RunMentorTurn } from "@/lib/mentor/seam";

/**
 * The Mentor route's alert sink. A guard retry that recovered ("retry") still
 * gave the learner an answer: a Sentry warning, no email. Every other kind,
 * including turn_failed (a turn that ended in an error, refusal or notice after
 * a retry), stays an error.
 */
export function reportMentorAlert(a: Omit<MentorAlert, "kind"> & { kind: MentorAlert["kind"] | "turn_failed" }): void {
  const message = `mentor ${a.kind}${a.detail ? `: ${a.detail}` : ""}`;
  const ctx = {
    route: "/api/mentor/chat",
    userId: a.userId,
    requestId: a.requestId,
    callIndex: a.callIndex ?? null,
    mentorAlert: a.kind,
  };
  if (a.kind === "retry") captureServerWarning(message, ctx);
  else captureServerError(new Error(message), ctx);
}

/**
 * A turn that used a retry and still ended in an error event, a refusal or the
 * not-confirmed notice is a failure the learner saw: it reports as an error
 * (mentorAlert "turn_failed"), so the warning above never hides it. Read from
 * the emitted events (their `retries` count), so the gated turn loop is untouched.
 */
export function withTurnFailureAlert(runTurn: RunMentorTurn): RunMentorTurn {
  return async function* (deps, input) {
    for await (const ev of runTurn(deps, input)) {
      const retries = "retries" in ev ? ev.retries : undefined;
      if (retries && retries > 0) {
        const failed = ev.type === "error" ? `error ${ev.error}` : ev.type === "final" && (ev.result === "refusal" || ev.result === "notice") ? ev.result : null;
        if (failed) {
          reportMentorAlert({ kind: "turn_failed", userId: input.userId, requestId: input.requestId, detail: `${failed} after ${retries} retry(ies)` });
        }
      }
      yield ev;
    }
  };
}
