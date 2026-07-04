"use client";

/**
 * <ExplanationTranslator> — the shared "read this explanation in your
 * language" surface (UX-6).
 *
 * Replaces the old click-then-wait-every-time TranslateButton flow with:
 *   1. AUTO-SHOW — on mount we GET every already-cached translation for this
 *      (question, field) at ZERO cost (no upstream call, no quota, no event).
 *      If a row exists for the user's UI language (useLang()), we show it by
 *      default. The German original is always one tap away.
 *   2. A LANGUAGE SWITCHER — German original + the 7 cached-translation
 *      targets (en/ru/ar/fr/tr/uk/sr). Flipping to a language we already
 *      fetched (or back to German) is instant and free, even for a free user
 *      at 0 quota. Picking an UNCACHED language POSTs /api/translate once
 *      (generate-on-first-view), then it is cached for everyone.
 *   3. MARKDOWN — the translated text renders through the shared <Markdown>
 *      (same renderer as the German original), so bold / lists / headings
 *      show properly instead of raw `**` (ties to BUG-3).
 *   4. The free-tier 5/day limit already enforced in /api/translate is
 *      surfaced gracefully (429 → the quota pill), never removed.
 *
 * German is the SOURCE, not a translation target: `lang='de'` is not in the
 * route's SUPPORTED_LANGS (a POST would 400), so the "Deutsch" switcher
 * option just renders the passed-in `germanText` with no network call.
 *
 * Owned surfaces: used by QuestionExplanation (Erklärung tab) and
 * TranslateButton (Übersetzen tab) so both share ONE coherent flow.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { authFetch as fetch } from "@/lib/authFetch";
import { trackEvent } from "@/lib/tracker";
import { Globe, Check, AlertTriangle, Lock, ChevronDown, Loader2 } from "lucide-react";
import { useLang, t, type Lang } from "@/lib/i18n";
import Markdown from "@/components/Markdown";

/** UI-copy language (de/en) as passed down from QuestionCard. */
type UiLang = "de" | "en";
type Field = "ai_explanation" | "explanation";

/** The 7 non-German languages the explanation can be translated into
 *  (matches question_translations.lang + the route's SUPPORTED_LANGS). */
type TargetLang = "en" | "ru" | "ar" | "fr" | "tr" | "uk" | "sr";

/** A menu option: either the German source or one of the 7 targets. */
type Choice = "de" | TargetLang;

const TARGETS: { code: TargetLang; native: string; flag: string; rtl?: boolean }[] = [
  { code: "en", native: "English", flag: "🇬🇧" },
  { code: "ru", native: "Русский", flag: "🇷🇺" },
  { code: "uk", native: "Українська", flag: "🇺🇦" },
  { code: "tr", native: "Türkçe", flag: "🇹🇷" },
  { code: "fr", native: "Français", flag: "🇫🇷" },
  { code: "ar", native: "العربية", flag: "🇸🇦", rtl: true },
  { code: "sr", native: "Srpski", flag: "🇷🇸" },
];

interface TranslateResponse {
  translatedText?: string;
  lang?: string;
  field?: string;
  cached?: boolean;
  error?: string;
  code?: string;
}

interface Props {
  questionId: number;
  /** UI-copy language (button/menu labels), NOT the translation target. */
  lang: UiLang;
  field: Field;
  /**
   * The German source text, already cleaned. Rendered inline when the choice
   * is German (no network). OPTIONAL: the Erklärung tab passes it (the German
   * original lives right there); the standalone Übersetzen tab does not have
   * it, so it starts on a translation and the "Deutsch" option is hidden
   * (the untranslated original is one tab away). When omitted, the initial
   * choice defaults to the UI language's target so the user lands on a
   * translation, not an empty pane.
   */
  germanText?: string;
  /** Accepted for caller compatibility (TranslateButton forwards it). Not
   *  used for logic — the server enforces + returns the 5/day quota, and the
   *  quota pill copy is tier-agnostic. */
  userTier?: string;
}

