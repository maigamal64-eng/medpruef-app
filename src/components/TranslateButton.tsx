"use client";

import { useState, useRef, useEffect, useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; maxHeight: number; openUp: boolean } | null>(null);

  // Reset state when the question changes
  useEffect(() => {
    setOpen(false);
    setTranslated(null);
    setErrorMsg(null);
    setQuotaHit(false);
    setTarget(defaultTarget ?? null);
  }, [questionId, defaultTarget]);

  // Compute portal position when opening + on scroll/resize
  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    function recompute() {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const margin = 8;
      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const desired = 360;
      const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(desired, Math.max(160, openUp ? spaceAbove : spaceBelow));
      setMenuPos({
        top: openUp ? rect.top - margin : rect.bottom + 4,
        left: rect.left,
        maxHeight,
        openUp,
      });
    }
    recompute();
    window.addEventListener("scroll", recompute, true);
    window.addEventListener("resize", recompute);
    return () => {
      window.removeEventListener("scroll", recompute, true);
      window.removeEventListener("resize", recompute);
    };
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        (triggerRef.current && triggerRef.current.contains(t)) ||
        (dropdownRef.current && dropdownRef.current.contains(t))
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handlePick(code: TargetLang) {
    setTarget(code);
    setOpen(false);
    setErrorMsg(null);
    setQuotaHit(false);
    setLoading(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The route reads `lang` (validated against SUPPORTED_LANGS) — sending
        // `targetLang` left `lang` empty server-side, so every request 400'd
        // and the UI showed the generic "Translation failed" (FEEDBACK #4d).
        body: JSON.stringify({ questionId, field, lang: code }),
      });
      const data: TranslateResponse = await res.json().catch(() => ({}));
      if (res.ok && data.translatedText) {
        setTranslated(data.translatedText);
        trackEvent("feature_use", {
          feature: "translate_explanation",
          lang: code,
          cached: !!data.cached,
          questionId,
        });
      } else if (res.status === 429 || data.code === "quota_exceeded") {
        setQuotaHit(true);
        setTranslated(null);
      } else {
        setErrorMsg(
          lang === "de"
            ? "Übersetzung fehlgeschlagen. Bitte versuche es später erneut."
            : "Translation failed. Please try again later."
        );
        setTranslated(null);
      }
    } catch (err) {
      console.error("[TranslateButton]", err);
      setErrorMsg(
        lang === "de"
          ? "Netzwerkfehler. Bitte versuche es erneut."
          : "Network error. Please try again."
      );
      setTranslated(null);
    } finally {
      setLoading(false);
    }
  }

  const activeTarget = target ? TARGETS.find((t) => t.code === target) : null;

  return (
    <div className="mt-3">
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        disabled={loading}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-[var(--mp-cta-blue)] bg-[var(--mp-cta-blue)]/8 hover:bg-[var(--mp-cta-blue)]/15 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-60"
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

      {/* Dropdown — portaled to <body> with fixed positioning so it
          escapes any ancestor stacking context (opacity/transform
          wrappers were trapping it behind the Next Question CTA). */}
      {open && menuPos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label={lang === "de" ? "Sprache auswählen" : "Select language"}
            className="fixed z-[1000] bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-xl shadow-[var(--mp-shadow-elev)] py-1 min-w-[220px] overflow-y-auto animate-scale-in"
            style={{
              top: menuPos.openUp ? undefined : menuPos.top,
              bottom: menuPos.openUp ? window.innerHeight - menuPos.top : undefined,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {TARGETS.map((t) => {
              const isActive = target === t.code;
              return (
                <button
                  key={t.code}
                  onClick={() => handlePick(t.code)}
                  role="option"
                  aria-selected={isActive}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]"
                      : "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  }`}
                >
                  <span className="text-base leading-none">{t.flag}</span>
                  <span className="flex-1">{t.native}</span>
                  {isActive && <Check className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}

      {/* Loading spinner */}
      {loading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--mp-fg-muted)]">
          <span className="inline-block w-3 h-3 border-2 border-[var(--mp-cta-blue)] border-t-transparent rounded-full animate-spin" />
          <span>
            {lang === "de" ? "Übersetze…" : "Translating…"}
          </span>
        </div>
      )}

      {/* Quota error */}
      {!loading && quotaHit && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[var(--mp-status-warning)] bg-[var(--mp-status-warning)]/8 border border-[var(--mp-status-warning)]/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {lang === "de"
              ? "Kostenloses Tageskontingent (5 Übersetzungen) erreicht. "
              : "Daily free quota (5 translations) reached. "}
            <a href="/pricing" className="underline font-semibold hover:text-[var(--mp-cta-blue)]">
              {lang === "de" ? "Pro anzeigen" : "See Pro"}
            </a>
          </span>
        </div>
      )}

      {/* Generic error */}
      {!loading && errorMsg && !quotaHit && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[var(--mp-error)] bg-[var(--mp-error)]/8 border border-[var(--mp-error)]/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Translated text — rendered with markdown support for medical bold/lists */}
      {!loading && translated && activeTarget && (
        <div
          className={`mt-3 rounded-xl border border-[var(--mp-cta-blue)]/25 bg-[var(--mp-cta-blue)]/5 px-4 py-3 ${activeTarget.rtl ? "text-right" : ""}`}
          dir={activeTarget.rtl ? "rtl" : "ltr"}
        >
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--mp-cta-blue)]">
              {activeTarget.flag} {activeTarget.native}
            </span>
          </div>
          <div
            className="text-sm text-[var(--mp-fg)] leading-relaxed [&>p]:mb-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>strong]:font-semibold [&>h1]:font-bold [&>h1]:text-base [&>h2]:font-semibold [&>h2]:text-sm"
          >
            <ReactMarkdown>{translated}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
