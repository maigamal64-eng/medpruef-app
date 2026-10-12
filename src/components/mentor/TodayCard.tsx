"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CalendarDays } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { buildQuizHref } from "@/lib/quiz-links";
import { classifyTopics, THIN_FIRST_QUESTIONS } from "@/lib/weak-topics";
import { a39T } from "./a39-copy";

export interface TodayData {
  exam: string | null;
  daysLeft: number | null;
  weak: { topic: string; pct: number } | null;
  thin: boolean;
  due: number | null;
}

/** Whole Vienna calendar days from today to an exam date (YYYY-MM-DD); null if past or invalid. */
export function viennaDaysUntil(date: string | null, now: Date = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna" }).format(now);
  const days = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

interface TopicRow { topic?: unknown; answered?: unknown; lastCorrectSample?: unknown; lastCorrectPct?: unknown }

/** Pure: the card's content from the learner's own reads (shared weak-topic rule, MUX-68). */
export function todayData(study: { activeExam?: unknown; examDate?: unknown } | null, topics: TopicRow[] | null, due: { entitled?: unknown; dueToday?: unknown } | null, now: Date = new Date()): TodayData | null {
  const exam = typeof study?.activeExam === "string" ? study.activeExam : null;
  const daysLeft = viennaDaysUntil(typeof study?.examDate === "string" ? study.examDate : null, now);
  const rows = (topics ?? []).map((t) => ({
    topic: typeof t.topic === "string" ? t.topic : "",
    answered: typeof t.lastCorrectSample === "number" ? t.lastCorrectSample : 0,
    pct: typeof t.lastCorrectPct === "number" ? t.lastCorrectPct : null,
  })).filter((t) => t.topic);
  const { weak, thin } = classifyTopics(rows, { weak: 1 });
  const dueCount = due?.entitled === true && typeof due.dueToday === "number" ? due.dueToday : null;
  const w = weak[0] && weak[0].pct !== null ? { topic: weak[0].topic, pct: weak[0].pct } : null;
  if (topics === null && daysLeft === null && dueCount === null) return null;
  return { exam, daysLeft, weak: thin ? null : w, thin: topics !== null && thin, due: dueCount };
}

/**
 * MUX-51: a zero-credit "Heute" card above the starters, computed from the
 * learner's own data without the model. Hidden when nothing could be read.
 */
export default function TodayCard({ lang, onPlan }: { lang: MentorUiLang; onPlan: (draft: string) => void }) {
  const [data, setData] = useState<TodayData | null>(null);
  useEffect(() => {
    let live = true;
    const json = async (url: string) => {
      try { const r = await authFetch(url); return r.ok ? await r.json() : null; } catch { return null; }
    };
    void (async () => {
      const me = await json("/api/auth/me?include=study");
      const study = me && typeof me === "object" ? (me as { study?: { activeExam?: unknown; examDate?: unknown } }).study ?? null : null;
      const exam = typeof study?.activeExam === "string" ? study.activeExam : "kenntnispruefung";
      const [topics, due] = await Promise.all([json(`/api/user/topic-progress?examType=${encodeURIComponent(exam)}`), json("/api/user/due-summary")]);
      if (live) setData(todayData(study, Array.isArray(topics) ? topics : null, due, new Date()));
    })();
    return () => { live = false; };
  }, []);
  if (!data) return null;
  const examName = data.exam ? getExamLabel(data.exam, "short", lang) : null;
  const lines = [
    data.daysLeft !== null && examName ? a39T(data.daysLeft === 1 ? "today_day" : "today_days", lang, { n: data.daysLeft, exam: examName }) : null,
    data.weak ? a39T("today_weak", lang, { topic: data.weak.topic, pct: data.weak.pct }) : null,
    data.due !== null && data.due > 0 ? a39T("today_due", lang, { n: data.due }) : null,
  ].filter((l): l is string => !!l);
  if (!data.thin && lines.length === 0) return null;
  const practiceHref = data.thin || !data.weak ? buildQuizHref({ exam: data.exam ?? undefined, limit: THIN_FIRST_QUESTIONS }) : buildQuizHref({ exam: data.exam ?? undefined, topic: data.weak.topic, limit: 10 });
  return (
    <section data-mentor-today aria-label={a39T("today", lang)} className="w-full max-w-md rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 text-start">
      <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]"><CalendarDays className="h-3.5 w-3.5" aria-hidden />{a39T("today", lang)}</p>
      {data.thin ? <p className="mt-0.5 text-[13px] text-[var(--mp-fg)]">{a39T("today_thin", lang)}</p>
        : <ul className="mt-0.5 text-[13px] leading-snug text-[var(--mp-fg)]">{lines.map((l, i) => <li key={i} className={i > 0 ? "hidden sm:block" : ""}><bdi>{l}</bdi></li>)}</ul>}
      <div className="mt-1.5 flex flex-wrap gap-2">
        <Link href={practiceHref} className="mp-btn mp-btn--primary mp-btn--sm min-h-11">{data.thin ? a39T("today_thin_action", lang) : a39T("today_practice", lang)}</Link>
        {!data.thin && data.weak && <button type="button" className="mp-btn mp-btn--ghost mp-btn--sm min-h-11" onClick={() => onPlan(a39T("today_plan_draft", lang, { topic: data.weak!.topic }))}>{a39T("today_plan", lang)}</button>}
      </div>
    </section>
  );
}
