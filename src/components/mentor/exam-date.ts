import { authFetch } from "@/lib/authFetch";
/** Strict real calendar date; never allow a normalized invalid date. */
export function isSittingDate(date: unknown): date is string {
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0,10) === date;
}
export async function saveMentorExamDate(date: string, send = authFetch): Promise<boolean> {
  if (!isSittingDate(date)) return false;
  try {
    const res = await send("/api/user/exam-preference", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ examDate: date }), timeoutMs: 12_000 });
    const body = await res.json();
    return res.ok && body?.ok === true && body?.persisted === true;
  } catch { return false; }
}
