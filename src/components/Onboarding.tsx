"use client";
import { useEffect, useState } from "react";
import { setAnnouncementContext } from "@/lib/announcements/queue";
import Link from "next/link";
import { ArrowRight, ArrowLeft, CheckCircle2, GraduationCap, Calendar, Target, Compass } from "lucide-react";
import { getStoredTheme } from "./ThemeProvider";
import LanguagePicker from "./LanguagePicker";
import { safeStorage } from "@/lib/safe-storage";
import { t as tr, getUiLang } from "@/lib/i18n";
import { EXAM_SOURCES, type ExamSourceId } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import ExamSittingPicker from "./ExamSittingPicker";
import { readAuthEntry } from '@/lib/auth-entry';

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

// Reimplemented to the approved v3 design (reviews/reimplementation-2026-06-26,
// 07-auth-onboarding-pricing.html + SPECS.md §10). First-run orientation that
// BREAKS THE SHELL (no sidebar/nav): exam pick -> exam date -> daily goal,
// spark-filled step progress, skippable, defaults applied if skipped.
//
// The DATA LAYER is untouched. onComplete still emits the full OnboardingData
// shape ({examSource, examDate ISO|"not_planned", level, dailyGoal, language,
// darkMode, completedAt}) and writes the same three localStorage keys, so the
// home handler in app/page.tsx + /api/user/exam-preference + the guided-path
// card keep reading exactly what they read before. The old 4th "Preferences"
// step (language + dark mode) is dropped per the new 3-step design; language
// stays switchable from the header (it feeds `data.language`), dark mode keeps
// the user's current stored theme, and `level` defaults to "intermediate"
// (read by nobody downstream, review-2026-04-25-B6).
const STEP_ICONS = [GraduationCap, Calendar, Target];
const STEP_COUNT = 3;

const goalPresets = [10, 20, 30, 50];

