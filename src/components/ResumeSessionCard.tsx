"use client";
import { t, type Lang } from "@/lib/i18n";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";



interface LastSession {
  hasSession: true;
  topic: string;
  examType: string;
  questionsInSession: number;
  lastActiveAt: string;
  lastQuestionId: number;
  suggestedQuestionId: number | null;
  staleDays: number;
}

type FetchState =
  | { status: "loading" }
  | { status: "empty" }
  | { status: "error" }
  | { status: "ready"; session: LastSession };

function formatRelative(iso: string, lang: Lang): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return t("home_just_now", lang);
  const unit = diffMin < 60 ? "minute" : diffMin < 1440 ? "hour" : "day";
  const amount = unit === "minute" ? diffMin : Math.round(diffMin / (unit === "hour" ? 60 : 1440));
  return new Intl.RelativeTimeFormat(lang === "de" ? "de-DE" : "en-US", { numeric: "always" }).format(-amount, unit);

}

interface Props {
  userId: string;
  lang: Lang;
}

export default function ResumeSessionCard({ userId, lang }: Props) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    if (!userId || userId.startsWith("guest_")) {
      setState({ status: "empty" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user/last-session");
        if (cancelled) return;
        if (res.status === 204) {
          setState({ status: "empty" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const data = (await res.json()) as LastSession;
        setState({ status: "ready", session: data });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (state.status === "loading") {
    return (
      <div
        className="mp-card relative overflow-hidden p-3.5 mb-6 animate-pulse"
        style={{ borderRadius: "var(--mp-r-card)" }}
      >
        <span
          aria-hidden
          className="absolute start-0 top-0 bottom-0"
          style={{ width: 3, background: "var(--mp-accent-teal)" }}
        />
        <div className="flex items-center gap-3">
          <div className="w-[46px] h-[46px] rounded-[13px]" style={{ background: "var(--mp-surface-sunken)" }} />
          <div className="flex-1">
            <div className="h-3.5 w-2/3 rounded mb-2" style={{ background: "var(--mp-surface-sunken)" }} />
            <div className="h-3 w-1/3 rounded" style={{ background: "var(--mp-surface-sunken)" }} />
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "empty" || state.status === "error") return null;

  const { session } = state;
  // Hide if stale > 7 days (stale user should see a different nudge)
  if (session.staleDays > 7) return null;

  const relTime = formatRelative(session.lastActiveAt, lang);
  // History suggests the topic, never a specific previously answered item.
  const resumeHref = `/quiz?topic=${encodeURIComponent(session.topic)}&examSource=${session.examType}`;

  const cfg = getTopicConfig(session.topic);
  const lastLabel = `${session.questionsInSession} ${t(session.questionsInSession === 1 ? "home_question_singular" : "questions", lang)} · ${relTime}`;

  // Blessed "Weitermachen" card (01-home.html): teal left-edge (the one
  // sanctioned decorative spark), specialty-tinted icon tile, accent specialty
  // tag, mono sub-line, CTA-blue go-button.
  return (
    <Link
      href={resumeHref}
      className="mp-card mp-focusable relative overflow-hidden mb-6 block group animate-slide-up"
      style={{ borderRadius: "var(--mp-r-card)", padding: 14 }}
      aria-label={t("home_resume_label", lang).replace("{topic}", session.topic)}
    >
      <span
        aria-hidden
        className="absolute start-0 top-0 bottom-0"
        style={{ width: 3, background: "var(--mp-accent-teal)" }}
      />
      <div className="flex items-center gap-3.5">
        <div
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            background: `color-mix(in srgb, ${cfg.color} 14%, transparent)`,
            color: cfg.color,
          }}
          aria-hidden
        >
          <TopicIcon name={cfg.icon} className="w-[23px] h-[23px]" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="uppercase font-bold"
            style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--mp-accent-text)" }}
          >
            {t("home_resume", lang)}
          </p>
          <p
            className="font-bold mt-0.5 truncate"
            style={{ fontSize: 15, color: "var(--mp-fg)" }}
            lang="de" dir="ltr" title={session.topic}
          >
            {session.topic}
          </p>
          <p
            className="mt-1 font-mono"
            style={{ fontSize: 12, color: "var(--mp-fg-muted)", fontVariantNumeric: "tabular-nums" }}
          >
            {lastLabel}
          </p>
        </div>
        <div
          className="flex items-center justify-center flex-shrink-0 group-hover:translate-x-0.5 transition-transform"
          style={{ width: 38, height: 38, borderRadius: 11, background: "var(--mp-cta-blue)", color: "#fff" }}
          aria-hidden
        >
          <ArrowRight className="w-[18px] h-[18px]" />
        </div>
      </div>
    </Link>
  );
}
