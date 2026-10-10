"use client";

/**
 * The Mentor chat screen (/mentor and /mentor/chat render this same screen).
 *
 * Talks to the server only through the injected MentorApi (client.ts), so it
 * runs unchanged against fixtures until the real routes ship. It never shows
 * money: credits and "about N messages" only. Every server error code and
 * every usage state has copy (see view-model.ts and i18n-mentor.ts).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Brain, Plus, BookOpen, ListChecks, Lightbulb } from "lucide-react";
import { Alert, EmptyState } from "@/components/ui";
import { mentorT, type MentorKey } from "@/lib/i18n-mentor";
import type { MentorLang, MentorMode, MentorUsageResponse } from "@/lib/mentor/contract";
import { loadMentorApi } from "./client";
import {
  INITIAL_CHAT_STATE,
  buildChatRequest,
  canSubmit,
  chatReducer,
  lastUserText,
  parseQuestionId,
} from "./chat-state";
import { AssistantBubble, UserBubble } from "./ChatMessage";
import Composer from "./Composer";
import CreditPill from "./CreditPill";
import ErrorNotice, { useCountdown } from "./ErrorNotice";
import MentorFrame, { useMentorSession } from "./MentorFrame";
import { defaultAnswerLang, isAnswerLang, usageView } from "./view-model";

const ANSWER_LANG_KEY = "medpruef_mentor_answer_lang";
const PACKAGES_HREF = "/mentor/packages";

type UsageLoad = { status: "loading" } | { status: "ready"; usage: MentorUsageResponse } | { status: "disabled" } | { status: "signin" } | { status: "error" };

const STARTERS: Record<MentorMode, MentorKey[]> = {
  facts: ["starter_facts_1", "starter_facts_2", "starter_facts_3"],
  study: ["starter_study_1", "starter_study_2"],
  explain: ["starter_explain_1"],
};

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export default function MentorChatScreen() {
  const session = useMentorSession();
  const lang = session.uiLang;

  const [chat, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [usage, setUsage] = useState<UsageLoad>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [focusKey, setFocusKey] = useState(0);
  const [questionId, setQuestionId] = useState<number | undefined>(undefined);
  const [mode, setMode] = useState<MentorMode>("facts");
  const [answerLang, setAnswerLang] = useState<MentorLang>("de");
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // One-time setup from the URL and storage.
  useEffect(() => {
    const q = parseQuestionId(window.location.search);
    if (q !== undefined) {
      setQuestionId(q);
      setMode("explain");
    }
  }, []);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(ANSWER_LANG_KEY);
    } catch {
      /* storage can be blocked */
    }
    setAnswerLang(isAnswerLang(stored) ? stored : defaultAnswerLang(lang));
    // Re-evaluated only when the UI language changes and nothing is stored.
  }, [lang]);

  const changeAnswerLang = (l: MentorLang) => {
    setAnswerLang(l);
    try {
      localStorage.setItem(ANSWER_LANG_KEY, l);
    } catch {
      /* ignore */
    }
  };

  const loadUsage = useCallback(async () => {
    const api = await loadMentorApi();
    const r = await api.usage();
    if (r.ok) setUsage({ status: "ready", usage: r.usage });
    else if (r.error === "mentor_disabled") setUsage({ status: "disabled" });
    else if (r.error === "unauthenticated") setUsage({ status: "signin" });
    else setUsage((prev) => (prev.status === "ready" ? prev : { status: "error" }));
  }, []);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    void loadUsage();
  }, [session.resolved, session.userId, loadUsage]);

  // Keep the newest content in view unless the learner scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && chat.messages.length > 0 && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const view = useMemo(() => (usage.status === "ready" ? usageView(usage.usage, lang) : null), [usage, lang]);
  const canBuy = usage.status === "ready" ? usage.usage.can_buy : true;
  const packagesHref = canBuy ? PACKAGES_HREF : null;

  const waitSeconds = useCountdown(blockedUntil);
  const cooling = blockedUntil !== null && waitSeconds > 0;
  const blocked = cooling || view?.canChat === false;

  const runTurn = useCallback(
    async (text: string, retry: boolean) => {
      const api = await loadMentorApi();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      stickRef.current = true;
      if (retry) dispatch({ type: "retry", assistantId: nextId("a") });
      else dispatch({ type: "send", userId: nextId("u"), assistantId: nextId("a"), text });

      const req = buildChatRequest({
        text,
        conversationId: chatRef.current.conversationId,
        lang: answerLang,
        mode,
        questionId,
      });
      const res = await api.chat(req, (event) => dispatch({ type: "event", event }), ctrl.signal);

      if (!res.ok) {
        dispatch({ type: "fail", error: res.error, retryAfterSeconds: res.retryAfterSeconds, packagesUrl: res.packagesUrl });
        if (res.error === "rate_limited" && res.retryAfterSeconds) setBlockedUntil(Date.now() + res.retryAfterSeconds * 1000);
      } else if (!ctrl.signal.aborted) {
        dispatch({ type: "end" });
      }
      abortRef.current = null;
      // Balance changes with every turn (and after 402s): re-read it.
      void loadUsage();
    },
    [answerLang, mode, questionId, loadUsage],
  );

  const send = () => {
    if (!canSubmit(draft, chat.busy) || blocked) return;
    const text = draft.trim();
    setDraft("");
    void runTurn(text, false);
  };

  const retry = () => {
    const text = lastUserText(chatRef.current);
    if (text && !chatRef.current.busy) void runTurn(text, true);
  };

  const stop = () => {
    abortRef.current?.abort();
    dispatch({ type: "stop" });
  };

  const newChat = () => {
    abortRef.current?.abort();
    dispatch({ type: "reset" });
    setBlockedUntil(null);
    setDraft("");
  };

  const pickStarter = (key: MentorKey) => {
    setDraft(mentorT(key, lang));
    setFocusKey((k) => k + 1);
  };

  const modes: MentorMode[] = questionId !== undefined ? ["explain", "facts", "study"] : ["facts", "study"];
  const empty = chat.messages.length === 0;

  const StarterIcon = mode === "study" ? ListChecks : mode === "explain" ? Lightbulb : BookOpen;

  return (
    <MentorFrame session={session}>
      <main className="main-content safe-area-top flex h-dvh flex-col overflow-hidden bg-[var(--mp-bg)]">
        <header className="border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2.5 sm:px-4 lg:px-8">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <span aria-hidden className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-oxford-blue)] text-white sm:flex">
              <Brain className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="mp-h3 truncate leading-tight text-[var(--mp-fg)]">{mentorT("page_title", lang)}</h1>
              <p className="hidden truncate text-[12px] text-[var(--mp-fg-muted)] sm:block">{mentorT("page_subtitle", lang)}</p>
            </div>
            {!empty && (
              <button type="button" onClick={newChat} className="mp-btn mp-btn--ghost min-h-11 min-w-11 !p-2" aria-label={mentorT("btn_new_chat", lang)} title={mentorT("btn_new_chat", lang)}>
                <Plus className="h-5 w-5" aria-hidden />
              </button>
            )}
            {usage.status === "ready" && <CreditPill view={view} lang={lang} href={packagesHref} />}
            {usage.status === "loading" && <CreditPill view={null} lang={lang} />}
          </div>
        </header>

        {usage.status === "disabled" ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-4">
            <div className="w-full max-w-md">
              <EmptyState
                icon={<Brain className="h-10 w-10" aria-hidden />}
                title={mentorT("err_disabled_title", lang)}
                body={mentorT("err_disabled_body", lang)}
                action={
                  <Link href="/" className="mp-btn mp-btn--primary mt-2">
                    {mentorT("btn_keep_learning", lang)}
                  </Link>
                }
              />
            </div>
          </div>
        ) : usage.status === "signin" ? (
          <div className="flex flex-1 items-center justify-center overflow-y-auto px-4">
            <div className="w-full max-w-md">
              <EmptyState
                icon={<Brain className="h-10 w-10" aria-hidden />}
                title={mentorT("page_title", lang)}
                body={mentorT("err_unauthenticated", lang)}
                action={
                  <Link href="/login?next=%2Fmentor" className="mp-btn mp-btn--primary mt-2">
                    {mentorT("btn_signin", lang)}
                  </Link>
                }
              />
            </div>
          </div>
        ) : (
          <>
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-4 lg:px-8" aria-label={mentorT("page_title", lang)}>
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                {usage.status === "error" && (
                  <ErrorNotice
                    view={{ messageKey: "err_load_failed", tone: "error", action: "retry" }}
                    lang={lang}
                    onRetry={() => {
                      setUsage({ status: "loading" });
                      void loadUsage();
                    }}
                  />
                )}

                {empty ? (
                  <section className="flex flex-col items-center px-1 pb-2 pt-6 text-center sm:pt-12">
                    <span aria-hidden className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--mp-viridian)]/25 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)]">
                      <Brain className="h-8 w-8" />
                    </span>
                    <h2 dir="auto" className="mp-h2 text-[var(--mp-fg)]">{mentorT("empty_title", lang)}</h2>
                    <p dir="auto" className="mt-2 max-w-md text-[14px] leading-relaxed text-[var(--mp-fg-muted)]">{mentorT("empty_body", lang)}</p>
                    <p className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{mentorT("starters_label", lang)}</p>
                    <ul className="flex w-full max-w-md flex-col gap-2">
                      {STARTERS[mode].map((k) => (
                        <li key={k}>
                          <button
                            type="button"
                            onClick={() => pickStarter(k)}
                            className="flex min-h-12 w-full items-start gap-2.5 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3.5 py-2.5 text-start text-[13.5px] leading-snug text-[var(--mp-fg)] shadow-[var(--shadow-xs)] transition-colors hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-surface-sunken)]"
                          >
                            <StarterIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                            <span dir="auto">{mentorT(k, lang)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : (
                  chat.messages.map((m) =>
                    m.role === "user" ? (
                      <UserBubble key={m.id} msg={m} />
                    ) : (
                      <AssistantBubble
                        key={m.id}
                        msg={m}
                        lang={lang}
                        packagesHref={packagesHref}
                        waitSeconds={waitSeconds}
                        onRetry={retry}
                        onNewChat={newChat}
                      />
                    ),
                  )
                )}
              </div>
            </div>

            {view?.banner && (
              <div className="border-t border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 pt-2 sm:px-4 lg:px-8">
                <div className="mx-auto w-full max-w-3xl">
                  <Alert variant={view.banner.tone === "warning" ? "warning" : "info"} title={mentorT(view.banner.titleKey, lang)}>
                    <p dir="auto" className="text-[13px] leading-snug">{mentorT(view.banner.bodyKey, lang)}</p>
                    {view.expiryText && <p className="mt-1 text-[12px]">{view.expiryText}</p>}
                    {view.banner.offerPackages ? (
                      <Link href={PACKAGES_HREF} className="mp-btn mp-btn--primary mp-btn--sm mt-2 min-h-10">
                        {mentorT("btn_see_packages", lang)}
                      </Link>
                    ) : (
                      (usage.status === "ready" && !usage.usage.can_buy && view.tone !== "rest") && (
                        <p className="mt-1.5 text-[12px] font-medium">{mentorT("state_buy_unavailable", lang)}</p>
                      )
                    )}
                  </Alert>
                </div>
              </div>
            )}
            {!view?.banner && view?.expiryText && (
              <div className="bg-[var(--mp-surface-raised)] px-3 pt-2 text-center text-[12px] text-[var(--mp-fg-muted)] sm:px-4 lg:px-8">{view.expiryText}</div>
            )}

            <Composer
              lang={lang}
              draft={draft}
              onDraft={setDraft}
              mode={mode}
              modes={modes}
              onMode={setMode}
              answerLang={answerLang}
              onAnswerLang={changeAnswerLang}
              busy={chat.busy}
              blocked={blocked}
              onSend={send}
              onStop={stop}
              autoFocusKey={focusKey}
            />
          </>
        )}
      </main>
    </MentorFrame>
  );
}
