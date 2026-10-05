"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Send, Bot, User, Loader2, Lock, RefreshCw } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import ReactMarkdown from "react-markdown";
import { authFetch as fetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import TurnIntoNoteButton from "@/components/TurnIntoNoteButton";

type Lang = "de" | "en";

interface Message {
  role: "user" | "assistant";
  content: string;
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
}: AIChatAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
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
              setMessages([{ role: "assistant", content: shown }]);
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
        const fallback =
          (explanation && explanation.trim().length > 0)
            ? explanation
            : lang === "de"
              ? "Für diese Frage ist noch keine KI-Erklärung hinterlegt. Sobald ein Pro-Nutzer sie anfragt, ist sie auch für dich kostenlos sichtbar."
              : "There is no AI explanation cached for this question yet. As soon as a Pro user requests one, it becomes free to read for you too.";
        setCachedExplanation(fallback);
        setMessages([{ role: "assistant", content: fallback }]);
        return;
      }

      // Generate new explanation (or regenerate over an existing one for pro users).
      // Context (question stem, choices, correct answer) is built server-side from
      // questionId — the client no longer sends a system prompt so it cannot
      // poison the globally-cached explanation.
      const userPrompt = lang === "de"
        ? "Erkläre diese Frage und warum die richtige Antwort korrekt ist. Gehe auch kurz auf die falschen Antworten ein."
        : "Explain this question and why the correct answer is right. Briefly address why the other options are wrong.";

      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: userPrompt }],
          questionId,
          lang,
          regenerate: forceRegenerate,
        }),
      });

      if (!response.ok) {
        // Distinguish tier/paywall (402) from rate-limit (429) from a
        // true outage (5xx) so the copy matches reality. The audit
        // (2026-04-24) confirmed "nicht verfügbar" reads as a bug —
        // each branch below must name the actual reason.
        const is402 = response.status === 402;
        const is429 = response.status === 429;
        let content: string;
        if (is402) {
          content = lang === "de"
            ? "Diese Frage hat noch keine KI-Erklärung. Die automatische KI-Generierung ist Teil von MedPrüf Pro, sobald ein Pro-Nutzer sie anfragt, wird sie für dich kostenlos sichtbar. [Mehr erfahren](/pricing?gate=ai_chat)"
            : "This question has no AI explanation yet. Automatic AI generation is part of MedPrüf Pro; as soon as a Pro user requests one, it becomes free for you to read. [Learn more](/pricing?gate=ai_chat)";
          // Event — so we can measure paywall-hit rate per free user
          // and verify the copy change actually reduces "KI funktioniert
          // nicht" feedback.
          try {
            trackEvent("ai_chat_paywall_shown", { questionId, reason: "tier_gate" });
          } catch {}
        } else if (is429) {
          content = lang === "de"
            ? "Du hast das Tages-Limit für die KI-Erklärungen erreicht. Es wird nach Mitternacht UTC zurückgesetzt."
            : "You've reached the daily limit for AI explanations. It resets after midnight UTC.";
        } else {
          content = lang === "de"
            ? "Technisches Problem bei der KI-Generierung. Die Frage und die statische Erklärung funktionieren weiter, bitte melde den Fehler über das Feedback-Icon, falls er mehrfach auftritt."
            : "Technical problem generating the AI answer. The question and its static explanation still work; please report via the feedback icon if the issue persists.";
        }
        setMessages([{ role: "assistant", content }]);
        return;
      }

      const data = await response.json();
      const reply = data.reply || data.content || "...";
      setCachedExplanation(reply);
      setMessages([{ role: "assistant", content: reply }]);
      setHasRealExplanation(true);
    } catch {
      setMessages([{
        role: "assistant",
        content: lang === "de"
          ? "Verbindungsfehler. Bitte versuche es später erneut."
          : "Connection error. Please try again later.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!isPro || loading) return;
    await loadOrGenerateExplanation(true);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!isPro) return;

    setInput("");
    const newMessages = [...messages, { role: "user" as const, content: text }];
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
      });

      if (!response.ok) throw new Error("API error");
      const data = await response.json();
      setMessages([...newMessages, { role: "assistant", content: data.reply || data.content || "..." }]);
    } catch {
      setMessages([...newMessages, {
        role: "assistant",
        content: lang === "de" ? "Fehler beim Senden." : "Error sending.",
      }]);
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
            <div className="text-[11px] font-semibold text-[var(--mp-fg)] truncate">
              {lang === "de" ? "MedPrüf Assistent" : "MedPrüf Assistant"}
            </div>
            <div className="text-[10px] text-[var(--mp-fg-muted)]">
              {loading && !cachedExplanation
                ? (lang === "de" ? "Generiere…" : "Generating…")
                : cachedExplanation
                  ? (lang === "de" ? "Bereit" : "Ready")
                  : (lang === "de" ? "Lade…" : "Loading…")}
            </div>
          </div>
        </div>
        {cachedExplanation && !loading && (
          isPro ? (
            <button
              onClick={handleRegenerate}
              className="p-1.5 rounded-lg text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-raised)] transition-colors"
              title={lang === "de" ? "Neu generieren" : "Regenerate"}
              aria-label={lang === "de" ? "Neu generieren" : "Regenerate"}
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          ) : (
            <span
              className="p-1.5 rounded-lg text-[var(--mp-fg-subtle)] cursor-not-allowed"
              title={lang === "de" ? "Pro-Feature: Erklärung neu generieren" : "Pro feature: regenerate explanation"}
              aria-label={lang === "de" ? "Pro-Feature: Erklärung neu generieren" : "Pro feature: regenerate explanation"}
            >
              <Lock className="w-4 h-4" />
            </span>
          )
        )}
      </div>

      {/* Messages — the panel's own scroll area (inline, so the page doesn't grow unbounded) */}
      <div className="px-5 py-4 space-y-4 flex-1 min-h-[120px] overflow-y-auto">
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
              <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[var(--mp-cta-blue)] text-white rounded-tr-sm"
                  : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] rounded-tl-sm border border-[var(--mp-border)]"
              }`}>
                <ReactMarkdown components={markdownComponents(msg.role)}>{msg.content}</ReactMarkdown>
              </div>
              {/* Turn any real AI answer into a flash-note (skip placeholder / error copy). */}
              {msg.role === "assistant" && hasRealExplanation && msg.content.length > 40 && (
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
                        {lang === "de" ? "Interaktive Rückfragen mit Pro" : "Interactive follow-ups with Pro"}
                      </h3>
                      <p className="mp-body text-[13px] leading-snug text-[var(--mp-fg)] mb-3">
                        {lang === "de" ? (
                          <>
                            Diese Erklärung und alle anderen KI-Erklärungen sind für dich kostenlos.
                            Wenn du eine eigene Frage an die KI stellen willst (z.&nbsp;B. „Warum ist Option C falsch?“),
                            brauchst du Pro.
                          </>
                        ) : (
                          <>
                            This explanation and all other AI explanations are free for you.
                            If you want to ask the AI your own question (e.g.&nbsp;&quot;Why is option C wrong?&quot;),
                            you need Pro.
                          </>
                        )}
                      </p>
                      <a
                        href="/pricing"
                        className="mp-btn mp-btn--success mp-btn--sm"
                        onClick={() => trackEvent("feature_use", { feature: "ai_chat_pro_upsell_click", questionId })}
                      >
                        {lang === "de" ? "Mehr über Pro →" : "Learn about Pro →"}
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
                        ? (lang === "de" ? "Folgefrage stellen…" : "Ask a follow-up question…")
                        : (lang === "de" ? "Folgefrage stellen (Pro)…" : "Ask a follow-up question (Pro)…")
                  }
                  aria-label={lang === "de" ? "Folgefrage stellen" : "Ask a follow-up question"}
                  className="flex-1 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/50 disabled:cursor-not-allowed disabled:text-[var(--mp-fg-subtle)]"
                  disabled={loading || !canType}
                />
                <button
                  onClick={canType ? handleSend : undefined}
                  disabled={!canType || !input.trim() || loading}
                  aria-label={
                    canType
                      ? (lang === "de" ? "Folgefrage senden" : "Send follow-up question")
                      : (lang === "de" ? "Gesperrt, Pro erforderlich" : "Locked, Pro required")
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
