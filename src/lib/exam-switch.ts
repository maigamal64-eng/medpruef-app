/**
 * One exam-switch path for every switcher (UX-HOME-12, UX-HOME-14).
 *
 * The account preference is saved first; a failed save rolls the browser
 * mirror back and reports failure, so the old bank and data stay consistent.
 * After a successful save a cancelable `medpruef:examChanged` event is sent.
 * A page that refreshes its data in place (Home) cancels it; every other page
 * falls back to a reload so nothing keeps showing the old bank.
 * The request never carries a user id: identity comes from the signed session.
 */
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { setStoredExamSource, type ExamSourceId } from "@/lib/topics";

export const EXAM_CHANGED_EVENT = "medpruef:examChanged";

export interface ExamChangedDetail {
  examSource: ExamSourceId
  /** "server": Home applied the account preference; chips follow, Home does not refetch again. */
  source?: "switch" | "server"
}

/** Tell the chips that Home applied the account's exam (never reloads anything). */
export function announceServerExam(id: ExamSourceId): void {
  window.dispatchEvent(new CustomEvent<ExamChangedDetail>(EXAM_CHANGED_EVENT, { detail: { examSource: id, source: "server" }, cancelable: true }));
}

export async function saveExamPreference(id: ExamSourceId, fetcher: typeof authFetch = authFetch): Promise<boolean> {
  try {
    const res = await fetcher("/api/user/exam-preference", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activeExam: id }),
      timeoutMs: 8_000,
    });
    return res.ok;
  } catch {
    return false;
  }
}

function signedIn(): boolean {
  const id = getStoredSession()?.user?.id;
  return !!id && !id.startsWith("guest_");
}

/** Returns "saved" (and switches) or "failed" (nothing changed). */
export async function switchActiveExam(
  id: ExamSourceId,
  previous: ExamSourceId,
  opts: { fetcher?: typeof authFetch; reload?: () => void } = {},
): Promise<"saved" | "failed"> {
  setStoredExamSource(id);
  if (signedIn() && !(await saveExamPreference(id, opts.fetcher))) {
    setStoredExamSource(previous);
    return "failed";
  }
  const event = new CustomEvent<ExamChangedDetail>(EXAM_CHANGED_EVENT, { detail: { examSource: id }, cancelable: true });
  const handledInPlace = !window.dispatchEvent(event);
  if (!handledInPlace) setTimeout(opts.reload ?? (() => window.location.reload()), 50);
  return "saved";
}