export default function Onboarding({ lang = "de", onLangChange, onComplete }: OnboardingProps) {
  const [activeLang, setActiveLang] = useState<Lang>((lang as Lang) || "de");
  // The consent bar and the top status region stay hidden while Onboarding is open (UX-GLOBAL-11/13).
  useEffect(() => {
    document.documentElement.dataset.onboarding = "open";
    setAnnouncementContext({ onboardingOpen: true }); // UX-GLOBAL-12: nothing over Onboarding
    return () => { delete document.documentElement.dataset.onboarding; setAnnouncementContext({ onboardingOpen: false }); };
  }, []);
  const l = activeLang;
  const t = (k: Parameters<typeof tr>[0]) => tr(k, l);
  const arrivalExam = readAuthEntry().exam;
  const [step, setStep] = useState(arrivalExam ? 1 : 0);
  const [data, setData] = useState<Partial<OnboardingData>>({
    examSource: arrivalExam || "kenntnispruefung",
    dailyGoal: 20,
    language: getUiLang(),
    darkMode: getStoredTheme() === "dark",
    examDate: "",
  });

  const StepIcon = STEP_ICONS[step];
  const isLast = step === STEP_COUNT - 1;
  const totalSteps = STEP_COUNT;

  // Step indices (3-step design):
  //   0 = Exam pick
  //   1 = Exam date (ExamSittingPicker)
  //   2 = Daily goal
  // i18n keys reuse the existing onb_step{1,2,3}_* copy (step4/step5 keys
  // remain in the bundle, now unused by this flow).
  const titleKeys = ["onb_step1_title", "onb_step2_title", "onb_step3_title"] as const;
  const subtitleKeys = ["onb_step1_subtitle", "onb_step2_subtitle", "onb_step3_subtitle"] as const;

  const handleLangSwitch = (next: Lang) => {
    setActiveLang(next);
    setData((d) => ({ ...d, language: next }));
    onLangChange?.(next);
  };

  const canProceed = () => {
    switch (step) {
      case 0: return true;
      case 1: return true; // Exam date is optional ("Not sure yet" is valid)
      case 2: return (data.dailyGoal ?? 0) >= 5;
      default: return false;
    }
  };

  const finishWith = (d: Partial<OnboardingData>) => {
    // ExamSittingPicker emits a real ISO date (YYYY-MM-DD) or "" for
    // "not sure yet". Map "" to the "not_planned" sentinel the home
    // handler + onboarding-complete already understand.
    const examDate = d.examDate && /^\d{4}-\d{2}-\d{2}$/.test(d.examDate)
      ? d.examDate
      : "not_planned";

    const completed: OnboardingData = {
      examSource: d.examSource || "kenntnispruefung",
      examDate,
      // Default to "intermediate" so OnboardingData stays compatible with
      // anything that ever reads `level` (currently nothing does, see
      // review-2026-04-25-B6) and legacy localStorage entries don't crash.
      level: d.level || "intermediate",
      dailyGoal: d.dailyGoal || 20,
      language: getUiLang(),
      // No UI step toggles theme anymore; keep the user's current choice.
      darkMode: d.darkMode ?? (getStoredTheme() === "dark"),
      completedAt: new Date().toISOString(),
    };

    safeStorage.setItem("medpruef_onboarding", JSON.stringify(completed));
    safeStorage.setItem("medpruef_profile", JSON.stringify({
      targetDate: examDate !== "not_planned" ? examDate : "",
      examSource: completed.examSource,
    }));

    onComplete(completed);
  };

  const handleNext = () => {
    if (isLast) {
      finishWith(data);
    } else {
      setStep(step + 1);
    }
  };

  // Skip = complete with whatever has been chosen so far (defaults fill the rest).
  const handleSkip = () => finishWith(data);

  const stepLabel = t("onb_step_label")
    .replace("{current}", String(step + 1))
    .replace("{total}", String(totalSteps));

  return (
    <div className="fixed inset-0 mp-layer-dialog flex flex-col bg-[var(--mp-surface-sunken)] min-h-dvh">
      <div className="mx-auto flex h-full w-full max-w-lg flex-col">
        {/* Top bar: language toggle (keeps DE/EN switchable without a step) + Skip */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-5">
          <LanguagePicker onChange={handleLangSwitch} />
          <button
            type="button"
            onClick={handleSkip}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--mp-fg-subtle)] transition-colors hover:text-[var(--mp-fg)]"
          >
            {t("onb_skip")}
          </button>
        </div>

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto px-5">
          {/* Spark-filled step progress (3 thin pills) */}
          <div className="flex gap-1.5 pt-5 pb-2">
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className={`h-[5px] flex-1 rounded-full transition-all ${
                  i < step
                    ? "bg-[var(--mp-spark)] shadow-[0_0_8px_var(--mp-spark-glow)]"
                    : i === step
                    ? "bg-gradient-to-r from-[var(--mp-spark)] to-[var(--mp-surface-sunken)]"
                    : "bg-[var(--mp-surface)]"
                }`}
              />
            ))}
          </div>

          {/* Header: step label + title + subtitle (no medallion, per design) */}
          <div className="pt-2 pb-5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--mp-accent-text)]">
              <StepIcon className="h-3.5 w-3.5" aria-hidden />
              {stepLabel}
            </div>
            <h2 className="mt-1.5 font-display text-[22px] font-extrabold leading-tight text-[var(--mp-fg)]">
              {t(titleKeys[step])}
            </h2>
            <p className="mt-1.5 text-[13px] text-[var(--mp-fg-muted)]">{t(subtitleKeys[step])}</p>
          </div>

          {/* Step 1: Exam pick, one of three real exam types */}
          {step === 0 && (
            <div className="space-y-3 pb-2">
              {EXAM_SOURCES.map((exam) => {
                const selected = data.examSource === exam.id;
                return (
                  <button
                    key={exam.id}
                    type="button"
                    onClick={() => setData({ ...data, examSource: exam.id as ExamSourceId })}
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3.5 rounded-2xl border-[1.5px] p-4 text-left transition-all ${
                      selected
                        ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)]"
                        : "border-[var(--mp-border)] bg-[var(--mp-surface)] hover:border-[var(--mp-fg-subtle)]"
                    }`}
                  >
                    <span
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl font-mono text-[11px] font-bold ${
                        selected ? "bg-[var(--mp-cta-blue)] text-white" : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]"
                      }`}
                      aria-hidden
                    >
                      {getExamLabel(exam.id, "short")}
                    </span>
                    <div className="min-w-0 flex-1">
                      {/* UX-GLOBAL-04: one label helper; the bridge line carries the
                          practice qualifier instead of hand-typed counts. */}
                      <h3 className="text-[15px] font-bold text-[var(--mp-fg)]">{getExamLabel(exam.id, "full", activeLang)}</h3>
                      <p className="mt-0.5 text-xs text-[var(--mp-fg-muted)]">
                        {getExamLabel(exam.id, "bridge", activeLang)}
                      </p>
                    </div>
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        selected
                          ? "border-[var(--mp-cta-blue)] bg-[var(--mp-cta-blue)]"
                          : "border-[var(--mp-border-strong)]"
                      }`}
                    >
                      {selected && <CheckCircle2 className="h-3.5 w-3.5 text-white" aria-hidden />}
                    </span>
                  </button>
                );
              })}
              <p className="pt-1 text-center text-xs text-[var(--mp-fg-subtle)]">
                {t("onb_exam_change_later")}
              </p>
              {/* Entry point #2 — the confused (already logged-in) user who
                  does not know which exam is theirs. This grid assumes they
                  do; the orientation flow (/find-your-path) explains the two
                  recognition routes and writes the choice back. */}
              <Link
                href="/find-your-path"
                className="mt-1 flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-[var(--mp-cta-blue)] transition-colors hover:bg-[var(--mp-tint-brand)]"
              >
                <Compass className="h-3.5 w-3.5" aria-hidden />
                {t("fyp_onb_unsure_link")}
              </Link>
            </div>
          )}

          {/* Step 2: Exam date, the shared ExamSittingPicker (anchored on the
              real Austrian sittings), reused verbatim. Emits a real ISO date
              or "" for "not sure yet". */}
          {step === 1 && (
            <div className="pb-2">
              <ExamSittingPicker
                examType={data.examSource || "kenntnispruefung"}
                value={data.examDate || ""}
                onChange={(iso) => setData({ ...data, examDate: iso })}
                lang={activeLang}
                density="modal"
              />
            </div>
          )}

          {/* Step 3: Daily goal stepper */}
          {step === 2 && (
            <div className="space-y-6 pb-2">
              <div className="text-center">
                <span className="font-display text-5xl font-black text-[var(--mp-cta-blue)]">
                  {data.dailyGoal || 20}
                </span>
                <p className="mt-1 text-sm text-[var(--mp-fg-subtle)]">{t("onb_goal_qpd")}</p>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={data.dailyGoal || 20}
                onChange={(e) => setData({ ...data, dailyGoal: parseInt(e.target.value) })}
                className="w-full accent-[var(--mp-cta-blue)]"
                aria-label={t("onb_goal_qpd")}
              />
              <div className="flex justify-between font-mono text-xs text-[var(--mp-fg-subtle)]">
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
                    type="button"
                    onClick={() => setData({ ...data, dailyGoal: g })}
                    className={`rounded-xl border py-2 text-sm font-semibold transition-all ${
                      data.dailyGoal === g
                        ? "border-[var(--mp-cta-blue)] bg-[var(--mp-cta-blue)] text-white"
                        : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-cta-blue)]"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="text-center text-xs text-[var(--mp-fg-subtle)]">
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

          <div className="h-4" />
        </div>

        {/* Sticky bottom action: full-width primary + Back affordance */}
        <div
          className="shrink-0 space-y-2 px-5 pt-3"
          style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn-primary flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isLast ? t("onb_finish") : t("onb_next")}
            <ArrowRight className="h-4 w-4" />
          </button>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-[var(--mp-fg-muted)] transition-colors hover:text-[var(--mp-fg)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("onb_back")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
