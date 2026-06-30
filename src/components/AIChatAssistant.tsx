"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Send, Bot, User, Loader2, Lock, RefreshCw } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import ReactMarkdown from "react-markdown";
import { authFetch as fetch } from "@/lib/authFetch";
import { BottomSheet } from "@/components/ui";
import { useUserTier } from "@/lib/hooks/useUserTier";
import TurnIntoNoteButton from "@/components/TurnIntoNoteButton";

type Lang = "de" | "en";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AIChatAssistantProps {
  open: boolean;
  onClose: () => void;
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

// Truncate question stem for the sheet description (fallback context).
function truncate(s: string, max = 110) {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default function AIChatAssistant({
  open,
  onClose,
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

  // Auto-generate or load cached explanation when opened.
  useEffect(() => {
    if (!open) return;
    if (initialized) return;
    setInitialized(true);
    setMessages([]);
    trackEvent("ai_chat_open", { topic, questionId });
    loadOrGenerateExplanation();
  }, [open, questionId, initialized, topic]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when closed.
  useEffect(() => {
    if (!open) {
      setInitialized(false);
      setMessages([]);
      setInput("");
      setCachedExplanation(null);
    }
  }, [open]);

  // Reset when the bound question changes mid-open (e.g. parent switches
  // questionId without closing the sheet) — the next open will regenerate
  // for the new question.
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

  // FEEDBACK #3c — when the UI is in English, translate a German-cached AI
  // explanation into English via the existing /api/translate cache. Returns the
  // German text unchanged on any failure (never blocks the panel). UI lang is
  // currently de|en; for "en" we ask /api/translate for field=ai_explanation.
  const maybeTranslateToUiLang = async (german: string): Promise<string> => {
    if (lang === "de") return german;
    // Only auto-translate for paid users. A free user has a 5/day translate
    // quota; silently spending it on every cached-explanation view would drain
    // it without the user asking. Free users still see the (German) explanation
    // for free and can translate on demand via the Übersetzen tab.
    if (!isPro) return german;
    try {
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
      // translation unavailable (quota / outage) — show the German prose.
    }
    return german;
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
              const shown = await maybeTranslateToUiLang(cacheData.explanation);
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
            ? "Diese Frage hat noch keine KI-Erklärung. Die automatische KI-Generierung ist Teil von MedPrüf Pro — sobald ein Pro-Nutzer sie anfragt, wird sie für dich kostenlos sichtbar. [Mehr erfahren](/pricing?gate=ai_chat)"
            : "This question has no AI explanation yet. Automatic AI generation is part of MedPrüf Pro — as soon as a Pro user requests one, it becomes free for you to read. [Learn more](/pricing?gate=ai_chat)";
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
            ? "Technisches Problem bei der KI-Generierung. Die Frage und die statische Erklärung funktionieren weiter — bitte melde den Fehler über das Feedback-Icon, falls er mehrfach auftritt."
            : "Technical problem generating the AI answer. The question and its static explanation still work — please report via the feedback icon if the issue persists.";
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

  const title = lang === "de" ? "KI-Erklärung" : "AI Explanation";
  // Compact description — the user already sees the full question behind
  // the sheet (that's the whole point of alt AI-chat-B), so we just show
  // topic + a short preview so the surface is labeled correctly.
  const description = `${topic} · ${truncate(questionText, 90)}`;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={title}
      description={description}
    >
      {/* Status strip + regenerate control */}
      <div className="px-5 py-2.5 border-b border-[var(--mp-border-subtle)] flex items-center justify-between gap-3 bg-[var(--mp-surface-sunken)] sticky top-0 z-10">
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

      {/* Messages */}
      <div className="px-5 py-4 space-y-4">
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
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-[var(--mp-cta-blue)] text-white rounded-tr-sm"
                : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)] rounded-tl-sm border border-[var(--mp-border)]"
            }`}>
              <ReactMarkdown components={markdownComponents(msg.role)}>{msg.content}</ReactMarkdown>
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

        {/* Turn this AI explanation into a structured flash-note (Haiku). */}
        {hasRealExplanation && !loading && (
          <div className="flex justify-center pt-1">
            <TurnIntoNoteButton
              kind="ai_explanation"
              lang={lang}
              sourceRef={{ question_id: questionId }}
              text={cachedExplanation || undefined}
              topic={topic}
            />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input pinned to the bottom of the scroll container */}
      <div
        className="sticky bottom-0 px-4 py-3 border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {tierResolving && !seedPro ? (
          // Tier not yet resolved for a non-seed-Pro user — render a calm
          // neutral input placeholder, NEVER the upsell (FEEDBACK #3a: the
          // upsell must not flash for a Pro/admin on a cold load).
          <div className="flex items-center gap-2 opacity-50" aria-hidden>
            <div className="flex-1 h-[42px] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl" />
            <div className="w-10 h-10 rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]" />
          </div>
        ) : isPro ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                const isSend =
                  (e.key === "Enter" && !e.shiftKey) ||
                  ((e.metaKey || e.ctrlKey) && e.key === "Enter");
                if (isSend) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={lang === "de" ? "Folgefrage stellen…" : "Ask a follow-up question…"}
              aria-label={lang === "de" ? "Folgefrage stellen" : "Ask a follow-up question"}
              className="flex-1 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--mp-fg)] placeholder-[var(--mp-fg-subtle)] focus:outline-none focus:border-[var(--mp-viridian)]/50"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              aria-label={lang === "de" ? "Folgefrage senden" : "Send follow-up question"}
              className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)] text-white flex items-center justify-center hover:bg-[var(--mp-accent-teal)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Educational Pro card — explains the free vs. Pro split so
                free users don't mistake the disabled input for a broken AI.
                The cached KI-Erklärung they see ABOVE this card is free;
                only interactive follow-ups require Pro.

                Dark-mode fix (review-2026-04-26-A1): --mp-success-bg now
                resolves via globals.css to color-mix(viridian 14%) which
                is a tinted-dark overlay in dark mode (was hard light
                mint). Card body now reads as readable on either theme. */}
            <div
              className="mp-card p-4"
              style={{
                // Dark-contrast fix (FEEDBACK #3b): the card sits on a SOLID
                // raised surface (guaranteed legible in both themes) with a
                // viridian left-rail accent, instead of relying on the
                // semi-transparent --mp-success-bg tint where muted body text
                // failed AA in dark mode. Body text is now --mp-fg (not muted).
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
                    {lang === "de"
                      ? "Interaktive Rückfragen mit Pro"
                      : "Interactive follow-ups with Pro"}
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

            {/* Existing disabled input — kept per spec so the chat surface still
                reads as a chat, just locked. */}
            <div className="flex items-center gap-2 opacity-60">
              <input
                type="text"
                value=""
                readOnly
                placeholder={lang === "de" ? "Folgefrage stellen (Pro)…" : "Ask a follow-up question (Pro)…"}
                aria-label={lang === "de" ? "Folgefrage stellen – Pro erforderlich" : "Ask a follow-up question – Pro required"}
                disabled
                className="flex-1 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] rounded-xl px-4 py-2.5 text-sm text-[var(--mp-fg-subtle)] placeholder-[var(--mp-fg-subtle)] cursor-not-allowed"
              />
              <button
                type="button"
                disabled
                aria-label={lang === "de" ? "Gesperrt – Pro erforderlich" : "Locked – Pro required"}
                className="w-10 h-10 rounded-xl bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-subtle)] flex items-center justify-center cursor-not-allowed border border-[var(--mp-border)]"
              >
                <Lock className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
