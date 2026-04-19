"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { Globe, Check, AlertTriangle, Lock } from "lucide-react";
import ReactMarkdown from "react-markdown";

type Lang = "de" | "en";
type Field = "ai_explanation" | "explanation";

interface TranslateButtonProps {
  questionId: number;
  /** UI language — used for the button/modal copy, NOT the translation target */
  lang: Lang;
  /** User tier — free tier is quota-limited */
  userTier?: string;
  /** Which field to translate — ai_explanation preferred, falls back to explanation */
  field: Field;
  /** Optional: preselect a target lang, e.g. from user profile */
  defaultTarget?: TargetLang;
}

type TargetLang = "ru" | "ar" | "en" | "fr" | "tr" | "uk" | "sr";

const TARGETS: { code: TargetLang; label: string; native: string; flag: string; rtl?: boolean }[] = [
  { code: "ru", label: "Russian", native: "Русский", flag: "🇷🇺" },
  { code: "ar", label: "Arabic", native: "العربية", flag: "🇸🇦", rtl: true },
  { code: "en", label: "English", native: "English", flag: "🇬🇧" },
  { code: "fr", label: "French", native: "Français", flag: "🇫🇷" },
  { code: "tr", label: "Turkish", native: "Türkçe", flag: "🇹🇷" },
  { code: "uk", label: "Ukrainian", native: "Українська", flag: "🇺🇦" },
  { code: "sr", label: "Serbian", native: "Srpski", flag: "🇷🇸" },
];

interface TranslateResponse {
  translatedText?: string;
  lang?: string;
  field?: string;
  cached?: boolean;
  error?: string;
  code?: string;
}

