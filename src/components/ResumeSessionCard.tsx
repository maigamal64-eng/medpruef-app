"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ArrowRight, BookOpen } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";

type Lang = "de" | "en";

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
  if (diffMin < 1) return lang === "de" ? "gerade eben" : "just now";
  if (diffMin < 60)
    return lang === "de"
      ? `vor ${diffMin} Minute${diffMin === 1 ? "" : "n"}`
      : `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24)
    return lang === "de"
      ? `vor ${diffHr} Stunde${diffHr === 1 ? "" : "n"}`
      : `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
  const diffDay = Math.round(diffHr / 24);
  return lang === "de"
    ? `vor ${diffDay} Tag${diffDay === 1 ? "" : "en"}`
    : `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
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
        className="rounded-2xl p-5 mb-6 animate-pulse"
        style={{
          background: "var(--mp-surface-raised)",
          border: "1px solid var(--mp-border-subtle)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl" style={{ background: "var(--mp-border)" }} />
          <div className="flex-1">
            <div className="h-4 w-2/3 rounded mb-2" style={{ background: "var(--mp-border)" }} />
            <div className="h-3 w-1/3 rounded" style={{ background: "var(--mp-border)" }} />
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
  const resumeHref = session.suggestedQuestionId
    ? `/quiz?topic=${encodeURIComponent(session.topic)}&examSource=${session.examType}&questionId=${session.suggestedQuestionId}&autoStart=1`
    : `/quiz?topic=${encodeURIComponent(session.topic)}&examSource=${session.examType}&autoStart=1`;

  return (
    <Link
      href={resumeHref}
      className="mp-suggestion mp-suggestion--interactive mp-focusable mb-6 block group animate-slide-up"
      aria-label={lang === "de" ? `Weiter mit ${session.topic}` : `Continue with ${session.topic}`}
    >
      <div className="flex items-center gap-4">
        <div className="mp-suggestion__icon" aria-hidden>
          <BookOpen className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-[var(--mp-fg)] truncate">
              {lang === "de" ? `Weiter mit ${session.topic}` : `Continue ${session.topic}`}
            </p>
            <span
              className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full font-semibold"
              style={{
                background: "rgba(0, 123, 95, 0.14)",
                color: "var(--mp-viridian)",
                letterSpacing: "0.08em",
              }}
            >
              {lang === "de" ? "Fortsetzen" : "Resume"}
            </span>
          </div>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-1 flex items-center gap-1.5 flex-wrap">
            <Clock className="w-3 h-3" aria-hidden />
            <span>{relTime}</span>
            <span>·</span>
            <span>
              {session.questionsInSession}{" "}
              {lang === "de"
                ? session.questionsInSession === 1
                  ? "Frage zuletzt"
                  : "Fragen zuletzt"
                : session.questionsInSession === 1
                  ? "question last time"
                  : "questions last time"}
            </span>
          </p>
        </div>
        <ArrowRight
          className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0 group-hover:translate-x-0.5 transition-transform"
          aria-hidden
        />
      </div>
    </Link>
  );
}
