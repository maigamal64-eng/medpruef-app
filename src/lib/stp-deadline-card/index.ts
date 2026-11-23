/**
 * C1 of the 16 Nov growth pass: the Stichprobentest deadline card on Home.
 * Pure, `now` injected. The server route (/api/stp-deadline-card/line) reads
 * the account and calls this; nothing here typed a date, a price or a plan
 * name: dates, publishers and links come from OFFICIAL_SITTINGS, the deadline
 * words from answer-pages/copy.ts, the plan sentence from sittingFit() through
 * the sitting-link fitLine (the caller renders the plan and total).
 *
 *  - sitting: the saved exam date is a `stichprobentest` sitting of
 *    OFFICIAL_SITTINGS, none of its rows is window_unconfirmed, and at least
 *    one deadline row is today (Vienna) or later. Both rows show in the order
 *    of OFFICIAL_SITTINGS, a past row is dropped, none is picked for the learner.
 *    A paid learner gets title and rows only (no plan line, no CTA).
 *  - ask: active bank kmp_innsbruck, no exam date saved, not before ASK_FROM.
 *  - MOMENTS_ENABLED on: hidden wherever the journey engine renders its own
 *    deadline line (phase registration) or ask line (phase ask) for the learner.
 */
import { OFFICIAL_SITTINGS, bankForOfficialKey, viennaToday, type OfficialSitting } from "@/lib/exam-dates";
import { formatOfficialDate } from "@/lib/i18n-dates";
import { deadlineTypeWord } from "@/lib/answer-pages/copy";
import { publisherName } from "@/lib/publisher-names";
import { getLearnerMoments, isoDayOf } from "@/lib/journey/moments";
import { fill, sittingLinkCopy } from "@/lib/sitting-link/copy";
import { C1_ASK, C1_PLAN_CTA, C1_ROWS, C1_ROWS_ONE_LEFT, C1_TITLE, stpCardLang } from "./copy";

/** Sat 28 Nov 2026: learners with no sitting set may sit in the November weeks and stay paused until those weeks end. */
export const STP_ASK_FROM = "2026-11-28";
/** Where "Termin wählen" leads: the same target as the Home sitting prompt. */
export const STP_ASK_HREF = "/settings#exam-date";
export const STP_ASK_BANK = "kmp_innsbruck";

/** The CTA click of the plan button: target pricing and line c1 tell the read this card from other plan buttons. */
export const C1_PAYWALL_CLICK = { target: "pricing", line: "c1", gate: "full_bank" } as const;
/** The click of the ask button (not a paywall). */
export const C1_ASK_CLICK = { surface: "stp_deadline_card", cta: "choose_sitting" } as const;

export interface StpCardFit {
  plan: string;
  total: string;
}

export interface StpCardRow {
  publisher: string;
  /** What follows the linked publisher name: ": {DEADLINE_TYPE} {DATE}". */
  rest: string;
  href: string;
}

export type StpCard =
  | { state: "none" }
  | {
      state: "sitting";
      title: string;
      /** The approved sentence split at {ROWS}. */
      before: string;
      rows: StpCardRow[];
      after: string;
      /** {FIT_PLAN_LINE}, free learners only and only when fit.ts gave a plan. */
      planLine: string | null;
      /** Free learners only. */
      cta: { label: string; href: string } | null;
    }
  | { state: "ask"; body: string; cta: { label: string; href: string } };

export interface StpCardInput {
  now: Date;
  lang: string;
  /** users.exam_date (YYYY-MM-DD or a timestamp), null when none is saved. */
  examDate: string | null;
  /** users.active_exam. */
  activeExam: string | null;
  isPaid: boolean;
  /** MOMENTS_ENABLED (momentsEnabled()). */
  momentsOn: boolean;
  /** sittingFit().recommended rendered by the caller, or null (pricing v2 off). */
  fit: (sitting: { date: string; lastDay: string }) => StpCardFit | null;
  sittings?: readonly OfficialSitting[];
}

const NONE: StpCard = { state: "none" };

