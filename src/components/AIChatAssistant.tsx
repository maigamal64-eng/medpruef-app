"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Send, Bot, User, Loader2, Lock, RefreshCw, Flag } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import ReactMarkdown from "react-markdown";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import TurnIntoNoteButton from "@/components/TurnIntoNoteButton";
import { aiChatCopy, type AiMessageSource } from "@/components/ai-chat-copy";
import { Alert } from "@/components/ui";
import { t as tr } from "@/lib/i18n";
import { AI_CLIENT_TIMEOUT_MS, classifyAiFailure, resetClock, type AiFailure } from "@/lib/ai-chat-errors";

type Lang = "de" | "en";

interface Message {
  role: "user" | "assistant";
  content: string;
  /** Assistant messages only: a real AI answer, the bank's own explanation, or app notice copy. */
  source?: AiMessageSource;
}

interface AIChatAssistantProps {
  /** UX-4 (2026-07-04): the assistant is now an INLINE tab panel, not an
   * overlay drawer. `active` = the KI tab is currently selected; generation
   * kicks off on first activation. The parent keeps the panel mounted (hidden)
   * across tab switches so the chat survives; state resets on question change. */
  active: boolean;
  lang: Lang;
  questionId: number;
  questionText: string;
  answerText: string;
  explanation?: string;
  topic: string;
  options?: { text: string; correct: boolean }[];
  userTier?: string;
  /** Session `user.role` — honoured alongside `userTier` so admins get
   * Pro-level AI-chat access even when their tier is `'free'` / `null`.
   * Added 2026-04-24. */
  userRole?: string;
  /** Opens the question report form (TR-30). Omitted where reporting is hidden. */
  onReport?: () => void;
}

