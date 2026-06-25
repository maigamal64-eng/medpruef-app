"use client";
import { useState } from "react";
import { ArrowRight, ArrowLeft, Calendar, Target, BookOpen, CheckCircle2, Moon, Sun, Zap, GraduationCap } from "lucide-react";
import { getStoredTheme, setStoredTheme } from "./ThemeProvider";
import LanguageToggle from "./LanguageToggle";
import { t as tr, setLang as persistLang } from "@/lib/i18n";
import { EXAM_SOURCES, type ExamSourceId } from "@/lib/topics";
import ExamSittingPicker from "./ExamSittingPicker";

type Lang = "de" | "en";

interface OnboardingData {
  examSource: string;
  examDate: string;
  level: string;
  dailyGoal: number;
  language: string;
  darkMode: boolean;
  completedAt?: string;
}

interface OnboardingProps {
  lang?: string;
  onLangChange?: (l: Lang) => void;
  onComplete: (data: OnboardingData) => void;
}

// Onboarding step 4 (Level) removed 2026-04-25 (review-2026-04-25-B6).
// The audit found `data.level` was written to localStorage but read by
// nobody — pure friction with no downstream consumer. Step 4 is now
// Preferences (was step 5). 4 steps total.
const STEP_ICONS = [GraduationCap, Calendar, Target, Zap];
const STEP_COUNT = 4;

const goalPresets = [10, 20, 30, 50];