export function stpDeadlineCard(input: StpCardInput): StpCard {
  const sittings = input.sittings ?? OFFICIAL_SITTINGS;
  const today = viennaToday(input.now);
  const lang = stpCardLang(input.lang);
  const day = isoDayOf(input.examDate);

  if (input.momentsOn) {
    // The engine owns the deadline line (named sitting, open window) and the ask line (no named sitting).
    const phase = getLearnerMoments({ examDate: input.examDate, activeExam: input.activeExam }, input.now, sittings).phase;
    if (phase === "registration" || phase === "ask") return NONE;
  }

  if (!day) {
    if (input.activeExam !== STP_ASK_BANK || today < STP_ASK_FROM) return NONE;
    const ask = C1_ASK[lang];
    return { state: "ask", body: ask.body, cta: { label: ask.cta, href: STP_ASK_HREF } };
  }

  const rows = sittings.filter((s) => s.exam_key === "stichprobentest" && s.date === day);
  if (rows.length === 0 || rows.some((s) => s.window_unconfirmed)) return NONE;
  const open = rows.filter((s) => s.registration_closes !== null && s.registration_closes >= today);
  if (open.length === 0) return NONE;

  const first = rows[0];
  const label = (first.learner_label as Record<string, string>)[lang] ?? first.learner_label.en;
  const title = C1_TITLE[lang].replace("{SITTING_LABEL}", `${label}, ${formatOfficialDate(first.date, lang)}`);
  const sentence = (open.length > 1 ? C1_ROWS : C1_ROWS_ONE_LEFT)[lang];
  const [before, after] = sentence.split("{ROWS}");
  const cardRows: StpCardRow[] = open.map((s) => ({
    publisher: publisherName(s.publisher, lang),
    rest: `: ${deadlineTypeWord(s.deadline_type, lang)} ${formatOfficialDate(s.registration_closes as string, lang)}`,
    href: s.source_url,
  }));

  if (input.isPaid) return { state: "sitting", title, before, rows: cardRows, after, planLine: null, cta: null };

  const lastDay = first.date_end ?? first.date;
  const fit = input.fit({ date: first.date, lastDay });
  const planLine = fit ? fill(sittingLinkCopy(lang).fitLine, { plan: fit.plan, total: fit.total }) : null;
  const bank = bankForOfficialKey(first.exam_key) ?? STP_ASK_BANK;
  const q = new URLSearchParams({ gate: "full_bank", bank, sitting: first.date, sitting_end: lastDay });
  return {
    state: "sitting",
    title,
    before,
    rows: cardRows,
    after,
    planLine,
    cta: { label: C1_PLAN_CTA[lang], href: `/pricing?${q.toString()}` },
  };
}

/** Parse of the route body on the client; anything unexpected reads as "none". */
export function parseStpCard(body: unknown): StpCard {
  if (!body || typeof body !== "object") return NONE;
  const b = body as Record<string, unknown>;
  const localHref = (v: unknown): v is string => typeof v === "string" && /^\/(?![\/\\])/.test(v);
  const parseCta = (v: unknown): { label: string; href: string } | null => {
    const c = v as { label?: unknown; href?: unknown } | null;
    return c && typeof c.label === "string" && localHref(c.href) ? { label: c.label, href: c.href } : null;
  };
  if (b.state === "ask") {
    const cta = parseCta(b.cta);
    return typeof b.body === "string" && b.body && cta ? { state: "ask", body: b.body, cta } : NONE;
  }
  if (b.state !== "sitting") return NONE;
  const rows = Array.isArray(b.rows)
    ? b.rows.filter((r): r is StpCardRow => {
        const x = r as Partial<StpCardRow> | null;
        return !!x && typeof x.publisher === "string" && typeof x.rest === "string" && typeof x.href === "string" && /^https:\/\//.test(x.href);
      })
    : [];
  if (typeof b.title !== "string" || typeof b.before !== "string" || typeof b.after !== "string" || rows.length === 0) return NONE;
  const planLine = typeof b.planLine === "string" && b.planLine ? b.planLine : null;
  return { state: "sitting", title: b.title, before: b.before, rows, after: b.after, planLine, cta: parseCta(b.cta) };
}