export default function AIChatAssistant({
  active,
  lang,
  questionId,
  questionText,
  // answerText and options were used by the former client-side buildSystemContext().
  // Context is now built server-side from questionId, so they are accepted in the
  // interface for callers' convenience but not consumed here.
  answerText: _answerText,
  explanation,
  topic,
  options: _options,
  userTier = "free",
  userRole = "user",
  onReport,
}: AIChatAssistantProps) {
  const copy = aiChatCopy(lang);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // UX-PRA-28: a failure is a system state (Alert), never an assistant bubble.
  const [failure, setFailure] = useState<{ failure: AiFailure; phase: "load" | "send" } | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [cachedExplanation, setCachedExplanation] = useState<string | null>(null);
  // True only when the displayed assistant content is a REAL explanation (cache
  // hit or a successful generation) — never for the tier/placeholder/error copy.
  // Gates the "save as flash-note" button so we never save a placeholder.
  const [hasRealExplanation, setHasRealExplanation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // BUG-2 latch: once we know the user is Pro, stay "can type" for the whole
  // session even if a later useUserTier re-fetch transiently flips isLoading.
  // Without this, tierResolving toggling true would disable/skeleton the input
  // mid-session, which blurs the field and (via the questionId effect) wipes it.
  const everProRef = useRef(false);

  // Tier is sourced LIVE from /api/auth/me via useUserTier so a Pro/admin
  // never sees the upsell (FEEDBACK #3a). The passed `userTier`/`userRole`
  // props seed the first paint to avoid a flicker, but the live hook is
  // authoritative. `tierResolving` is true until /api/auth/me answers — we
  // must NOT render the upsell/lock during that window (that was the bug:
  // the seed default 'free' flashed the upsell to an admin on a cold open).
  const { isPaid: livePaid, isLoading: tierResolving } = useUserTier();
  // Seed from props for the initial frame; once resolved, trust the hook.
  const seedPro = userRole === "admin" || userTier === "pro" || userTier === "admin";
  const isPro = tierResolving ? seedPro : livePaid;

  // Markdown renderer — the project uses Tailwind v4 without the
  // @tailwindcss/typography plugin, so `prose` classes are no-ops.
  // We render each markdown element with explicit utility classes so
  // the AI's strict-format output (TL;DR / headings / bullets / bold terms)
  // renders properly on both user and assistant bubbles, in light + dark mode.
  const markdownComponents = (role: "user" | "assistant") => {
    const isUser = role === "user";
    const strongColor = isUser ? "text-white" : "text-[var(--mp-viridian)]";
    const headingColor = isUser ? "text-white" : "text-[var(--mp-fg)]";
    const linkColor = isUser ? "text-white underline" : "text-[var(--mp-cta-blue)] underline";
    const codeBg = isUser
      ? "bg-white/20 text-white"
      : "bg-[var(--mp-border)] text-[var(--mp-fg)]";
    const blockquoteBorder = isUser ? "border-white/40" : "border-[var(--mp-viridian)]/40";
    return {
      // Mapped to the MPDS type scale (mp-h3/h4/body) so the AI
      // markdown output inherits the same display-font heading +
      // Inter-body pairing as every other surface. Previously these
      // used ad-hoc `text-sm font-display font-bold` classes which
      // drifted from the canonical ramp.
      h1: ({ children }: { children?: ReactNode }) => (
        <h3 className={`mp-h3 mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h3>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h3 className={`mp-h3 mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h3>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        // MPDS doesn't ship a dedicated mp-h4 yet; mp-ui (15px, semibold)
        // is the closest rung below mp-h3 (20px). Using mp-ui + bold
        // gives us a proper type-scale hop without introducing a new
        // token.
        <h4 className={`mp-ui font-bold mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h4>
      ),
      h4: ({ children }: { children?: ReactNode }) => (
        <h5 className={`mp-small font-semibold mt-2.5 mb-1 first:mt-0 ${headingColor}`}>{children}</h5>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        // Paragraphs inherit the wrapper's 14px + leading-relaxed so
        // chat bubbles stay compact. We keep the MPDS font stack via
        // mp-body-inline (font-family only), not the full 16px size.
        <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed" style={{ fontFamily: "var(--mp-font-body)" }}>{children}</p>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul className="my-1.5 pl-5 list-disc space-y-1 marker:text-[var(--mp-fg-subtle)]">{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol className="my-1.5 pl-5 list-decimal space-y-1 marker:text-[var(--mp-fg-subtle)]">{children}</ol>
      ),
      li: ({ children }: { children?: ReactNode }) => (
        <li className="leading-relaxed">{children}</li>
      ),
      strong: ({ children }: { children?: ReactNode }) => (
        <strong className={`font-semibold ${strongColor}`}>{children}</strong>
      ),
      em: ({ children }: { children?: ReactNode }) => (
        <em className="italic">{children}</em>
      ),
      a: ({ children, href }: { children?: ReactNode; href?: string }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" className={linkColor}>{children}</a>
      ),
      code: ({ children }: { children?: ReactNode }) => (
        <code className={`px-1 py-0.5 rounded text-[12px] font-mono ${codeBg}`}>{children}</code>
      ),
      pre: ({ children }: { children?: ReactNode }) => (
        <pre className={`my-2 p-2.5 rounded-lg overflow-x-auto text-[12px] font-mono ${codeBg}`}>{children}</pre>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className={`my-2 pl-3 border-l-2 italic ${blockquoteBorder}`}>{children}</blockquote>
      ),
      hr: () => <hr className="my-3 border-[var(--mp-border)]" />,
    };
  };

  // Auto-generate or load cached explanation on FIRST activation of the tab.
  useEffect(() => {
    if (!active) return;
    if (initialized) return;
    setInitialized(true);
    setMessages([]);
    trackEvent("ai_chat_open", { topic, questionId });
    loadOrGenerateExplanation();
  }, [active, questionId, initialized, topic]);  // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE (UX-4): no reset-on-close anymore — the parent keeps this panel
  // mounted across tab switches so the conversation + draft input survive.
  // State resets only when the QUESTION changes (below).

  // Reset when the bound question changes (parent switches questionId) —
  // the next activation regenerates for the new question.
  useEffect(() => {
    setInitialized(false);
    setMessages([]);
    setInput("");
    setCachedExplanation(null);
    setHasRealExplanation(false);
    setFailure(null);
  }, [questionId]);

  // Scroll to bottom on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Explanation cache entries now carry their source locale. Translate only
  // when a cache hit differs from the selected UI language, in either
  // direction. On failure, show the original text instead of blocking chat.
  const maybeTranslateToUiLang = async (text: string, sourceLang: Lang): Promise<string> => {
    if (sourceLang === lang) return text;
    try {
      // Read an existing translation first. This is free for every tier and
      // avoids showing a stale-language explanation when its translation is
      // already cached.
      const cacheRes = await fetch(`/api/translate?questionId=${questionId}&field=ai_explanation`);
      if (cacheRes.ok) {
        const cache = await cacheRes.json();
        const translated = cache.translations?.[lang];
        if (typeof translated === "string" && translated.trim()) return translated;
      }
      // Creating a new translation consumes the free user's daily allowance,
      // so only Pro accounts generate it automatically. Free users can use
      // the explicit translation action.
      if (!isPro) return text;
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, field: "ai_explanation", lang }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.translatedText && d.translatedText.trim()) return d.translatedText;
      }
    } catch {
      // Translation unavailable (quota / outage): keep the original text.
    }
    return text;
  };

  const loadOrGenerateExplanation = async (forceRegenerate = false) => {
    setLoading(true);
    setFailure(null);
    setHasRealExplanation(false);
    try {
      // Try to load cached explanation from DB first, unless regenerating
      if (!forceRegenerate) {
        try {
          const cacheRes = await fetch(`/api/ai-chat?questionId=${questionId}`);
          if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            if (cacheData.cached && cacheData.explanation) {
              // FEEDBACK #3c: most rows were cached from German requests, so an
              // EN user reading a cache hit would get German prose. When the UI
              // language is not German, translate the cached explanation through
              // /api/translate (cached per-lang in question_translations — free
              // after the first time). Only the AI PROSE is translated; the
              // question/options stay German (that is the exam). Falls back to
              // the German text if translation is unavailable.
              const sourceLang: Lang = cacheData.lang === "en" ? "en" : "de";
              const shown = await maybeTranslateToUiLang(cacheData.explanation, sourceLang);
              setCachedExplanation(shown);
              setMessages([{ role: "assistant", content: shown, source: "ai" }]);
              setHasRealExplanation(true);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Cache read failed — fall through.
        }
      }

      // 2026-04-24 triage fix — feedback #33 ("Die KI funktioniert überhaupt nicht.")
      //
      // BEFORE: when no cache exists, free users hit POST /api/ai-chat,
      // which returns 402. The old fallback read "KI-Assistent ist
      // momentan nicht verfügbar." — that reads like a server outage,
      // not a tier gate, and users filed "AI is broken" feedback.
      //
      // AFTER: for free users with no cached AI explanation, we show
      // the question's static `explanation` (the one written into the
      // DB at import time) as the assistant's opener, and let the
      // Pro-upsell card in the footer carry the "ask your own question"
      // pitch. No silent 402, no "unavailable" copy.
      if (!isPro && !forceRegenerate) {
        const fromBank = !!(explanation && explanation.trim().length > 0);
        const fallback = fromBank ? explanation! : copy.noCache;
        setCachedExplanation(fallback);
        setMessages([{ role: "assistant", content: fallback, source: fromBank ? "bank" : "notice" }]);
        return;
      }

      // Generate new explanation (or regenerate over an existing one for pro users).
      // Context (question stem, choices, correct answer) is built server-side from
      // questionId — the client no longer sends a system prompt so it cannot
      // poison the globally-cached explanation.
      const userPrompt = copy.firstPrompt;

      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        timeoutMs: AI_CLIENT_TIMEOUT_MS,
        body: JSON.stringify({
          messages: [{ role: "user", content: userPrompt }],
          questionId,
          lang,
          regenerate: forceRegenerate,
        }),
      });

      if (!response.ok && response.status !== 402) {
        const body = await response.json().catch(() => null);
        setFailure({ failure: classifyAiFailure({ status: response.status, body, retryAfterHeader: response.headers.get("Retry-After") }), phase: "load" });
        return;
      }
      if (!response.ok) {
        // Distinguish tier/paywall (402) from rate-limit (429) from a
        // true outage (5xx) so the copy matches reality. The audit
        // (2026-04-24) confirmed "nicht verfügbar" reads as a bug —
        // each branch below must name the actual reason.
        const is402 = response.status === 402;
        const is429 = response.status === 429;
        let content: string;
        if (is402) {
          content = copy.paywall;
          // Event — so we can measure paywall-hit rate per free user
          // and verify the copy change actually reduces "KI funktioniert
          // nicht" feedback.
          try {
            trackEvent("ai_chat_paywall_shown", { questionId, reason: "tier_gate" });
          } catch {}
        } else if (is429) {
          content = copy.dailyLimit;
        } else {
          content = copy.techProblem;
        }
        setMessages([{ role: "assistant", content, source: "notice" }]);
        return;
      }

      const data = await response.json();
      const reply = data.reply || data.content || "...";
      setCachedExplanation(reply);
      setMessages([{ role: "assistant", content: reply, source: "ai" }]);
      setHasRealExplanation(true);
    } catch (err) {
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setFailure({ failure: classifyAiFailure({ offline: typeof navigator !== "undefined" && navigator.onLine === false, timedOut }), phase: "load" });
    } finally {
      setLoading(false);
    }
  };

  // Retry resets the latch: the next attempt reloads the cache first.
  const retryFailure = () => {
    const phase = failure?.phase;
    setFailure(null);
    if (phase === "send") void handleSend();
    else void loadOrGenerateExplanation(false);
  };

  const handleRegenerate = async () => {
    if (!isPro || loading) return;
    await loadOrGenerateExplanation(true);
  };

  const lastSent = useRef("");
  const handleSend = async () => {
    const text = (input.trim() || (failure?.phase === "send" ? lastSent.current : "")).trim();
    if (!text || loading) return;
    if (!isPro) return;

    setInput("");
    setFailure(null);
    lastSent.current = text;
    const base = messages.length && messages[messages.length - 1].role === "user" && messages[messages.length - 1].content === text ? messages.slice(0, -1) : messages;
    const newMessages = [...base, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setLoading(true);
    trackEvent("ai_chat_message", { messageLength: text.length, topic, questionId });

    try {
      // questionId lets the server fetch the question context for this follow-up.
      // Cache-write is skipped server-side for multi-turn messages (sanitized.length > 1).
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          questionId,
          lang,
        }),
        timeoutMs: AI_CLIENT_TIMEOUT_MS,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setMessages(base);
        setInput(text);
        setFailure({ failure: classifyAiFailure({ status: response.status, body, retryAfterHeader: response.headers.get("Retry-After") }), phase: "send" });
        return;
      }
      const data = await response.json();
      const replyText = data.reply || data.content;
      setMessages([...newMessages, replyText
        ? { role: "assistant", content: replyText, source: "ai" }
        : { role: "assistant", content: copy.sendError, source: "notice" }]);
    } catch (err) {
      // The typed question comes back into the input (UX-PRA-28).
      setMessages(base);
      setInput(text);
      const timedOut = err instanceof DOMException && err.name === "TimeoutError";
      setFailure({ failure: classifyAiFailure({ offline: typeof navigator !== "undefined" && navigator.onLine === false, timedOut }), phase: "send" });
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // UX-4 (2026-07-04): render as an INLINE tab panel where the KI tab is, not
  // an overlay drawer (the desktop side-drawer was the rejected pattern). The
  // question and the tabs stay visible; the chat lives in the normal page flow
  // with its own internal scroll area.
  return (
    <div className="rounded-[var(--mp-r-card)] border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] overflow-hidden flex flex-col max-h-[560px]">
      {/* Status strip + regenerate control */}
      <div className="px-5 py-2.5 border-b border-[var(--mp-border-subtle)] flex items-center justify-between gap-3 bg-[var(--mp-surface-sunken)] flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--mp-accent-teal)] to-[var(--mp-cta-blue)] flex items-center justify-center flex-shrink-0">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--mp-fg)] min-w-0">
              <span className="truncate">{copy.title}</span>
              <span data-ai-badge className="inline-flex items-center rounded border border-[var(--mp-border)] px-1 text-[10px] font-bold leading-4 text-[var(--mp-fg-muted)]">{copy.badge}</span>
            </div>
            <div className="text-[11px] text-[var(--mp-fg-muted)]">
              {loading && !cachedExplanation ? copy.generating : cachedExplanation ? copy.ready : failure ? tr("a23_ai_not_loaded", lang) : copy.loading}
            </div>
          </div>
        </div>
        {cachedExplanation && !loading && (
          isPro ? (
            <button
              onClick={handleRegenerate}
              className="p-1.5 rounded-lg text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-raised)] transition-colors"
              title={copy.regenerate}
              aria-label={copy.regenerate}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          ) : (
            <span
              className="p-1.5 rounded-lg text-[var(--mp-fg-subtle)] cursor-not-allowed"
              title={copy.regenerateLocked}
              aria-label={copy.regenerateLocked}
            >
              <Lock className="w-4 h-4" />
            </span>
          )
        )}
      </div>

      {/* Messages — the panel's own scroll area (inline, so the page doesn't grow unbounded) */}
      <div className="px-5 py-4 space-y-4 flex-1 min-h-[120px] overflow-y-auto" role="log" aria-live="polite" aria-label={tr("a23_ai_log", lang)}>
        {failure && (() => {
          const f = failure.failure;
          const clock = resetClock(f.resetAt, lang === "de" ? "de-AT" : "en-GB");
          const line = f.kind === "offline" ? tr("a23_ai_err_offline", lang)
            : f.kind === "timeout" ? tr("a23_ai_err_timeout", lang)
            : f.kind === "burst" ? tr("a23_ai_err_burst", lang)
            : f.kind === "daily_limit" ? (clock ? tr("a23_ai_err_daily_at", lang).replace("{time}", clock) : tr("a23_ai_err_daily", lang))
            : f.kind === "monthly_limit" ? tr("a23_ai_err_monthly", lang)
            : f.kind === "plan" ? tr("a23_ai_err_plan", lang)
            : f.kind === "server" ? tr("a23_ai_err_server", lang)
            : tr("a23_ai_err_network", lang);
          return (
            <Alert variant={f.retryable ? "error" : "warning"}>
              <span className="block">{line}</span>
              <span className="mt-2 flex flex-wrap gap-2">
                {f.retryable && (
                  <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={retryFailure}>{tr("request_retry", lang)}</button>
                )}
                {f.kind === "plan" && (
                  <a href="/pricing?gate=ai_chat" className="mp-btn mp-btn--primary min-h-11">{tr("practice_see_plans", lang)}</a>
                )}
              </span>
            </Alert>
          );
        })()}
        {messages.map((msg, i) => (
          <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
              msg.role === "user" ? "bg-[var(--mp-cta-blue)]/10" : "bg-[var(--mp-viridian)]/10"
            }`}>
              {msg.role === "user"
                ? <User className="w-4 h-4 text-[var(--mp-cta-blue)]" />
                : <Bot className="w-4 h-4 text-[var(--mp-viridian)]" />
              }
            </div>
            <div className={`flex flex-col gap-1.5 max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {msg.role === "assistant" && msg.source === "bank" && (
                <p className="text-[11px] font-medium text-[var(--mp-fg-muted)]">{copy.bankLabel}</p>
              )}
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--mp-cta-blue)] text-white rounded-tr-sm"
                  : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] rounded-tl-sm border border-[var(--mp-border)]"
              }`}>
                <ReactMarkdown components={markdownComponents(msg.role)}>{msg.content}</ReactMarkdown>
              </div>
              {/* TR-30: every real AI answer says it is AI and can be wrong, with a one-tap report. */}
              {msg.role === "assistant" && msg.source === "ai" && (
                <p data-ai-trust className="flex flex-wrap items-center gap-x-2 text-[12px] leading-snug text-[var(--mp-fg-muted)]">
                  <span>{copy.trustLine}</span>
                  {onReport && (
                    <button
                      type="button"
                      onClick={() => { trackEvent("feature_use", { feature: "ai_chat_report_click", questionId }); onReport(); }}
                      aria-label={copy.reportAria}
                      className="inline-flex min-h-11 items-center gap-1 font-medium text-[var(--mp-cta-blue)] underline underline-offset-2"
                    >
                      <Flag className="h-3.5 w-3.5" aria-hidden />
                      {copy.report}
                    </button>
                  )}
                </p>
              )}
              {/* Turn any real AI answer into a flash-note (skip placeholder / error copy). */}
              {msg.role === "assistant" && msg.source === "ai" && hasRealExplanation && msg.content.length > 40 && (
                <TurnIntoNoteButton
                  kind="ai_explanation"
                  lang={lang}
                  sourceRef={{ question_id: questionId, message_id: String(i) }}
                  text={msg.content}
                  topic={topic}
                  size="sm"
                  allowCustomize={false}
                />
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--mp-viridian)]/10 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-[var(--mp-viridian)]" />
            </div>
            <div className="bg-[var(--mp-surface-sunken)] rounded-2xl rounded-tl-sm px-4 py-3 border border-[var(--mp-border)]">
              <Loader2 className="w-4 h-4 text-[var(--mp-viridian)] animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input row — a fixed footer of the inline panel (below the scroll area) */}
      <div className="px-4 py-3 border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex-shrink-0">
        {/* BUG-2 fix (2026-07-04): ONE always-mounted input across every tier
            state. Previously the render SWAPPED between a skeleton, the real
            input, and a disabled upsell input keyed on tierResolving/isPro, so
            any useUserTier re-fetch (mount / tab-return / 5-min poll) remounted
            the input mid-typing, dropping focus AND wiping the text via the
            questionId reset effect. A single, latched element means the node is
            never replaced or disabled mid-session, so focus + text survive. */}
        {(() => {
          if (isPro) everProRef.current = true;
          const knownPro = everProRef.current;
          const resolving = tierResolving && !seedPro && !knownPro;
          const canType = knownPro; // once Pro, always typeable this session
          return (
            <>
              {!knownPro && !resolving && (
                <div
                  className="mp-card p-4 mb-3"
                  style={{
                    background: "var(--mp-surface-raised)",
                    borderColor: "color-mix(in srgb, var(--mp-viridian) 35%, transparent)",
                    borderLeft: "4px solid var(--mp-viridian)",
                  }}
                  role="note"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[var(--mp-viridian)]/15 flex items-center justify-center flex-shrink-0">
                      <Lock className="w-4 h-4 text-[var(--mp-viridian)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="mp-h3 text-[15px] leading-tight mb-1.5 text-[var(--mp-fg)]">
                        {copy.upsellTitle}
                      </h3>
                      <p className="mp-body text-[13px] leading-snug text-[var(--mp-fg)] mb-3">
                        {copy.upsellBody}
                      </p>
                      <a
                        href="/pricing"
                        className="mp-btn mp-btn--success mp-btn--sm"
                        onClick={() => trackEvent("feature_use", { feature: "ai_chat_pro_upsell_click", questionId })}
                      >
                        {copy.upsellCta}
                      </a>
                    </div>
                  </div>
                </div>
              )}
              <div className={`flex items-center gap-2 ${canType ? "" : "opacity-70"}`}>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    const isSend =
                      (e.key === "Enter" && !e.shiftKey) ||
                      ((e.metaKey || e.ctrlKey) && e.key === "Enter");
                    if (isSend && canType) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={
                    resolving
                      ? "…"
                      : canType
                        ? copy.placeholder
                        : copy.placeholderLocked
                  }
                  aria-label={copy.inputAria}
                  className="flex-1 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/50 disabled:cursor-not-allowed disabled:text-[var(--mp-fg-subtle)]"
                  disabled={loading || !canType}
                />
                <button
                  onClick={canType ? handleSend : undefined}
                  disabled={!canType || !input.trim() || loading}
                  aria-label={
                    canType
                      ? copy.send
                      : copy.sendLocked
                  }
                  className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)] text-white flex items-center justify-center hover:bg-[var(--mp-accent-teal)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[var(--mp-surface-sunken)] disabled:text-[var(--mp-fg-subtle)]"
                >
                  {canType ? <Send className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                </button>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
