"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { setAnnouncementContext } from "@/lib/announcements/queue";
import { ArrowRight, ArrowLeft, GraduationCap, Calendar, Target, Compass, Minus, Plus, ExternalLink } from "lucide-react";
import { getStoredTheme } from "./ThemeProvider";
import LanguagePicker from "./LanguagePicker";
import { safeStorage } from "@/lib/safe-storage";
import { t as tr, getUiLang, useLang, renderLang, type Lang } from "@/lib/i18n";
import { EXAM_SOURCES, type ExamSourceId } from "@/lib/topics";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import ExamSittingPicker from "./ExamSittingPicker";
import { readAuthEntry } from '@/lib/auth-entry';
import { authFetch } from "@/lib/authFetch";
import { Dialog } from "@/components/ui/Dialog";
import { announce } from "@/lib/announce";
import { trackEvent } from "@/lib/tracker";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { canUse } from "@/lib/entitlements";
import { FREE_TIER } from "@/lib/content-truth";
import { examFormatHref } from "@/lib/home-layout";
import { goalPaceLine, goalTierKey, GOAL_PRESETS, GOAL_MIN, GOAL_MAX, GOAL_STEP } from "@/lib/onboarding-goal";
import { clearDraft, queueOnboardingSync, readDraft, replayOnboardingSync, writeDraft } from "@/lib/onboarding-sync";
import { loadHomeTopics } from "@/lib/home-topics-request";

export interface OnboardingData {
  examSource: string;
  /** ISO date, "not_planned" (explicit no date) or "" (left for later). */
  examDate: string;
  level: string;
  dailyGoal: number;
  language: string;
  darkMode: boolean;
  completedAt?: string;
}

interface OnboardingProps {
  lang?: string;
  /** Signed-in account id; scopes the 24 h resume draft and the pending sync. */
  userId?: string | null;
  /**
   * The exam is already known (a-free-set: the plan prompt after the first
   * quiz round of a free-intent signup); step 1 is skipped like a sign-up
   * that carried the exam.
   */
  initialExam?: string | null;
  /** Arm the first-question primer on finish (default true; off after a quiz round). */
  armPrimer?: boolean;
  onComplete: (data: OnboardingData) => void;
}

/**
 * First-run orientation (UX-ONB-25..32, HOME-56).
 *
 *  - Exam (step 1) is the one mandatory fact: no card is preselected unless the
 *    sign-up carried the exam (then step 1 is skipped), there is no skip, and
 *    "Weiter" stays focusable with aria-disabled and a linked hint until a
 *    choice is made. The exam is saved to the account when it is chosen.
 *  - Date and daily goal are optional: "Später festlegen" skips only that item
 *    and keeps any value the account already has.
 *  - Each step change moves focus to the step's h1 ("Schritt 2 von 3: …") and
 *    updates the document title; choices are native radio groups.
 *  - Choices and the step persist for 24 hours per account (resume after a tab
 *    discard); every write goes through the pending-sync queue.
 *  - Language is never written here (only the explicit picker writes it).
 */
const STEP_ICONS = [GraduationCap, Calendar, Target];
const STEP_COUNT = 3;
const STEP_TITLE_KEYS = ["a22_onb_title_exam", "a22_onb_title_date", "a22_onb_title_goal"] as const;

interface Draft { examSource: string | null; examDate: string | null; dailyGoal: number | null; customGoal: boolean }