export default function Onboarding({ lang = "de", onLangChange, onComplete }: OnboardingProps) {
  const [activeLang, setActiveLang] = useState<Lang>((lang as Lang) || "de");
  const l = activeLang;
  const t = (k: Parameters<typeof tr>[0]) => tr(k, l);
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Partial<OnboardingData>>({
    examSource: "kenntnispruefung",
    dailyGoal: 20,
    language: activeLang,
    darkMode: getStoredTheme() === "dark",
    examDate: "",
  });

  const StepIcon = STEP_ICONS[step];
  const isLast = step === STEP_COUNT - 1;
  const totalSteps = STEP_COUNT;

  // Step indices after removing Level (review-2026-04-25-B6):
  //   0 = Exam (was onb_step1_*)
  //   1 = Exam date (was onb_step2_*)
  //   2 = Daily goal (was onb_step3_*)
  //   3 = Preferences (was onb_step5_*)
  // We deliberately skip onb_step4_* (Level) i18n keys — they remain in
  // the bundle for legacy clients that pulled the old JS but receive
  // the new copy bundle.
  const titleKeys = ["onb_step1_title", "onb_step2_title", "onb_step3_title", "onb_step5_title"] as const;
  const subtitleKeys = ["onb_step1_subtitle", "onb_step2_subtitle", "onb_step3_subtitle", "onb_step5_subtitle"] as const;

  const handleLangSwitch = (next: Lang) => {
    setActiveLang(next);
    setData((d) => ({ ...d, language: next }));
    persistLang(next);
    onLangChange?.(next);
  };

  const canProceed = () => {
    switch (step) {
      case 0: return true;
      case 1: return true; // Exam date is optional ("Not sure yet" is valid)
      case 2: return (data.dailyGoal ?? 0) >= 5;
      case 3: return true; // Preferences — language + dark mode have defaults
      default: return false;
    }
  };

  const handleFinish = () => {
    // ExamSittingPicker emits a real ISO date (YYYY-MM-DD) or "" for
    // "not sure yet". Map "" to the "not_planned" sentinel the home
    // handler + onboarding-complete already understand.
    const examDate = data.examDate && /^\d{4}-\d{2}-\d{2}$/.test(data.examDate)
      ? data.examDate
      : "not_planned";

    const completed: OnboardingData = {
      examSource: data.examSource || "kenntnispruefung",
      examDate,
      // Default to "intermediate" so OnboardingData type stays compatible
      // with anything that ever reads `level` (currently nothing does —
      // see review-2026-04-25-B6) but legacy localStorage entries don't
      // crash on reload.
      level: data.level || "intermediate",
      dailyGoal: data.dailyGoal || 20,
      language: data.language || activeLang,
      darkMode: data.darkMode || false,
      completedAt: new Date().toISOString(),
    };

    localStorage.setItem("medpruef_onboarding", JSON.stringify(completed));
    localStorage.setItem("medpruef_profile", JSON.stringify({
      targetDate: examDate !== "not_planned" ? examDate : "",
      examSource: completed.examSource,
    }));
    if (completed.language) localStorage.setItem("medpruef-lang", completed.language);
    if (data.darkMode) {
      setStoredTheme("dark");
    } else {
      setStoredTheme("light");
    }

    onComplete(completed);
  };

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  const stepLabel = t("onb_step_label")
    .replace("{current}", String(step + 1))
    .replace("{total}", String(totalSteps));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--mp-oxford-blue)]/60 backdrop-blur-sm">
      <div className="bg-[var(--mp-surface-raised)] rounded-2xl shadow-[var(--shadow-modal)] max-w-lg w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Language switcher (top-right) */}
        <div className="flex items-center justify-end px-6 pt-4 shrink-0">
          <LanguageToggle lang={activeLang} onChange={handleLangSwitch} />
        </div>

        {/* Progress bar */}
        <div className="px-6 pt-3 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-4">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <div key={i} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step ? "bg-[var(--mp-viridian)] text-white" : i === step ? "bg-[var(--mp-cta-blue)] text-white ring-4 ring-[var(--mp-cta-blue)]/20" : "bg-[var(--mp-border)] text-[var(--mp-fg-subtle)]"
                }`}>
                  {i < step ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div className={`w-8 h-0.5 mx-1 transition-all ${i < step ? "bg-[var(--mp-viridian)]" : "bg-[var(--mp-border)]"}`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--mp-fg-subtle)] text-center">{stepLabel}</p>
        </div>

        {/* Content */}
        <div className="px-6 flex-1 overflow-y-auto">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-[var(--mp-cta-blue)]/10 flex items-center justify-center mx-auto mb-3">
              <StepIcon className="w-7 h-7 text-[var(--mp-cta-blue)]" />
            </div>
            <h2 className="text-xl font-bold text-[var(--mp-fg)] mb-1">{t(titleKeys[step])}</h2>
            <p className="text-sm text-[var(--mp-fg-subtle)]">{t(subtitleKeys[step])}</p>
          </div>

          {/* Step 1: Exam — pick one of three real options */}
          {step === 0 && (
            <div className="space-y-3">
              {EXAM_SOURCES.map((exam) => {
                const selected = data.examSource === exam.id;
                const descKey: "onb_exam_primary_desc" | "onb_exam_kmp_desc" | "onb_exam_pharma_desc" =
                  exam.id === "kenntnispruefung"
                    ? "onb_exam_primary_desc"
                    : exam.id === "kmp_innsbruck"
                    ? "onb_exam_kmp_desc"
                    : "onb_exam_pharma_desc";
                const specialtyCount =
                  exam.id === "kenntnispruefung" ? 10 : exam.id === "kmp_innsbruck" ? 12 : 1;
                const formattedQuestions = activeLang === "de"
                  ? exam.questions.toLocaleString("de-DE")
                  : exam.questions.toLocaleString("en-US");
                return (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => setData({ ...data, examSource: exam.id as ExamSourceId })}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      selected
                        ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/5"
                        : "border-[var(--mp-border)] hover:border-[var(--mp-fg-subtle)]"
                    }`}
                    aria-pressed={selected}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl shrink-0" aria-hidden>{exam.badge}</span>
                        <div>
                          <h3 className="font-semibold text-[var(--mp-fg)]">{exam.fullName}</h3>
                          <p className="text-sm text-[var(--mp-fg-subtle)] mt-0.5">{t(descKey)}</p>
                          <p className="text-xs text-[var(--mp-viridian)] font-mono mt-1">
                            {formattedQuestions} {t("onb_exam_questions_label")} · {specialtyCount} {t("onb_exam_specialties_label")}
                          </p>
                        </div>
                      </div>
                      {selected && <CheckCircle2 className="w-6 h-6 text-[var(--mp-viridian)] shrink-0" />}
                    </div>
                  </button>
                );
              })}
              <p className="text-xs text-[var(--mp-fg-subtle)] text-center mt-2">
                {t("onb_exam_change_later")}
              </p>
            </div>
          )}

          {/* Step 2: Exam Date — anchored on the REAL Austrian sittings
              (src/lib/exam-dates.ts) so a pick resolves to a concrete ISO
              date that drives the study plan. Replaces the old presets
              that the home handler dropped as non-ISO. */}
          {step === 1 && (
            <ExamSittingPicker
              examType={data.examSource || "kenntnispruefung"}
              value={data.examDate || ""}
              onChange={(iso) => setData({ ...data, examDate: iso })}
              lang={activeLang}
              density="modal"
            />
          )}

          {/* Step 3: Daily Goal */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <span className="text-5xl font-black font-display text-[var(--mp-cta-blue)]">{data.dailyGoal || 20}</span>
                <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">{t("onb_goal_qpd")}</p>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={data.dailyGoal || 20}
                onChange={(e) => setData({ ...data, dailyGoal: parseInt(e.target.value) })}
                className="w-full accent-[var(--mp-cta-blue)]"
              />
              <div className="flex justify-between text-xs text-[var(--mp-fg-subtle)]">
                <span>5</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {goalPresets.map((g) => (
                  <button
                    key={g}
                    onClick={() => setData({ ...data, dailyGoal: g })}
                    className={`py-2 rounded-xl text-sm font-semibold border transition-all ${
                      data.dailyGoal === g ? "bg-[var(--mp-cta-blue)] text-white border-[var(--mp-cta-blue)]" : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-cta-blue)]"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--mp-fg-subtle)] text-center">
                {(data.dailyGoal || 20) <= 15
                  ? t("onb_goal_relaxed")
                  : (data.dailyGoal || 20) <= 30
                  ? t("onb_goal_recommended")
                  : (data.dailyGoal || 20) <= 50
                  ? t("onb_goal_intense")
                  : t("onb_goal_hardcore")}
              </p>
            </div>
          )}

          {/* Step 4: Preferences (was step 5; level step removed B6) */}
          {step === 3 && (
            <div className="space-y-4">
              {/* Language */}
              <div className="p-4 rounded-xl border border-[var(--mp-border)]">
                <p className="text-sm font-semibold text-[var(--mp-fg)] mb-3">{t("onb_language_label")}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[{ val: "de" as Lang, label: "Deutsch 🇩🇪" }, { val: "en" as Lang, label: "English 🇬🇧" }].map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => handleLangSwitch(opt.val)}
                      className={`py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                        activeLang === opt.val ? "bg-[var(--mp-cta-blue)] text-white border-[var(--mp-cta-blue)]" : "bg-[var(--mp-surface-raised)] border-[var(--mp-border)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dark mode */}
              <div className="p-4 rounded-xl border border-[var(--mp-border)]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[var(--mp-fg)]">{t("onb_dark_mode_title")}</p>
                    <p className="text-xs text-[var(--mp-fg-subtle)]">{t("onb_dark_mode_desc")}</p>
                  </div>
                  <button
                    onClick={() => setData({ ...data, darkMode: !data.darkMode })}
                    className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${
                      data.darkMode ? "bg-[var(--mp-cta-blue)]" : "bg-[var(--mp-border)]"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${
                      data.darkMode ? "translate-x-7" : ""
                    }`}>
                      {data.darkMode ? <Moon className="w-3 h-3 text-[var(--mp-cta-blue)]" /> : <Sun className="w-3 h-3 text-[var(--mp-status-warning)]" />}
                    </div>
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 rounded-xl bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]">
                <p className="text-xs font-semibold text-[var(--mp-fg-subtle)] uppercase tracking-wider mb-2">{t("onb_summary_label")}</p>
                <div className="space-y-1 text-sm text-[var(--mp-fg-muted)]">
                  <p>{(EXAM_SOURCES.find((e) => e.id === data.examSource)?.badge ?? "📋")} {EXAM_SOURCES.find((e) => e.id === data.examSource)?.fullName ?? "SIP Kenntnisprüfung (Wien)"}</p>
                  <p>📅 {data.examDate && /^\d{4}-\d{2}-\d{2}$/.test(data.examDate)
                    ? new Date(data.examDate + "T00:00:00").toLocaleDateString(activeLang === "de" ? "de-AT" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : t("onb_summary_not_planned")}</p>
                  <p>🎯 {data.dailyGoal || 20} {t("onb_summary_qpd")}</p>
                </div>
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>

        {/* Navigation */}
        <div className="px-6 py-4 border-t border-[var(--mp-border)] shrink-0 flex items-center justify-between bg-[var(--mp-surface-raised)]">
          <button
            onClick={() => step > 0 && setStep(step - 1)}
            disabled={step === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm ${
              step === 0 ? "text-[var(--mp-border)] cursor-not-allowed" : "text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            {t("onb_back")}
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLast ? t("onb_finish") : t("onb_next")}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