export default function TranslateButton({
  questionId,
  lang,
  userTier = "free",
  field,
  defaultTarget,
}: TranslateButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState<TargetLang | null>(defaultTarget ?? null);
  const [translated, setTranslated] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Reset state when the question changes
  useEffect(() => {
    setOpen(false);
    setTranslated(null);
    setErrorMsg(null);
    setQuotaHit(false);
    setTarget(defaultTarget ?? null);
  }, [questionId, defaultTarget]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handlePick = async (code: TargetLang) => {
    setTarget(code);
    setOpen(false);
    setErrorMsg(null);
    setQuotaHit(false);
    setLoading(true);
    setTranslated(null);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, lang: code, field }),
      });
      const data = (await res.json().catch(() => ({}))) as TranslateResponse;
      if (res.status === 429 || data.code === "QUOTA_EXCEEDED") {
        setQuotaHit(true);
        setErrorMsg(
          lang === "de"
            ? "Tägliches Limit erreicht — Pro freischalten für unbegrenzte Übersetzungen."
            : "Daily limit reached — upgrade to Pro for unlimited translations.",
        );
        return;
      }
      if (!res.ok || !data.translatedText) {
        setErrorMsg(
          data.error ||
            (lang === "de"
              ? "Übersetzung fehlgeschlagen. Bitte später erneut versuchen."
              : "Translation failed. Please try again."),
        );
        return;
      }
      setTranslated(data.translatedText);
      // Fire dedicated `translation` event_type so the server-side quota
      // counter in /api/translate picks it up (counts today's translations
      // for the free-tier gate). Also log a feature_use with richer data
      // for analytics dashboards.
      trackEvent("translation", { questionId, lang: code, field });
      trackEvent("feature_use", {
        feature: "translation",
        questionId,
        lang: code,
        field,
        cached: !!data.cached,
      });
    } catch (err) {
      console.error("[TranslateButton]", err);
      setErrorMsg(
        lang === "de"
          ? "Netzwerkfehler. Bitte erneut versuchen."
          : "Network error. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const activeTarget = TARGETS.find((t) => t.code === target);

  return (
    <div className="mt-3">
      {/* Trigger + dropdown */}
      <div className="relative inline-block" ref={dropdownRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-[#003A8C] bg-[#003A8C]/8 hover:bg-[#003A8C]/15 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-60"
          aria-label={lang === "de" ? "In meine Sprache übersetzen" : "Translate to my language"}
        >
          <Globe className="w-4 h-4" />
          <span>
            {activeTarget
              ? `${activeTarget.flag} ${activeTarget.native}`
              : lang === "de"
              ? "In meiner Sprache"
              : "In my language"}
          </span>
        </button>

        {open && (
          <div className="absolute z-20 mt-1 left-0 bg-white dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] rounded-xl shadow-lg py-1 min-w-[180px] animate-scale-in">
            {TARGETS.map((t) => {
              const isActive = target === t.code;
              return (
                <button
                  key={t.code}
                  onClick={() => handlePick(t.code)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-[#003A8C]/10 text-[#003A8C]"
                      : "text-[#1A2B3C] dark:text-[#E2E8F0] hover:bg-[#F7F9FC] dark:hover:bg-[#0F172A]"
                  }`}
                >
                  <span className="text-base leading-none">{t.flag}</span>
                  <span className="flex-1">{t.native}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-[#003A8C]" />}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[#4A5568] dark:text-[#A0AEC0]">
          <span className="inline-block w-3 h-3 border-2 border-[#003A8C] border-t-transparent rounded-full animate-spin" />
          <span>
            {lang === "de" ? "Übersetze…" : "Translating…"}
          </span>
        </div>
      )}

      {/* Quota error */}
      {!loading && quotaHit && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[#F4A261] bg-[#F4A261]/8 border border-[#F4A261]/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {lang === "de"
              ? "Tägliches Limit erreicht — Pro freischalten"
              : "Daily limit reached — upgrade to Pro"}
            {userTier !== "pro" && userTier !== "admin" && (
              <>
                {" "}
                <a
                  href="/pricing"
                  className="underline hover:text-[#D64545]"
                >
                  {lang === "de" ? "(Preise ansehen)" : "(see pricing)"}
                </a>
              </>
            )}
          </span>
        </div>
      )}

      {/* Other error */}
      {!loading && !quotaHit && errorMsg && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[#D64545] bg-[#D64545]/8 border border-[#D64545]/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Translated text */}
      {!loading && translated && activeTarget && (
        <div
          className="mt-3 bg-[#003A8C]/5 border border-[#003A8C]/20 border-l-4 border-l-[#003A8C] rounded p-4 animate-slide-reveal"
          dir={activeTarget.rtl ? "rtl" : "ltr"}
          lang={activeTarget.code}
        >
          <p className="text-[10px] uppercase tracking-wider text-[#003A8C] font-semibold mb-2">
            <Globe className="w-4 h-4 inline" />{" "}
            {activeTarget.flag} {activeTarget.native}
          </p>
          <div className="text-[#1A2B3C] dark:text-[#E2E8F0] leading-relaxed text-sm">
            <ReactMarkdown components={markdownComponents}>{translated}</ReactMarkdown>
          </div>
          <p className="text-[10px] text-[#A0AEC0] mt-2 italic">
            {lang === "de"
              ? "Maschinelle Übersetzung — medizinische Begriffe bleiben im Original."
              : "Machine translation — medical terms kept in the original."}
          </p>
        </div>
      )}
    </div>
  );
}

// Markdown renderer — Tailwind v4 without typography plugin, so we
// render each element with explicit utility classes (matches
// AIChatAssistant's approach).
const markdownComponents = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-sm font-display font-bold mt-3 mb-1.5 first:mt-0 text-[#001B3D] dark:text-[#E2E8F0]">{children}</h3>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h3 className="text-sm font-display font-bold mt-3 mb-1.5 first:mt-0 text-[#001B3D] dark:text-[#E2E8F0]">{children}</h3>
  ),
  h3: ({ children }: { children?: ReactNode }) => (
    <h4 className="text-sm font-display font-semibold mt-3 mb-1.5 first:mt-0 text-[#001B3D] dark:text-[#E2E8F0]">{children}</h4>
  ),
  h4: ({ children }: { children?: ReactNode }) => (
    <h5 className="text-[13px] font-semibold mt-2.5 mb-1 first:mt-0 text-[#001B3D] dark:text-[#E2E8F0]">{children}</h5>
  ),
  p: ({ children }: { children?: ReactNode }) => (
    <p className="my-1.5 first:mt-0 last:mb-0 leading-relaxed">{children}</p>
  ),
  ul: ({ children }: { children?: ReactNode }) => (
    <ul className="my-1.5 pl-5 list-disc space-y-1 marker:text-[#A0AEC0]">{children}</ul>
  ),
  ol: ({ children }: { children?: ReactNode }) => (
    <ol className="my-1.5 pl-5 list-decimal space-y-1 marker:text-[#A0AEC0]">{children}</ol>
  ),
  li: ({ children }: { children?: ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: ReactNode }) => (
    <strong className="font-semibold text-[#001B3D] dark:text-[#E2E8F0]">{children}</strong>
  ),
  em: ({ children }: { children?: ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  a: ({ children, href }: { children?: ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#003A8C] dark:text-[#00A896] underline">{children}</a>
  ),
  code: ({ children }: { children?: ReactNode }) => (
    <code className="px-1 py-0.5 rounded text-[12px] font-mono bg-[#E4E9F0] text-[#001B3D] dark:bg-[#334155] dark:text-[#E2E8F0]">{children}</code>
  ),
  pre: ({ children }: { children?: ReactNode }) => (
    <pre className="my-2 p-2.5 rounded-lg overflow-x-auto text-[12px] font-mono bg-[#E4E9F0] text-[#001B3D] dark:bg-[#334155] dark:text-[#E2E8F0]">{children}</pre>
  ),
  blockquote: ({ children }: { children?: ReactNode }) => (
    <blockquote className="my-2 pl-3 border-l-2 italic border-[#007B5F]/40">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-[#E4E9F0] dark:border-[#334155]" />,
};
