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
import { Brain, Plus, X } from "lucide-react";
import { EmptyState } from "@/components/ui";
import { mentorT, type MentorKey } from "@/lib/i18n-mentor";
import type { MentorLang, MentorMode, MentorUsageResponse, MentorPackageOffer, MentorChatRequest, MentorSseEvent } from "@/lib/mentor/contract";
import { loadMentorApi } from "./client";
import {
  INITIAL_CHAT_STATE,
  buildChatRequest,
  canSubmit,
  chatReducer,
  lastUserText,
  lastUserRequest,
} from "./chat-state";
import { AssistantBubble, UserBubble } from "./ChatMessage";
import Composer from "./Composer";
import MentorAvatar from "./MentorAvatar";
import CreditPill from "./CreditPill";
import ErrorNotice, { useCountdown } from "./ErrorNotice";
import MentorFrame, { useMentorSession } from "./MentorFrame";
import { defaultAnswerLang, isAnswerLang, usageView, sanitizeOffers } from "./view-model";
import { recoverMentorTurn, type MentorApi } from "./api";
import PurchaseNotice from "./PurchaseNotice";
import QuestionContextCard from "./QuestionContextCard";
import { r3T } from "./r3-copy";
import { countdownAnnouncement, parseChatCache, threadState } from "./r3-session";
import { parseMentorEntry } from "./entry";
import MentorMoreSheet from "./MentorMoreSheet";
import StarterChips from "./StarterChips";
import { r4T } from "./r4-copy";
import { shellT } from "./r1-shell-copy";
import { trackMentor, trackMentorOnce } from "./telemetry";
import { terminalNoticeRetry } from "./r2-retry";
import { rememberMentorCreditHolder } from "./useMentorAvailability";
import { exhaustedState, lowCreditText, TURN_SILENCE_MS } from "./r1-shell-state";

const ANSWER_LANG_KEY = "medpruef_mentor_answer_lang";
const PACKAGES_HREF = "/mentor/packages";

type UsageLoad = { status: "loading" } | { status: "ready"; usage: MentorUsageResponse } | { status: "disabled" } | { status: "signin" } | { status: "error" };