/** Narrow the wide UI language to a translation target, or null if the UI
 *  language has no separate translation (German is the source). */
function uiLangToTarget(ui: Lang): TargetLang | null {
  return ui === "de" ? null : (TARGETS.find((tg) => tg.code === ui)?.code ?? null);
}

export default function ExplanationTranslator({
  questionId,
  lang,
  field,
  germanText,
}: Props) {
  // Whether the German source text is available to render inline. When it is
  // NOT (standalone Übersetzen tab), the "Deutsch" option is hidden and the
  // surface defaults to a translation.
  const hasGerman = !!(germanText && germanText.trim());
  // Wide UI language (de/en/ru/uk/tr/ar) — drives auto-show target. Uses the
  // hook (not getUiLang() in render) so SSR hydrates as 'de' then updates,
  // and re-renders if the user switches UI language mid-card.
  const uiLang = useLang();

  // Which language is currently displayed. 'de' = German original.
  const [choice, setChoice] = useState<Choice>("de");
  // Cache of fetched/generated translations: { <target>: text }.
  const [cache, setCache] = useState<Partial<Record<TargetLang, string>>>({});
  const [loadingLang, setLoadingLang] = useState<TargetLang | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  // True once the read-only cache GET has resolved (success or fail). Gates
  // the auto-show effect so it decides from a settled cache.
  const [cacheLoaded, setCacheLoaded] = useState(false);
  // Guards the one-time auto-show so switching UI language later doesn't yank
  // the user off a language they manually picked.
  const autoShownRef = useRef(false);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<
    { top: number; left: number; maxHeight: number; openUp: boolean } | null
  >(null);

  // Reset everything when the bound question changes. The default choice is
  // German when the source is available, otherwise the UI-language target (so
  // the standalone Übersetzen tab lands on a translation, never an empty
  // pane). `cacheLoaded` re-arms so auto-show can fire for the new question.
  useEffect(() => {
    setChoice(hasGerman ? "de" : (uiLangToTarget(uiLang) ?? "en"));
    setCache({});
    setLoadingLang(null);
    setErrorMsg(null);
    setQuotaHit(false);
    setOpen(false);
    setCacheLoaded(false);
    autoShownRef.current = false;
    // hasGerman/uiLang deliberately excluded — a mid-life UI-language change
    // must not wipe the user's picked language; this seeds ONLY on question
    // change. The auto-show effect below reacts to uiLang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  // ── Fetch ALL cached translations for this (question, field) exactly once
  //    per question (0 cost — GET never generates / spends quota). ──
  useEffect(() => {
    let cancelled = false;
    async function loadCache() {
      try {
        const res = await fetch(
          `/api/translate?questionId=${questionId}&field=${field}`,
          { method: "GET" },
        );
        if (!res.ok) return;
        const data: { translations?: Record<string, string> } = await res
          .json()
          .catch(() => ({}));
        if (cancelled || !data.translations) return;
        const next: Partial<Record<TargetLang, string>> = {};
        for (const tg of TARGETS) {
          const txt = data.translations[tg.code];
          if (txt) next[tg.code] = txt;
        }
        if (!cancelled) setCache(next);
      } catch {
        // Offline / read failure — stay on the German original (or the
        // untranslated default); the manual switcher still works.
      } finally {
        if (!cancelled) setCacheLoaded(true);
      }
    }
    loadCache();
    return () => {
      cancelled = true;
    };
  }, [questionId, field]);

  // ── Auto-show: once the cache is loaded, if a translation for the UI
  //    language is cached and the user has not already picked, show it. Runs
  //    on cache load AND when uiLang resolves late (SSR 'de' → client 'ru').
  //    Pure state flip — no network. ──
  useEffect(() => {
    if (!cacheLoaded || autoShownRef.current) return;
    const want = uiLangToTarget(uiLang);
    // Only hijack the default view (German when available, else the seeded
    // UI-target). If the user already switched, `pick()` set autoShownRef.
    if (want && cache[want] && choice !== want) {
      setChoice(want);
      trackEvent("feature_use", {
        feature: "translate_autoshow",
        lang: want,
        field,
        questionId,
      });
    }
    autoShownRef.current = true;
  }, [cacheLoaded, uiLang, cache, choice, field, questionId]);

  // ── Portal position for the dropdown (escapes ancestor stacking contexts,
  //    same technique the old TranslateButton used). ──
  useEffect(() => {
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
      const desired = 320;
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

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        (triggerRef.current && triggerRef.current.contains(target)) ||
        (dropdownRef.current && dropdownRef.current.contains(target))
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

  // On a generate failure, fall back to the German original ONLY when it is
  // available inline (Erklärung tab). On the standalone Übersetzen tab there
  // is no German text and the "Deutsch" option is hidden, so falling back to
  // 'de' would strand the user on an empty pane; there we stay on the
  // attempted language and let the error banner be the actionable surface.
  const fallbackOnFail = useCallback(() => {
    if (hasGerman) setChoice("de");
  }, [hasGerman]);

  // Generate an uncached translation (POST). Only called for a target that is
  // not already in `cache`.
  const generate = useCallback(
    async (code: TargetLang) => {
      setLoadingLang(code);
      setErrorMsg(null);
      setQuotaHit(false);
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, field, lang: code }),
        });
        const data: TranslateResponse = await res.json().catch(() => ({}));
        if (res.ok && data.translatedText) {
          setCache((prev) => ({ ...prev, [code]: data.translatedText as string }));
          trackEvent("feature_use", {
            feature: "translate_explanation",
            lang: code,
            cached: !!data.cached,
            field,
            questionId,
          });
        } else if (res.status === 429 || data.code === "QUOTA_EXCEEDED" || data.code === "quota_exceeded") {
          setQuotaHit(true);
          fallbackOnFail();
        } else if (res.status === 503) {
          setErrorMsg(t("xlate_paused", lang));
          fallbackOnFail();
        } else {
          setErrorMsg(t("xlate_failed", lang));
          fallbackOnFail();
        }
      } catch (err) {
        console.error("[ExplanationTranslator]", err);
        setErrorMsg(t("xlate_network", lang));
        fallbackOnFail();
      } finally {
        setLoadingLang(null);
      }
    },
    // fallbackOnFail closes over hasGerman; both stable within a render.
    [questionId, field, lang, fallbackOnFail],
  );

  // Handle a switcher pick. German = instant. A cached target = instant.
  // An uncached target = generate-on-first-view.
  const pick = useCallback(
    (next: Choice) => {
      setOpen(false);
      setErrorMsg(null);
      setQuotaHit(false);
      autoShownRef.current = true; // an explicit pick locks out auto-show
      if (next === "de") {
        setChoice("de");
        return;
      }
      setChoice(next);
      if (!cache[next]) {
        void generate(next);
      }
    },
    [cache, generate],
  );

  // ── Derived display state ──
  const activeTarget = choice === "de" ? null : TARGETS.find((tg) => tg.code === choice)!;
  const isLoading = loadingLang !== null;
  const displayedText = choice === "de" ? (germanText ?? "") : cache[choice] ?? "";
  const rtl = activeTarget?.rtl ?? false;

  const triggerLabel =
    choice === "de"
      ? t("xlate_original_de", lang)
      : `${activeTarget!.flag} ${activeTarget!.native}`;

  return (
    <div className="mt-3.5">
      {/* Switcher trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isLoading}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-[var(--mp-cta-blue)] bg-[var(--mp-cta-blue)]/8 hover:bg-[var(--mp-cta-blue)]/15 px-3 py-1.5 rounded-lg transition-colors font-medium disabled:opacity-60"
        aria-label={t("xlate_language_label", lang)}
      >
        <Globe className="w-4 h-4" />
        <span>{triggerLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 opacity-70" />
      </button>

      {/* Dropdown — portaled to <body> with fixed positioning so it escapes
          any opacity/transform ancestor (they trapped the old menu behind
          the Next CTA). */}
      {open &&
        menuPos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            role="listbox"
            aria-label={t("xlate_language_label", lang)}
            className="fixed z-[1000] bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] rounded-xl shadow-[var(--mp-shadow-elev)] py-1 min-w-[230px] overflow-y-auto animate-scale-in"
            style={{
              top: menuPos.openUp ? undefined : menuPos.top,
              bottom: menuPos.openUp ? window.innerHeight - menuPos.top : undefined,
              left: menuPos.left,
              maxHeight: menuPos.maxHeight,
            }}
          >
            {/* German original — shown only when the source text is available
                inline (Erklärung tab). The standalone Übersetzen tab omits it;
                the untranslated original lives on the neighbouring Erklärung
                tab. */}
            {hasGerman && (
              <>
                <button
                  type="button"
                  onClick={() => pick("de")}
                  role="option"
                  aria-selected={choice === "de"}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    choice === "de"
                      ? "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]"
                      : "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  }`}
                >
                  <span className="text-base leading-none">🇩🇪</span>
                  <span className="flex-1">{t("xlate_original_de", lang)}</span>
                  {choice === "de" && <Check className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" />}
                </button>
                <div className="my-1 border-t border-[var(--mp-border-subtle)]" />
              </>
            )}

            {/* 7 translation targets */}
            {TARGETS.map((tg) => {
              const isActive = choice === tg.code;
              const isCached = !!cache[tg.code];
              return (
                <button
                  key={tg.code}
                  type="button"
                  onClick={() => pick(tg.code)}
                  role="option"
                  aria-selected={isActive}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)]"
                      : "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  }`}
                >
                  <span className="text-base leading-none">{tg.flag}</span>
                  <span className="flex-1">{tg.native}</span>
                  {isActive ? (
                    <Check className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" />
                  ) : isCached ? (
                    // Instant (already saved) — subtle dot.
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-[var(--mp-viridian)]/60"
                      title={lang === "de" ? "Sofort verfügbar" : "Instant"}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )}

      {/* Loading (generating a new translation) */}
      {isLoading && (
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--mp-fg-muted)]">
          <Loader2 className="w-3.5 h-3.5 text-[var(--mp-cta-blue)] animate-spin" />
          <span>{t("xlate_translating", lang)}</span>
        </div>
      )}

      {/* Quota reached (free tier) */}
      {!isLoading && quotaHit && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[var(--mp-status-warning)] bg-[var(--mp-status-warning)]/8 border border-[var(--mp-status-warning)]/30 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {t("xlate_quota", lang)}
            <a
              href="/pricing"
              className="underline font-semibold hover:text-[var(--mp-cta-blue)]"
            >
              {t("xlate_see_pro", lang)}
            </a>
          </span>
        </div>
      )}

      {/* Generic / paused error */}
      {!isLoading && errorMsg && !quotaHit && (
        <div className="mt-2 flex items-start gap-2 text-xs text-[var(--mp-error)] bg-[var(--mp-error)]/8 border border-[var(--mp-error)]/30 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Translated text (choice !== 'de') — rendered as markdown, same
          renderer as the German original. */}
      {!isLoading && choice !== "de" && displayedText && (
        <div
          className={`mt-3 rounded-xl border border-[var(--mp-cta-blue)]/25 bg-[var(--mp-cta-blue)]/5 px-4 py-3 ${
            rtl ? "text-right" : ""
          }`}
          dir={rtl ? "rtl" : "ltr"}
        >
          <div className={`flex items-center gap-2 mb-2 ${rtl ? "flex-row-reverse" : ""}`}>
            <Globe className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-[var(--mp-cta-blue)]">
              {activeTarget!.flag} {activeTarget!.native}
            </span>
          </div>
          <Markdown className="text-sm text-[var(--mp-fg)] leading-relaxed">
            {displayedText}
          </Markdown>
        </div>
      )}
    </div>
  );
}

export { TARGETS as EXPLANATION_TARGET_LANGS };