export default function Onboarding({ userId = null, initialExam = null, armPrimer = true, onComplete }: OnboardingProps) {
  const lang: Lang = useLang();
  const t = (k: Parameters<typeof tr>[0]) => tr(k, lang);
  const { audience } = useUserTier();
  const groupId = useId();
  const hintId = `${groupId}-hint`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);
  const firstRender = useRef(true);

  // Nothing else is shown over Onboarding (UX-GLOBAL-11/12/13).
  useEffect(() => {
    document.documentElement.dataset.onboarding = "open";
    setAnnouncementContext({ onboardingOpen: true });
    return () => { delete document.documentElement.dataset.onboarding; setAnnouncementContext({ onboardingOpen: false }); };
  }, []);

  const arrivalExam = (initialExam && EXAM_SOURCES.some((e) => e.id === initialExam) ? initialExam as ExamSourceId : null) || readAuthEntry().exam;
  const [step, setStep] = useState(arrivalExam ? 1 : 0);
  const [data, setData] = useState<Draft>({ examSource: arrivalExam || null, examDate: null, dailyGoal: null, customGoal: false });
  const [showHint, setShowHint] = useState(false);
  const [unsureOpen, setUnsureOpen] = useState(false);
  const [bankTotal, setBankTotal] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Resume a draft (24 h, this account) or prefill date and goal from the account.
  useEffect(() => {
    if (!userId) return;
    const draft = readDraft<Draft>(userId);
    if (draft) {
      setData(draft.data);
      setStep(Math.min(Math.max(0, draft.step), STEP_COUNT - 1));
      return;
    }
    const controller = new AbortController();
    authFetch("/api/user/exam-preference", { signal: controller.signal, timeoutMs: 8_000 })
      .then((r) => (r.ok ? r.json() : null))
      .then((pref: { examDate?: string | null } | null) => {
        if (controller.signal.aborted || !pref) return;
        // Only the date is prefilled: the exam column defaults for every account,
        // so it never counts as the learner's choice.
        if (typeof pref.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pref.examDate)) {
          setData((d) => (d.examDate === null ? { ...d, examDate: pref.examDate as string } : d));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [userId]);

  useEffect(() => { if (userId) writeDraft(userId, step, data); }, [userId, step, data]);

  // Focus moves to the step heading on every step change (not on first paint, where the page takes it).
  useEffect(() => {
    const title = `${t("onb_step_label").replace("{current}", String(step + 1)).replace("{total}", String(STEP_COUNT))}: ${t(STEP_TITLE_KEYS[step])}`;
    document.title = `${title} | MedPrüf`;
    if (firstRender.current) { firstRender.current = false; headingRef.current?.focus({ preventScroll: true }); return; }
    headingRef.current?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // The pace estimate uses the chosen bank's own question count.
  useEffect(() => {
    if (step !== 2 || !data.examSource) return;
    const controller = new AbortController();
    loadHomeTopics(data.examSource, authFetch as typeof fetch, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setBankTotal(rows.reduce((s, r) => s + r.count, 0)); })
      .catch(() => { if (!controller.signal.aborted) setBankTotal(null); });
    return () => controller.abort();
  }, [step, data.examSource]);

  // A custom date in the past never becomes the planning date (UX-ONB-29).
  const todayIso = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const datePast = !!data.examDate && /^\d{4}-\d{2}-\d{2}$/.test(data.examDate) && data.examDate < todayIso;

  const save = useCallback((payload: Parameters<typeof queueOnboardingSync>[1]) => {
    if (!userId || userId.startsWith("guest_")) return;
    queueOnboardingSync(userId, payload);
    void replayOnboardingSync(userId, authFetch).then((r) => { if (r === "failed") trackEvent("onboarding_save_failed", { step: String(step + 1) }); });
  }, [userId, step]);

  const finish = (d: Draft) => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    const examSource = d.examSource!;
    const examDate = d.examDate && /^\d{4}-\d{2}-\d{2}$/.test(d.examDate) ? d.examDate : d.examDate === "" ? "not_planned" : "";
    const completed: OnboardingData = {
      examSource,
      examDate,
      level: "intermediate",
      dailyGoal: d.dailyGoal ?? 20,
      language: getUiLang(),
      darkMode: getStoredTheme() === "dark",
      completedAt: new Date().toISOString(),
    };
    safeStorage.setItem("medpruef_onboarding", JSON.stringify(completed));
    safeStorage.setItem("medpruef_profile", JSON.stringify({ targetDate: examDate && examDate !== "not_planned" ? examDate : "", examSource }));
    if (userId) {
      // The first-question primer (UX-ONB-33) shows once after onboarding.
      if (armPrimer) { try { safeStorage.setItem(`medpruef_onb_primer:${userId}`, "pending"); } catch {} }
      save({
        examSource,
        ...(d.examDate === null ? {} : { examDate: examDate && examDate !== "not_planned" ? examDate : null }),
        ...(d.dailyGoal ? { dailyGoal: d.dailyGoal } : {}),
        completed: true,
      });
      clearDraft(userId);
    }
    onComplete(completed);
  };

  const next = () => {
    if (step === 0) {
      if (!data.examSource) { setShowHint(true); announce(t("a22_onb_exam_hint")); return; }
      save({ examSource: data.examSource });
    }
    if (step === 1 && (data.examDate === null || datePast)) { setShowHint(true); announce(t(datePast ? "a22_picker_past" : "a22_onb_date_hint")); return; }
    setShowHint(false);
    if (step === STEP_COUNT - 1) finish(data);
    else setStep(step + 1);
  };

  const later = () => {
    trackEvent("onboarding_skip", { step: String(step + 1) });
    setShowHint(false);
    if (step === 1) {
      const d = { ...data, examDate: null };
      setData(d);
      setStep(2);
    } else {
      finish({ ...data, dailyGoal: null });
    }
  };

  const StepIcon = STEP_ICONS[step];
  const stepLabel = t("onb_step_label").replace("{current}", String(step + 1)).replace("{total}", String(STEP_COUNT));
  const nextBlocked = (step === 0 && !data.examSource) || (step === 1 && (data.examDate === null || datePast));
  const goal = data.dailyGoal ?? 20;
  const pace = goalPaceLine({ examDate: data.examDate, total: bankTotal, now: new Date(), lang });
  const free = !canUse("full_bank", audience);

  return (
    <div className="fixed inset-0 mp-layer-dialog flex flex-col bg-[var(--mp-surface-sunken)] min-h-dvh">
      <main className="mx-auto flex h-full w-full max-w-lg flex-col" aria-labelledby={`${groupId}-title`}>
        <div className="flex shrink-0 items-center justify-between px-5 pt-5">
          <LanguagePicker />
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5">
          <div className="flex gap-1.5 pt-5 pb-2" aria-hidden>
            {Array.from({ length: STEP_COUNT }).map((_, i) => (
              <span
                key={i}
                className={`h-[5px] flex-1 rounded-full transition-all ${
                  i < step ? "bg-[var(--mp-spark)]" : i === step ? "bg-gradient-to-r from-[var(--mp-spark)] to-[var(--mp-surface-sunken)]" : "bg-[var(--mp-surface)]"
                }`}
              />
            ))}
          </div>

          <div className="pt-2 pb-5">
            <h1
              id={`${groupId}-title`}
              ref={headingRef}
              tabIndex={-1}
              className="font-display text-[22px] font-extrabold leading-tight text-[var(--mp-fg)] outline-none"
            >
              <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--mp-accent-text)]">
                <StepIcon className="h-3.5 w-3.5" aria-hidden />
                {stepLabel}<span className="sr-only">:</span>
              </span>
              <span className="mt-1.5 block">{t(STEP_TITLE_KEYS[step])}</span>
            </h1>
            <p className="mt-1.5 text-[14px] text-[var(--mp-fg-muted)]">
              {step === 0 ? t("a22_onb_sub_exam") : step === 1 ? t("a22_onb_sub_date") : t("a22_onb_sub_goal")}
            </p>
          </div>

          {step === 0 && (
            <div className="space-y-3 pb-2">
              <fieldset className="m-0 border-0 p-0" aria-describedby={hintId}>
                <legend className="sr-only">{t("a22_onb_title_exam")}</legend>
                <div className="space-y-3">
                  {EXAM_SOURCES.map((exam) => {
                    const selected = data.examSource === exam.id;
                    return (
                      <label
                        key={exam.id}
                        className={`flex min-h-16 w-full cursor-pointer items-center gap-3.5 rounded-2xl border-[1.5px] p-4 transition-all focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--mp-focus-color)] ${
                          selected ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)]" : "border-[var(--mp-border)] bg-[var(--mp-surface)] hover:border-[var(--mp-fg-subtle)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${groupId}-exam`}
                          value={exam.id}
                          checked={selected}
                          onChange={() => { setData({ ...data, examSource: exam.id as ExamSourceId, examDate: null }); setShowHint(false); }}
                          className="h-5 w-5 flex-shrink-0 accent-[var(--mp-cta-blue)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-bold text-[var(--mp-fg)]">{getExamLabel(exam.id, "full", lang)}</span>
                          <span className="mt-0.5 block text-[13px] text-[var(--mp-fg-muted)]">{getExamLabel(exam.id, "bridge", lang)}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
              <p id={hintId} className={`text-[13px] ${showHint ? "font-semibold text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>
                {t("a22_onb_exam_hint")}
              </p>
              {free && (
                <p className="text-[13px] text-[var(--mp-fg-muted)]">{t("a22_free_allowance").replace("{n}", String(FREE_TIER.questions_per_exam_type))}</p>
              )}
              <button
                type="button"
                onClick={() => setUnsureOpen(true)}
                className="mp-btn mp-btn--secondary w-full min-h-11 justify-center"
              >
                <Compass className="h-4 w-4" aria-hidden />
                {t("a22_onb_unsure")}
              </button>
              <p className="pt-1 text-center text-[13px] text-[var(--mp-fg-subtle)]">{t("a22_onb_change_later")}</p>
            </div>
          )}

          {step === 1 && (
            <div className="pb-2">
              <ExamSittingPicker
                examType={data.examSource || "kenntnispruefung"}
                value={data.examDate}
                onChange={(iso) => { setData({ ...data, examDate: iso }); setShowHint(false); }}
                lang={renderLang(lang)}
                density="modal"
                describedBy={hintId}
              />
              <p id={hintId} className={`mt-3 text-[13px] ${showHint ? "font-semibold text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>
                {t("a22_onb_date_hint")}
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5 pb-2">
              <fieldset className="m-0 border-0 p-0">
                <legend className="mb-2 text-[14px] font-semibold text-[var(--mp-fg)]">{t("a22_onb_goal_legend")}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  {GOAL_PRESETS.map((g) => (
                    <label key={g} className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 text-[15px] font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--mp-focus-color)] ${!data.customGoal && goal === g ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)] text-[var(--mp-fg)]" : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg-muted)]"}`}>
                      <input type="radio" name={`${groupId}-goal`} checked={!data.customGoal && goal === g} onChange={() => setData({ ...data, dailyGoal: g, customGoal: false })} className="sr-only" />
                      <span className="tabular-nums">{g}</span>
                    </label>
                  ))}
                  <label className={`col-span-2 sm:col-span-1 flex min-h-12 cursor-pointer items-center justify-center rounded-xl border px-2 text-[14px] font-semibold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--mp-focus-color)] ${data.customGoal ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)] text-[var(--mp-fg)]" : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg-muted)]"}`}>
                    <input type="radio" name={`${groupId}-goal`} checked={data.customGoal} onChange={() => setData({ ...data, customGoal: true, dailyGoal: goal })} className="sr-only" />
                    {t("a22_onb_goal_other")}
                  </label>
                </div>
              </fieldset>
              {data.customGoal && (
                <div className="flex items-center justify-center gap-4" role="group" aria-label={t("a22_onb_goal_legend")}>
                  <button type="button" className="mp-btn mp-btn--secondary h-11 w-11 p-0 justify-center" aria-label={t("a22_onb_goal_less")} onClick={() => setData({ ...data, dailyGoal: Math.max(GOAL_MIN, goal - GOAL_STEP) })}>
                    <Minus className="h-4 w-4" aria-hidden />
                  </button>
                  <output className="min-w-[4ch] text-center font-display text-4xl font-black tabular-nums text-[var(--mp-fg)]" aria-live="polite">
                    {goal}<span className="sr-only"> {t("onb_goal_qpd")}</span>
                  </output>
                  <button type="button" className="mp-btn mp-btn--secondary h-11 w-11 p-0 justify-center" aria-label={t("a22_onb_goal_more")} onClick={() => setData({ ...data, dailyGoal: Math.min(GOAL_MAX, goal + GOAL_STEP) })}>
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
              <p className="text-[14px] text-[var(--mp-fg)]">{t(goalTierKey(goal))}</p>
              <p className="text-[13px] text-[var(--mp-fg-muted)]" aria-live="polite">{pace}</p>
              <p className="text-[13px] text-[var(--mp-fg-subtle)]">{t("a22_onb_goal_helper")}</p>
            </div>
          )}

          <div className="h-4" />
        </div>

        <div className="shrink-0 space-y-2 px-5 pt-3" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            onClick={next}
            aria-disabled={nextBlocked || saving}
            aria-describedby={step < 2 ? hintId : undefined}
            className={`btn-primary flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] ${nextBlocked ? "opacity-60" : ""}`}
          >
            {step === STEP_COUNT - 1 ? t("a22_onb_finish") : t("onb_next")}
            <ArrowRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
          </button>
          {step > 0 && (
            <div className="flex min-h-11 items-center justify-between gap-3">
              {step > (arrivalExam ? 1 : 0) ? (
                <button type="button" onClick={() => { setShowHint(false); setStep(step - 1); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]">
                  <ArrowLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                  {t("onb_back")}
                </button>
              ) : <span />}
              <button type="button" onClick={later} className="inline-flex min-h-11 items-center rounded-xl px-2 text-sm font-medium text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]">
                {step === 1 ? t("a22_onb_later_date") : t("a22_onb_later_goal")}
              </button>
            </div>
          )}
        </div>
      </main>

      <Dialog open={unsureOpen} onOpenChange={setUnsureOpen} title={t("a22_onb_unsure")} placement="auto" kind="content">
        <p className="mb-3 text-[14px] text-[var(--mp-fg-muted)]">{t("a22_onb_unsure_body")}</p>
        <ul className="space-y-3">
          {EXAM_SOURCES.map((exam) => {
            const href = examFormatHref(exam.id);
            return (
              <li key={exam.id} className="rounded-xl border border-[var(--mp-border)] p-3">
                <p className="text-[15px] font-semibold text-[var(--mp-fg)]">{getExamLabel(exam.id, "full", lang)}</p>
                <p className="text-[13px] text-[var(--mp-fg-muted)]">{getExamLabel(exam.id, "bridge", lang)}</p>
                {href && (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-11 items-center gap-1 text-[13px] font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">
                    {t("a22_onb_unsure_more")}<span className="sr-only"> ({t("a22_opens_new_tab")})</span>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Dialog>
    </div>
  );
}
