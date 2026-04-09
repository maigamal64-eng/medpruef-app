"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, Bot, User, Loader2 } from "lucide-react";

type Lang = "de" | "en";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface AIChatAssistantProps {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  questionText: string;
  answerText: string;
  explanation?: string;
  topic: string;
  options?: { text: string; correct: boolean }[];
}

export default function AIChatAssistant({
  open,
  onClose,
  lang,
  questionText,
  answerText,
  explanation,
  topic,
  options,
}: AIChatAssistantProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-generate initial explanation when opened
  useEffect(() => {
    if (!open || initialized) return;
    setInitialized(true);
    setMessages([]);
    generateExplanation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setInitialized(false);
      setMessages([]);
      setInput("");
    }
  }, [open]);

  // Scroll to bottom on new messages
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

Provide clear, educational explanations. Use medical terminology but explain it.
Respond in ${lang === "de" ? "German" : "English"}.
Keep responses concise but thorough. Use bullet points for clarity.`;
  };

  const generateExplanation = async () => {
    setLoading(true);
    try {
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
        }),
      });

      if (!response.ok) {
        setMessages([{
          role: "assistant",
          content: lang === "de"
            ? "KI-Assistent ist momentan nicht verfügbar. Die Erklärung wird bald hinzugefügt."
            : "AI assistant is currently unavailable. Explanation will be added soon.",
        }]);
        return;
      }

      const data = await response.json();
      setMessages([{ role: "assistant", content: data.reply || data.content || "..." }]);
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

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");

    const newMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(newMessages);
    setLoading(true);

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
        content: lang === "de" ? "Fehler beim Senden. Bitte erneut versuchen." : "Error sending. Please try again.",
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-white rounded-2xl shadow-[var(--shadow-modal)] overflow-hidden animate-scale-in flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E4E9F0] bg-gradient-to-r from-[#001B3D] to-[#003A8C]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {lang === "de" ? "KI-Assistent" : "AI Assistant"}
              </h3>
              <p className="text-[10px] text-white/60">
                {lang === "de" ? "Stelle eine Frage" : "Ask a question"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-[200px]">
          {messages.map((msg, i) => (
            <div key={i} className={`flex items-start gap-2.5 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                msg.role === "user" ? "bg-[#003A8C]/10" : "bg-[#007B5F]/10"
              }`}>
                {msg.role === "user"
                  ? <User className="w-4 h-4 text-[#003A8C]" />
                  : <Bot className="w-4 h-4 text-[#007B5F]" />
                }
              </div>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-[#003A8C] text-white rounded-tr-sm"
                  : "bg-[#F7F9FC] text-[#1A2B3C] rounded-tl-sm border border-[#E4E9F0]"
              }`}>
                <div className="whitespace-pre-line">{msg.content}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#007B5F]/10 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-[#007B5F]" />
              </div>
              <div className="bg-[#F7F9FC] rounded-2xl rounded-tl-sm px-4 py-3 border border-[#E4E9F0]">
                <Loader2 className="w-4 h-4 text-[#007B5F] animate-spin" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 py-3 border-t border-[#E4E9F0] bg-white">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={lang === "de" ? "z.B. Warum ist diese Antwort richtig?" : "e.g. Why is this answer correct?"}
              className="flex-1 bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-4 py-2.5 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50"
              disabled={loading}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-xl bg-[#007B5F] text-white flex items-center justify-center hover:bg-[#00A896] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[10px] text-[#A0AEC0] text-center mt-1.5">
            {lang === "de" ? "Enter drücken zum Senden" : "Press Enter to send"}
          </p>
        </div>
      </div>
    </div>
  );
}
