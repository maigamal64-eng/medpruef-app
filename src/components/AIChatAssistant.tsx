"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { Send, Bot, User, Loader2, Lock, RefreshCw } from "lucide-react";
import { trackEvent } from "@/lib/tracker";
import ReactMarkdown from "react-markdown";
import { authFetch as fetch } from "@/lib/authFetch";
import { BottomSheet } from "@/components/ui";

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
  answerText,
  explanation,
  topic,
  options,
  userTier = "free",
}: AIChatAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [cachedExplanation, setCachedExplanation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isPro = userTier === "pro" || userTier === "admin";

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
      h1: ({ children }: { children?: ReactNode }) => (
        <h3 className={`text-sm font-display font-bold mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h3>
      ),
      h2: ({ children }: { children?: ReactNode }) => (
        <h3 className={`text-sm font-display font-bold mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h3>
      ),
      h3: ({ children }: { children?: ReactNode }) => (
        <h4 className={`text-sm font-display font-semibold mt-3 mb-1.5 first:mt-0 ${headingColor}`}>{children}</h4>
      ),
      h4: ({ children }: { children?: ReactNode }) => (
        <h5 className={`text-[13px] font-semibold mt-2.5 mb-1 first:mt-0 ${headingColor}`}>{children}</h5>
      ),
      p: ({ children }: { children?: ReactNode }) => (
        <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>
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
  }, [questionId]);

  // Scroll to bottom on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const buildSystemContext = () => {
    const optionsText = options?.map((o, i) =>
      `${String.fromCharCode(65 + i)}. ${o.text}${o.correct ? " (CORRECT)" : ""}`
    ).join("\n") || "";

    return `You are a medical exam tutor for the Austrian Kenntnisprüfung (Vienna).
The student is studying this question:

TOPIC: ${topic}
QUESTION: ${questionText}
${optionsText ? `OPTIONS:\n${optionsText}` : ""}
CORRECT ANSWER: ${answerText}
${explanation ? `EXPLANATION: ${explanation}` : ""}

Provide clear, educational explanations in markdown format. Use medical terminology but explain it.
Respond in ${lang === "de" ? "German" : "English"}.
Use **bold** for key terms, bullet points for clarity, and structured headings.`;
  };

  const loadOrGenerateExplanation = async (forceRegenerate = false) => {
    setLoading(true);
    try {
      // Try to load cached explanation from DB first, unless regenerating
      if (!forceRegenerate) {
        try {
          const cacheRes = await fetch(`/api/ai-chat?questionId=${questionId}`);
          if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            if (cacheData.cached && cacheData.explanation) {
              setCachedExplanation(cacheData.explanation);
              setMessages([{ role: "assistant", content: cacheData.explanation }]);
              setLoading(false);
              return;
            }
          }
        } catch {
          // Cache read failed — fall through to generation.
        }
      }

      // Generate new explanation (or regenerate over an existing one for pro users)
      const systemPrompt = buildSystemContext();
      const userPrompt = lang === "de"
        ? "Erkläre diese Frage und warum die richtige Antwort korrekt ist. Gehe auch kurz auf die falschen Antworten ein."
        : "Explain this question and why the correct answer is right. Briefly address why the other options are wrong.";

      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          questionId, // For caching
          regenerate: forceRegenerate, // Server gates to pro/admin
        }),
      });

      if (!response.ok) {
        setMessages([{
          role: "assistant",
          content: lang === "de"
            ? "KI-Assistent ist momentan nicht verfügbar."
            : "AI assistant is currently unavailable.",
        }]);
        return;
      }

      const data = await response.json();
      const reply = data.reply || data.content || "...";
      setCachedExplanation(reply);
      setMessages([{ role: "assistant", content: reply }]);
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
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: buildSystemContext(),
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
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

        <div ref={messagesEndRef} />
      </div>

      {/* Input pinned to the bottom of the scroll container */}
      <div
        className="sticky bottom-0 px-4 py-3 border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]"
        style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        {isPro ? (
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
          <div
            className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[var(--mp-surface-sunken)] text-xs text-[var(--mp-fg-muted)]"
            title={lang === "de" ? "Upgrade auf Pro, um Folgefragen zu stellen" : "Upgrade to Pro to ask follow-up questions"}
          >
            <Lock className="w-3.5 h-3.5 text-[var(--mp-fg-subtle)]" />
            <span>
              {lang === "de"
                ? "Pro-Feature: Folgefragen stellen"
                : "Pro feature: ask follow-up questions"}
            </span>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}