let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export default function MentorChatScreen() {
  const session = useMentorSession();
  const lang = session.uiLang;

  const [newChatKey, setNewChatKey] = useState(0);
  const [chat, dispatch] = useReducer(chatReducer, INITIAL_CHAT_STATE);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [usage, setUsage] = useState<UsageLoad>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [focusKey, setFocusKey] = useState(0);
  const [questionId, setQuestionId] = useState<number | undefined>(undefined);
  const entryContext = useRef<ReturnType<typeof parseMentorEntry> | null>(null);
  const eraseEpoch = useRef(0);
  const [answered, setAnswered] = useState(true);
  const [mode, setMode] = useState<MentorMode>("facts");
  const [answerLang, setAnswerLang] = useState<MentorLang>("de");
  const [blockedUntil, setBlockedUntil] = useState<number | null>(null);
  const [limitKind, setLimitKind] = useState<"minute" | "day">("minute");
  const [storageReady, setStorageReady] = useState(false);
  const countdownRef = useRef(0);
  const [paused, setPaused] = useState(false);
  const [offers, setOffers] = useState<MentorPackageOffer[]>([]);
  const [dismissedInfo, setDismissedInfo] = useState<string[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [jumpAnswer, setJumpAnswer] = useState<string | null>(null);
  const [filingUniversity, setFilingUniversity] = useState<"wien" | "graz" | "innsbruck" | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<{ request: MentorChatRequest; api: MentorApi; ctrl: AbortController; lastEventAt: number; startedAt: number; probing: boolean; onEvent: (e: MentorSseEvent) => void } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const stickRef = useRef(true);
  const scrolledAnswer = useRef<string | null>(null);
  const spokenState = useRef("");
  const previousCredits = useRef<number | null>(null);
  const coolingRef = useRef(false);

  // One-time setup from the URL and storage.
  useEffect(() => {
    try {
      const dismissed: unknown = JSON.parse(sessionStorage.getItem("medpruef_mentor_info_dismissed") ?? "[]");
      if (Array.isArray(dismissed)) setDismissedInfo(dismissed.filter((x): x is string => typeof x === "string"));
    } catch { /* storage can be blocked */ }
    const context = parseMentorEntry(window.location.search);
    entryContext.current = context;
    setAnswered(context.answered);
    setQuestionId(context.questionId);
    setMode(context.mode);
    if (context.draft) setDraft(context.draft);
  }, []);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    const key = `medpruef_mentor_${session.userId}`;
    let cached: ReturnType<typeof parseChatCache> = null;
    let deliberateEmpty = false;
    try {
      const raw = sessionStorage.getItem(`${key}_chat`);
      cached = parseChatCache(raw);
      deliberateEmpty = !!cached && cached.messages.length === 0;
      if (cached) dispatch({type:"restore",state:cached});
      setDraft(entryContext.current?.draft || sessionStorage.getItem(`${key}_draft`) || "");
      const limit = JSON.parse(sessionStorage.getItem(`${key}_limit`) ?? "null");
      if (limit && Number.isFinite(limit.until) && limit.until > Date.now()) { setBlockedUntil(limit.until); setLimitKind(limit.kind === "day" ? "day" : "minute"); countdownRef.current = Math.ceil((limit.until-Date.now())/1000); }
    } catch { /* storage is optional */ }
    setStorageReady(true);
    let cancelled = false;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    const restore = async () => {
      const epoch = eraseEpoch.current;
      if (chatRef.current.busy || deliberateEmpty) return;
      const api = await loadMentorApi();
      const state = chatRef.current;
      const pending = state.messages.at(-1);
      const request = lastUserRequest(state) ?? (cached ? lastUserRequest(cached) : undefined);
      if (pending?.role === "assistant" && pending.status === "error" && request) {
        const result = await api.result(request.client_request_id);
        if (cancelled || chatRef.current.busy || epoch !== eraseEpoch.current) return;
        if (result.ok && result.status === "in_progress") {
          if (Date.now() - (pending.startedAt ?? Date.now()) < 55_000) { clearTimeout(restoreTimer); restoreTimer = setTimeout(() => void restore(),2_500); }
          return;
        }
        if (result.ok && result.status === "complete" && result.final) {
          const final = result.final;
          dispatch({type:"restore",state:{...state,busy:false,conversationId:final.conversation_id,credits:{left:final.credits_left,estimate:final.messages_left_estimate},messages:state.messages.map(m => m.id === pending.id && m.role === "assistant" ? {...m,status:"done",final,error:undefined} : m)}});
          if (final.result !== "notice" && !final.refused) setDraft(current => current.trim() === request.message ? "" : current);
          return;
        }
        if (!result.ok) return;
      }
      const history = await api.history?.(state.conversationId ?? cached?.conversationId);
      if (!cancelled && epoch === eraseEpoch.current && !chatRef.current.busy && history?.ok && history.thread.messages.length) dispatch({type:"restore",state:threadState(history.thread)});
    };
    void restore();
    const visible = () => { if (document.visibilityState === "visible") void restore(); };
    document.addEventListener("visibilitychange", visible);
    return () => { cancelled = true; clearTimeout(restoreTimer); document.removeEventListener("visibilitychange",visible); };
  }, [session.resolved, session.userId]);
  useEffect(() => {
    if (!storageReady || !session.userId) return;
    const key = `medpruef_mentor_${session.userId}`;
    try {
      sessionStorage.setItem(`${key}_chat`, JSON.stringify({...chat,messages:chat.messages.slice(-60)}));
      sessionStorage.setItem(`${key}_draft`,draft);
      sessionStorage.setItem(`${key}_limit`, JSON.stringify({until:blockedUntil,kind:limitKind}));
    } catch { /* storage is optional */ }
  }, [chat,draft,blockedUntil,limitKind,storageReady,session.userId]);

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
    if (r.ok) {
      if (r.usage.sources.some((source) => source !== "none") || ["exhausted", "resting"].includes(r.usage.state)) rememberMentorCreditHolder(session.userId);
      setUsage({ status: "ready", usage: r.usage }); setPaused(r.usage.state === "resting");
      if (r.usage.state === "exhausted" && r.usage.can_buy) {
        const packages = await api.packages();
        if (packages.ok) setOffers(sanitizeOffers(packages.packages));
      }
    }
    else if (r.error === "mentor_disabled") setUsage({ status: "disabled" });
    else if (r.error === "unauthenticated") setUsage({ status: "signin" });
    else setUsage((prev) => (prev.status === "ready" ? prev : { status: "error" }));
  }, [session.userId]);

  useEffect(() => {
    if (!session.resolved || !session.userId) return;
    void loadUsage();
    const interval = setInterval(() => void loadUsage(), 60_000);
    const visible = () => { if (document.visibilityState === "visible") void loadUsage(); };
    document.addEventListener("visibilitychange", visible);
    return () => { clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, [session.resolved, session.userId, loadUsage]);

  useEffect(() => {
    if (usage.status !== "ready") return;
    const data = {entry: "mentor", lang: answerLang, mode, plan_source: usage.usage.sources.length > 1 ? "mixed" : usage.usage.sources[0] ?? "none"};
    trackMentorOnce(session.userId, "mentor_entry_shown", "mentor", data);
    if (usage.usage.state === "resting") trackMentorOnce(session.userId, "mentor_resting_view", "mentor", data);
    if (["none", "low", "exhausted"].includes(usage.usage.state)) trackMentorOnce(session.userId, "mentor_paywall_hit", usage.usage.state, {...data,reason: usage.usage.state});
    if (usage.usage.state === "exhausted") trackMentorOnce(session.userId, "mentor_credits_exhausted", "usage", {...data,source:"usage"});
  }, [usage, session.userId, answerLang, mode]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Learner messages and dots stick to the end. A finished answer starts at its
  // first sentence and never takes keyboard focus from the composer.
  useEffect(() => {
    const el = scrollRef.current;
    const last = chat.messages.at(-1);
    if (!el || !last) return;
    if (last.role === "assistant" && last.status === "done" && scrolledAnswer.current !== last.id) {
      scrolledAnswer.current = last.id;
      const answer = document.getElementById(`mentor-message-${last.id}`);
      if (answer) {
        answer.style.scrollMarginTop = `${headerRef.current?.offsetHeight ?? 0}px`;
        answer.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        setJumpAnswer(answer.offsetHeight > el.clientHeight ? last.id : null);
      }
      stickRef.current = false;
    } else if (last.role === "assistant" && last.status === "streaming" && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const view = useMemo(() => (usage.status === "ready" ? usageView(usage.usage, lang) : null), [usage, lang]);
  const canBuy = usage.status === "ready" && usage.usage.can_buy && usage.usage.state !== "resting" && !paused;
  const packagesHref = canBuy ? `${PACKAGES_HREF}?from=402#topup` : null;

  const waitSeconds = useCountdown(blockedUntil);
  const cooling = blockedUntil !== null && waitSeconds > 0;
  const blocked = cooling || paused || usage.status !== "ready" || view?.canChat === false;
  const exhausted = usage.status === "ready" && usage.usage.state === "exhausted" ? exhaustedState(usage.usage, offers, lang) : null;
  const blockedReason = cooling ? r3T(limitKind === "day" ? "day" : "minute", lang, { s: waitSeconds }) : paused ? shellT("rest", lang) : exhausted?.reason ?? (usage.status === "error" ? mentorT("err_load_failed", lang) : mentorT("credits_loading", lang));
  const blockedActionHref = exhausted && canBuy ? exhausted.href : null;
  const infoKind = view?.tone === "low" ? "low" : usage.status === "ready" && usage.usage.sources.includes("trial") && view?.expiryText ? "trial" : null;
  const infoText = view?.trialNoticeText ?? (usage.status === "ready" && infoKind === "low" ? lowCreditText(usage.usage, lang) : view?.expiryText ?? "");
  const dismissInfo = () => {
    if (!infoKind) return;
    const next = [...dismissedInfo, infoKind];
    setDismissedInfo(next);
    try { sessionStorage.setItem("medpruef_mentor_info_dismissed", JSON.stringify(next)); } catch { /* session storage can be blocked */ }
  };

  useEffect(() => {
    const last = chat.messages.at(-1);
    const state = cooling ? "cooling" : paused ? "resting" : last?.role === "assistant" ? `${last.id}:${last.status}:${last.phase ?? (last.inProgress ? "waiting" : "sent")}` : "idle";
    if (state !== spokenState.current) {
      spokenState.current = state;
      if (cooling) setAnnouncement(r3T(limitKind === "day" ? "day" : "minute", lang, { s: waitSeconds }));
      else if (paused) setAnnouncement(shellT("rest", lang));
      else if (coolingRef.current) setAnnouncement(shellT("resumed", lang));
      else if (last?.role === "assistant") {
        if (last.status === "streaming") setAnnouncement(last.phase ? (lang === "de" ? last.phase === "checking_sources" ? "Der Mentor prüft die offiziellen Quellen" : "Antwort wird verfasst" : last.phase === "checking_sources" ? "The mentor is checking the official sources" : "Writing the answer") : shellT(last.inProgress ? "waiting" : "thinking", lang));
        else if (last.status === "done" && last.final) setAnnouncement(`${shellT(last.final.refused ? "refused" : "complete", lang, { n: last.final.citations.length })} ${shellT("balance", lang, { n: Math.max(0, Math.floor(last.final.credits_left)) })}`);
        else if (last.status === "error") setAnnouncement(r3T("restored",lang));
      }
    }
    coolingRef.current = cooling;
  }, [chat.messages, cooling, paused, waitSeconds, lang, limitKind]);
  useEffect(() => {
    if (limitKind === "minute" && countdownAnnouncement(countdownRef.current,waitSeconds)) setAnnouncement(waitSeconds ? r3T("minute",lang,{s:waitSeconds}) : r3T("ready",lang));
    countdownRef.current = waitSeconds;
  }, [waitSeconds,limitKind,lang]);
  useEffect(() => {
    if (usage.status !== "ready") return;
    const credits = usage.usage.credits_left;
    if (previousCredits.current !== null && credits !== previousCredits.current && credits !== chat.credits?.left) setAnnouncement(shellT("balance", lang, { n: Math.max(0, Math.floor(credits)) }));
    previousCredits.current = credits;
  }, [usage, chat.credits, lang]);
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(""), 10_000);
    return () => clearTimeout(timer);
  }, [announcement]);

  useEffect(() => {
    const probe = async (visible = false) => {
      const active = activeRef.current;
      if (active && Date.now()-active.startedAt >= 8_000) dispatch({type:"slow"});
      if (active && Date.now()-active.startedAt >= 55_000) { setDraft(active.request.message); setFocusKey(k => k+1); setAnnouncement(r3T("restored",lang)); dispatch({type:"fail",error:"upstream_error",reason:"answer_timeout"}); activeRef.current = null; abortRef.current = null; active.ctrl.abort(); return; }
      if (!active || active.probing || active.ctrl.signal.aborted || (!visible && Date.now() - active.lastEventAt < TURN_SILENCE_MS)) return;
      active.probing = true;
      const result = await active.api.result(active.request.client_request_id, active.ctrl.signal);
      if (activeRef.current !== active || active.ctrl.signal.aborted) return;
      active.probing = false;
      active.lastEventAt = Date.now();
      if (result.ok && result.status === "complete" && result.final) {
        active.onEvent(result.final);
        activeRef.current = null;
        abortRef.current = null;
        active.ctrl.abort();
        void loadUsage();
      } else if (result.ok && result.status === "in_progress") active.onEvent({ type: "in_progress", client_request_id: active.request.client_request_id });
      else if (result.ok) {
        dispatch({ type: "fail", error: result.error ?? "network" });
        activeRef.current = null; abortRef.current = null; active.ctrl.abort();
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void probe(true); };
    document.addEventListener("visibilitychange", visible);
    const timer = setInterval(() => void probe(), 1_000);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", visible); };
  }, [loadUsage,lang]);

  const runTurn = useCallback(
    async (text: string, retry: boolean, universityOverride?: "wien" | "graz" | "innsbruck", provenNoticeRetry = false, explainAction?: "hint" | "solution", explainContext?: {questionId:number;hintCount:0|1|2}) => {
      const api = await loadMentorApi();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      stickRef.current = true;
      // A retry is the same learner message, including its original language,
      // context and UUID. Changing the controls cannot turn it into a new charge.
      const req = provenNoticeRetry ? terminalNoticeRetry(chatRef.current, crypto.randomUUID()) : retry ? lastUserRequest(chatRef.current) : buildChatRequest({
        text,
        conversationId: chatRef.current.conversationId,
        lang: answerLang,
        mode: explainAction ? "explain" : mode,
        questionId: explainContext?.questionId ?? questionId,
        clientRequestId: crypto.randomUUID(),
        answered,
        entry: entryContext.current?.entry ?? "nav",
        selectedOptionText: entryContext.current?.selectedOptionText,
        filingUniversity: universityOverride ?? filingUniversity,
        ...(explainAction ? { answered: false, explainAction, hintCount: explainContext?.hintCount ?? 0 } : {}),
      });
      if (!req) { abortRef.current = null; return; }
      if (!retry && !provenNoticeRetry) trackMentorOnce(session.userId, "mentor_first_message", "mentor", { entry: questionId ? "question" : "mentor", lang: answerLang, mode });
      if (retry) dispatch({ type: "retry", assistantId: nextId("a") });
      else dispatch({ type: "send", userId: nextId("u"), assistantId: nextId("a"), text, request: req });
      const onEvent = (event: MentorSseEvent) => {
        if (ctrl.signal.aborted || abortRef.current !== ctrl) return;
        if (activeRef.current?.ctrl === ctrl) activeRef.current.lastEventAt = Date.now();
        if (event.type === "final" || event.type === "error") {
          activeRef.current = null;
          if (event.type === "final" && event.result !== "notice" && !event.refused) setDraft(current => current.trim() === req.message ? "" : current);
          else { setDraft(req.message); setFocusKey(k => k+1); setAnnouncement(r3T("restored",lang)); }
        }
        if (event.type === "error" && (event.error === "ai_disabled" || event.error === "global_cap" || event.error === "mentor_resting")) setPaused(true);
        dispatch({ type: "event", event });
      };
      activeRef.current = { request: req, api, ctrl, lastEventAt: Date.now(), startedAt: Date.now(), probing: false, onEvent };
      const res = await api.chat(req, onEvent, ctrl.signal);
      if (ctrl.signal.aborted || abortRef.current !== ctrl) return;

      // A closed stream without a final may have settled on the server.
      // Read the original result before presenting a retry of that same UUID.
      if ((res.ok && !res.sawFinal && !res.sawError) || (!res.ok && res.error === "network")) {
        const recovered = await recoverMentorTurn(api, req.client_request_id, onEvent, ctrl.signal);
        if (recovered === "complete") { abortRef.current = null; void loadUsage(); return; }
        if (recovered === "aborted" || abortRef.current !== ctrl) return;
      }

      if (!res.ok) {
        setDraft(req.message); setFocusKey(k => k+1); setAnnouncement(r3T("restored",lang));
        if (res.error === "credits_required" || res.error === "credits_exhausted") { trackMentor("mentor_paywall_hit", {entry: "mentor", lang: answerLang, mode, reason: "402"}); trackMentor("mentor_credits_exhausted", {entry: "mentor", lang: answerLang, mode, source: "402"}); }
        if (res.error === "ai_disabled" || res.error === "global_cap" || res.error === "mentor_resting") setPaused(true);
        dispatch({ type: "fail", error: res.error, retryAfterSeconds: res.retryAfterSeconds, packagesUrl: res.packagesUrl, limit: res.limit, reason: res.reason, notCharged: res.notCharged, admitMinCredits: res.admitMinCredits, creditsLeft: res.creditsLeft });
        if (res.error === "rate_limited" && res.retryAfterSeconds) { setBlockedUntil(Date.now() + res.retryAfterSeconds * 1000); setLimitKind(res.limit ?? "minute"); countdownRef.current = res.retryAfterSeconds; }
      } else if (!ctrl.signal.aborted) {
        if (!res.sawFinal) { setDraft(req.message); setFocusKey(k => k+1); setAnnouncement(r3T("restored",lang)); }
        dispatch({ type: "end" });
      }
      abortRef.current = null; activeRef.current = null;
      // Balance changes with every turn (and after 402s): re-read it.
      void loadUsage();
    },
    [answerLang, mode, questionId, answered, filingUniversity, loadUsage, session.userId, lang],
  );

  const send = () => {
    if (!canSubmit(draft, chat.busy) || blocked) return;
    const text = draft.trim();
    void runTurn(text, false);
  };

  const retry = () => {
    const text = lastUserText(chatRef.current);
    if (text && !chatRef.current.busy && !paused && view?.canChat !== false) void runTurn(text, true);
  };

  // MUX-37 A: Hide never aborts the turn or frees the composer. The stream (or
  // the result recovery) keeps running; the answer lands collapsed with its
  // charged state. Focus returns to the textarea.
  const stop = () => {
    dispatch({ type: "stop" });
    setFocusKey((k) => k + 1);
  };

  const newChat = () => {
    abortRef.current?.abort();
    activeRef.current = null;
    dispatch({ type: "reset" });
    setNewChatKey((value) => value + 1);
    setDraft("");
    setFilingUniversity(undefined);
    setJumpAnswer(null);
  };

  const pickStarter = (key: MentorKey) => {
    if (blocked) return;
    setDraft(mentorT(key, lang));
    setFocusKey((k) => k + 1);
  };

  const modes: MentorMode[] = questionId !== undefined ? ["explain", "facts", "study"] : ["facts", "study"];
  const empty = chat.messages.length === 0;


  return (
    <MentorFrame session={session}>
      <main className="main-content safe-area-top flex h-[var(--mentor-visible-height,100dvh)] flex-col overflow-hidden bg-[var(--mp-bg)]">
        <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">{announcement}</div>
        <header ref={headerRef} data-mentor-header className="border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-0 sm:px-4 sm:py-1 lg:px-8">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <MentorAvatar lang={lang} className="!hidden sm:!inline-flex" />
            <div className="min-w-0 flex-1">
              <h1 className="mp-h3 leading-tight text-[var(--mp-fg)]">{mentorT("page_title", lang)}</h1>
              <p className="hidden truncate text-[12px] text-[var(--mp-fg-muted)] sm:block">{shellT("subtitle", lang)}</p>
            </div>
            {(
              <button type="button" onClick={newChat} disabled={empty || chat.busy} aria-disabled={empty || chat.busy} className="mp-btn mp-btn--ghost min-h-11 min-w-11 !p-2" aria-label={mentorT("btn_new_chat", lang)} title={mentorT("btn_new_chat", lang)}>
                <Plus className="h-5 w-5" aria-hidden /><span className="text-[12px]">{mentorT("btn_new_chat", lang)}</span>
              </button>
            )}
            <MentorMoreSheet lang={lang} busy={chat.busy} onDeleted={() => {
              eraseEpoch.current += 1;
              newChat();
              if (entryContext.current) entryContext.current.draft = "";
              try { sessionStorage.removeItem(`medpruef_mentor_${session.userId}_chat`); sessionStorage.removeItem(`medpruef_mentor_${session.userId}_draft`); } catch { /* optional cache */ }
              setAnnouncement(r4T("deleted",lang));
            }} />
            {usage.status === "ready" && <CreditPill view={view} lang={lang} href={packagesHref} details={view?.trialNoticeText ?? exhausted?.reason ?? infoText} />}
            {usage.status === "loading" && <CreditPill view={null} lang={lang} />}
          </div>
        </header>
        {!blocked && infoKind && !dismissedInfo.includes(infoKind) && <div data-mentor-info-strip className="flex h-11 min-h-11 items-center border-b border-[var(--mp-border)] bg-[var(--mp-warning-bg)] ps-3 text-[12px]">
          <p className="min-w-0 flex-1 truncate">{infoText}</p>
          <button type="button" className="flex h-11 w-11 shrink-0 items-center justify-center" aria-label={shellT("close", lang)} onClick={dismissInfo}><X className="h-4 w-4" aria-hidden /></button>
        </div>}

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
            <div ref={scrollRef} onScroll={onScroll} role="log" aria-live="off" aria-relevant="additions" className="flex-1 overflow-y-auto overscroll-contain px-1.5 py-3 sm:px-4 lg:px-8" aria-label={mentorT("page_title", lang)}>
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
                <PurchaseNotice usage={usage.status === "ready" ? usage.usage : undefined} lang={lang} />
                {questionId !== undefined && <QuestionContextCard questionId={questionId} lang={lang} onDetach={() => { setQuestionId(undefined); setMode("facts"); }} />}
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
                  <section className="flex flex-col items-center px-1 pb-2 pt-2 text-center sm:pt-6">
                    <span aria-hidden className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--mp-viridian)]/25 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] [@media(max-height:699px)]:hidden">
                      <Brain className="h-8 w-8" />
                    </span>
                    <h2 dir="auto" className="mp-h3 text-[var(--mp-fg)]">{mentorT("empty_title", lang)}</h2>
                    {questionId === undefined && <p id="mentor-explain-unavailable" className="mt-1 max-w-md text-[12px] text-[var(--mp-fg-subtle)]">{shellT("question_needed", lang)}</p>}
                    <p className="mt-2 max-w-md text-[13px] leading-snug text-[var(--mp-fg-muted)]">{r3T("disclaimer", lang)}</p>
                    {!blocked && <p className="mb-2 mt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--mp-fg-subtle)]">{mentorT("starters_label", lang)}</p>}
                    {!blocked && <StarterChips lang={lang} mode={mode} onPick={pickStarter} />}
                    {!blocked && mode === "facts" && <div className="mt-2 flex w-full max-w-md gap-2"><button type="button" className="min-h-11 flex-1 rounded-lg border border-[var(--mp-border)] px-2 text-[12px]" onClick={() => { setMode("study"); pickStarter("starter_study_1"); }}>{mentorT("starter_study_1",lang)}</button><button type="button" disabled={questionId === undefined} aria-describedby={questionId === undefined ? "mentor-explain-unavailable" : undefined} className="min-h-11 flex-1 rounded-lg border border-[var(--mp-border)] px-2 text-[12px]" onClick={() => { setMode("explain"); pickStarter("starter_explain_1"); }}>{mentorT("starter_explain_1",lang)}</button></div>}
                  </section>
                ) : (
                  chat.messages.map((m) =>
                    <div key={m.id} id={`mentor-message-${m.id}`}>
                    {m.role === "user" ? (
                      <UserBubble msg={m} lang={lang} />
                    ) : (
                      <AssistantBubble
                        msg={m}
                        lang={lang}
                        packagesHref={packagesHref}
                        waitSeconds={waitSeconds}
                        onExplainAction={action => { if (!blocked && !chatRef.current.busy) void runTurn(action === "solution" ? "Lösung zeigen" : "Noch ein Hinweis",false,undefined,false,action,{questionId:m.final!.question_id!,hintCount:m.final!.explain_hint!.hints_used}); }}
                        onRetry={retry}
                        onNewChat={newChat}
                        onRetryNotice={() => { const text = lastUserText(chatRef.current); if (text && !chatRef.current.busy && !blocked) void runTurn(text, false, undefined, true); }}
                        onRephrase={() => { setDraft(lastUserText(chatRef.current) ?? ""); setFocusKey((value) => value + 1); }}
                        learnerId={session.userId}
                        onSuggestedQuestion={(text) => { setMode("study"); setDraft(text); setFocusKey((k) => k + 1); }}
                        onChooseUniversity={(university) => {
                          if (chatRef.current.busy || blocked) return;
                          setFilingUniversity(university);
                          void runTurn(university === "wien" ? "Wien" : university === "graz" ? "Graz" : "Innsbruck", false, university);
                        }}
                      />
                    )}</div>,
                  )
                )}
              </div>
            </div>

            {jumpAnswer && <div className="pointer-events-none relative h-0"><button type="button" className="mp-btn mp-btn--secondary pointer-events-auto absolute bottom-2 end-3 min-h-11 shadow-lg" onClick={() => { const el = scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}>{shellT("end", lang)}</button></div>}

            {cooling && <div aria-hidden="true" className="px-3 text-[12px] text-[var(--mp-fg)]">{blockedReason}</div>}
            {!empty && chat.messages.filter(m => m.role === "assistant" && m.status === "done").length === 1 && <p className="px-3 text-[12px] text-[var(--mp-fg-muted)]">{r3T("remembered",lang)}</p>}
            <Composer
              hasThread={!empty}
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
              blockedReason={blockedReason}
              blockedActionHref={blockedActionHref}
              onSend={send}
              onStop={stop}
              answerHidden={(() => { const last = chat.messages[chat.messages.length - 1]; return last?.role === "assistant" && last.status === "streaming" && !!last.hidden; })()}
              conversationKey={String(newChatKey)}
              autoFocusKey={focusKey}
            />
          </>
        )}
      </main>
    </MentorFrame>
  );
}
