/**
 * B2 of the 9 Nov growth pass: the learner's own sitting (or the question for
 * it) on the mock-exam wall. Pure, client and server safe, `now` injected. The
 * server route (/api/mock-gate/sitting-line) reads the account and calls this;
 * nothing here typed a date, a price or a plan name.
 *
 *  - sitting: active bank kenntnispruefung or kmp_innsbruck; the saved exam
 *    date is a row of OFFICIAL_SITTINGS for that bank and not
 *    window_unconfirmed; today (Vienna) is before the Monday of that
 *    sitting's week (the learner's own promotion pause).
 *  - ask: no exam date saved; today is outside every pause: from the Monday
 *    of a sip4a or sip5a sitting week through the last day of the
 *    Rezeptierkunde and Gerichtsmedizin exam week that follows it (within 14
 *    days), else through the end of the SIP week. Read from OFFICIAL_SITTINGS.
 *  - Both stop after the Cairo day MOCK_GATE_WINDOW_END; anything else is
 *    "none" and the gate renders as before.
 */
import { OFFICIAL_KEYS_BY_BANK, OFFICIAL_SITTINGS, daysUntilViennaDate, viennaToday, type OfficialSitting, type PuypExamType } from "@/lib/exam-dates";
import { formatSittingWhen } from "@/lib/i18n-dates";
import { addDays, isoDayOf, weekStart } from "@/lib/journey/moments";
import { fill, sittingLinkCopy } from "@/lib/sitting-link/copy";
import { parseFreeEmptySitting, FREE_EMPTY_ASK_HREF, type FreeEmptyFit, type FreeEmptySitting } from "@/lib/free-empty-sitting";
import { B2_ASK_LINE, B2_SITTING_LINE, mockGateLang } from "./copy";
import { mockGateWindowOpen } from "./flag";

export type MockGateFit = FreeEmptyFit;
export type MockGateLine = FreeEmptySitting;
export const parseMockGateLine = parseFreeEmptySitting;
export const MOCK_GATE_ASK_HREF = FREE_EMPTY_ASK_HREF;
export const MOCK_GATE_BANKS: readonly PuypExamType[] = ["kenntnispruefung", "kmp_innsbruck"];
/** A Rez/GM exam week that starts within this many days after a SIP sitting belongs to its pause. */
const REZ_GM_FOLLOW_DAYS = 14;

export interface MockGateInput {
  now: Date;
  lang: string;
  /** The active bank of the exam screen; anything but the two banks is "none". */
  bank: string | null;
  /** users.exam_date (YYYY-MM-DD or a timestamp), null when none is saved. */
  examDate: string | null;
  /** The plan-fit sentence parts for the sitting (sittingFit().recommended, rendered by the caller), or null. */
  fit: (sitting: { date: string; lastDay: string }) => MockGateFit | null;
  sittings?: readonly OfficialSitting[];
}

const NONE: MockGateLine = { state: "none" };

const isSip = (s: OfficialSitting) => s.exam_key === "sip4a" || s.exam_key === "sip5a";
const isRezGm = (s: OfficialSitting) => s.exam_key === "rezeptierkunde" || s.exam_key === "gerichtsmedizin";

/** True while today (Vienna) is inside the pause of any SIP sitting week (see the file header). */
export function inAskPause(today: string, sittings: readonly OfficialSitting[] = OFFICIAL_SITTINGS): boolean {
  return sittings.some((s) => {
    if (!isSip(s)) return false;
    const start = weekStart(s.date);
    let end = addDays(start, 6);
    for (const r of sittings) {
      if (!isRezGm(r) || r.date < s.date || r.date > addDays(s.date, REZ_GM_FOLLOW_DAYS)) continue;
      const rEnd = r.date_end ?? r.date;
      if (rEnd > end) end = rEnd;
    }
    return today >= start && today <= end;
  });
}

export function mockGateLine(input: MockGateInput): MockGateLine {
  const sittings = input.sittings ?? OFFICIAL_SITTINGS;
  const bank = MOCK_GATE_BANKS.find((b) => b === input.bank);
  if (!bank) return NONE;
  if (!mockGateWindowOpen(input.now)) return NONE;
  const today = viennaToday(input.now);
  const lang = mockGateLang(input.lang);
  const day = isoDayOf(input.examDate);

  if (!day) {
    if (inAskPause(today, sittings)) return NONE;
    const ask = B2_ASK_LINE[lang];
    return { state: "ask", lines: [ask.body], cta: { label: ask.cta, href: MOCK_GATE_ASK_HREF } };
  }

  const keys = OFFICIAL_KEYS_BY_BANK[bank];
  const rows = sittings.filter((s) => keys.includes(s.exam_key) && s.date === day);
  if (rows.length === 0 || rows.some((s) => s.window_unconfirmed)) return NONE;
  const row = rows[0];
  const lastDay = row.date_end ?? row.date;
  if (daysUntilViennaDate(row.date, input.now) < 1 || today >= weekStart(row.date)) return NONE;

  const label = (row.learner_label as Record<string, string>)[lang] ?? row.learner_label.en;
  const sittingLabel = `${label}, ${formatSittingWhen(row, lang)}`;
  const fit = input.fit({ date: row.date, lastDay });
  const fitLine = fit ? fill(sittingLinkCopy(lang).fitLine, { plan: fit.plan, total: fit.total }) : "";
  const copy = B2_SITTING_LINE[lang];
  const body = copy.body.replace("{SITTING_LABEL}", sittingLabel).replace("{FIT_PLAN_LINE}", fitLine).trim();
  const q = new URLSearchParams({ gate: "mock_exam", bank, sitting: row.date, sitting_end: lastDay });
  return { state: "sitting", lines: [body], cta: { label: copy.cta, href: `/pricing?${q.toString()}` } };
}

/** What the gate's one plans button shows while the line renders (state is never "none" here). */
export function mockGateClick(line: MockGateLine): { target: "pricing" | "add_sitting"; line: "b2" } | null {
  if (line.state === "none") return null;
  return { target: line.state === "sitting" ? "pricing" : "add_sitting", line: "b2" };
}
