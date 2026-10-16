"use client";
/**
 * Lernplan (a25). Every signed-in learner has a working plan: toward their
 * own date, or toward the next official sitting of their bank labelled
 * provisional (LX-01, pick-plan-target A; users.exam_date is never written
 * without a tap). A past date offers the next sitting in one tap (LX-03).
 * The plan states what the date implies (LX-02), schedules timed mock exams
 * in the review phase (LX-04) and uses one phase model (UX-STU-18).
 */
import { buildAuthHref } from "@/lib/auth-entry";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { DataRegion } from "@/components/ui/DataRegion";
import { checkedJson, isRecord } from "@/lib/async-data";
import { buildQuizHref } from "@/lib/quiz-links";
import { useLang as useGlobalLang, renderLang } from "@/lib/i18n";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { authFetch as fetch } from "@/lib/authFetch";
import { getLang, t } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { EmptyState, useToast } from "@/components/ui";
import ExamSittingPicker from "@/components/ExamSittingPicker";
import StudyReadError from "@/components/StudyReadError";
import { isStudyPlanResponse, type StudyPlanResponse } from "@/lib/study-p0";
import { MockExamLink } from "@/components/exam/MockExamLink";
import { canUse } from "@/lib/entitlements";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { weakTopicHref } from "@/lib/next-step";
import { ts, studyDate } from "@/lib/i18n-study";
import { daysBetween } from "@/lib/master-learning/plan-target";
import { planPhases, reachableNew, registrationRows, upcomingDays } from "@/lib/study-plan-view";
import PlanHero from "./_parts/PlanHero";
import PlanEffort from "./_parts/PlanEffort";
import PlanRegistration from "./_parts/PlanRegistration";
import PlanPhases from "./_parts/PlanPhases";
import PlanToday from "./_parts/PlanToday";
import PlanUpcoming from "./_parts/PlanUpcoming";
import PlanCramPart from "./_parts/PlanCramPart";
import { CRAM_PLAN_VIEW_EVENT, parseCramView } from "@/lib/cram-part-plan";
import { trackEvent } from "@/lib/tracker";
import { Target, ChevronRight, AlertTriangle } from "lucide-react";
import { PENDING_PLAN_KEY, parseCarriedPlan, pendingPlanMatches, withoutCarryParams, type CarriedPlan } from "@/lib/study-plan-public";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { setStoredExamSource } from "@/lib/topics";
import { planPromptKey } from "@/lib/first-round-plan";
import { safeStorage } from "@/lib/safe-storage";

type Lang = "de" | "en";

/** Return ISO YYYY-MM-DD for a given date in local time. */
function toLocalISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Removes the /lernplan carry parameters from the address (a reload never re-applies them). */
function stripCarryParams() {
  const search = window.location.search;
  if (!new URLSearchParams(search).has("from")) return;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${withoutCarryParams(search)}${window.location.hash}`);
}

/** Re-read the plan on tab return at most this often (UX-STU-19). */
const REFRESH_AFTER_MS = 30_000;

export default function StudyPlanPage() {
  const toast = useToast();
  const planHeading = useRef<HTMLHeadingElement>(null);
  const pickerRef = useRef<HTMLElement>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [rollingSelected, setRollingSelected] = useState(false);
  const [pickerLater, setPickerLater] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const focusAfterLoad = useRef(false);
  const lastLoad = useRef(0);
  const [lang, setLangState] = useState<Lang>("de");
  const preferredLang = useGlobalLang();
  useEffect(() => { setLangState(renderLang(preferredLang)); }, [preferredLang]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [resp, setResp] = useState<StudyPlanResponse | null>(null);
  const [focus, setFocus] = useState<"all" | "weak">("all");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState(false);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState(false);
  const { audience } = useUserTier();
  // a-study-plan-magnet: a plan saved on the public /lernplan page arrives as
  // URL parameters. Applied once without asking only when no own date exists
  // AND the save CTA left a matching marker on this device; otherwise the
  // learner confirms (a crafted link never writes an account silently).
  const carryChecked = useRef(false);
  const [carry, setCarry] = useState<CarriedPlan | null>(null);
  const [carrySaving, setCarrySaving] = useState(false);
  const [carryError, setCarryError] = useState(false);

  useEffect(() => {
    setLangState(getLang());
    const stored = getStoredSession();
    setSession(stored);
    try {
      setRollingSelected(localStorage.getItem(`medpruef_rolling_plan_${stored?.user.id}`) === "1");
      setPickerLater(localStorage.getItem(`medpruef_plan_picker_later_${stored?.user.id}`) === "1");
    } catch { /* Show the inline picker when local storage is unavailable. */ }
  }, []);

  useEffect(() => {
    let alive = true;
    const stored = getStoredSession();
    if (!stored?.user?.id || stored.user.id.startsWith("guest_")) {
      setLoading(false);
      setError("not_logged_in");
      return;
    }
    const controller = new AbortController();
    setLoading(true); setError(null); setLoadError(null);
    fetch(`/api/user/study-plan${focus === "weak" ? "?focus=weak" : ""}`, { signal: controller.signal })
      .then(r => checkedJson(r, isStudyPlanResponse))
      .then(data => {
        if (!alive) return;
        setResp(data);
        lastLoad.current = Date.now();
        if (focusAfterLoad.current) {
          focusAfterLoad.current = false;
          requestAnimationFrame(() => planHeading.current?.focus());
        }
        setLoading(false);
      })
      .catch(err => {
        if (!alive) return;
        console.error("[study-plan] fetch failed", err);
        setError("fetch_failed"); setLoadError(err);
        setLoading(false);
      });
    return () => {
      alive = false; controller.abort();
    };
  }, [reload, focus]);

  // UX-STU-19: a device switch or a post-midnight return shows today, not
  // yesterday. Last good content stays visible while the re-read runs.
  useEffect(() => {
    // Only after a good load (lastLoad set) and never on the first pageshow,
    // so a failed or in-flight first read is not raced by a second one.
    const refresh = () => {
      if (lastLoad.current > 0 && document.visibilityState === "visible" && Date.now() - lastLoad.current > REFRESH_AFTER_MS) setReload(n => n + 1);
    };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) refresh(); };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const patchPreference = useCallback(async (body: Record<string, unknown>) => {
    await checkedJson(await fetch("/api/user/exam-preference", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }), (value): value is { ok: true; persisted: true } => isRecord(value) && value.ok === true && value.persisted === true);
  }, []);

  async function saveSelection() {
    if (selection === null || saving) return;
    setSaving(true); setSaveError(false);
    try {
      await patchPreference({ examDate: selection || null });
      setRollingSelected(selection === "");
      setPickerOpen(false);
      try { localStorage.setItem(`medpruef_rolling_plan_${session?.user.id}`, selection === "" ? "1" : "0"); } catch { /* Local persistence is optional. */ }
      toast.success(t(selection === "" ? "study_rolling_saved" : "study_date_saved", lang));
      focusAfterLoad.current = true; setReload(n => n + 1);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  }

  async function switchToSitting(iso: string) {
    if (switching) return;
    setSwitching(true); setSwitchError(false);
    try {
      await patchPreference({ examDate: iso });
      toast.success(ts("switch_done", lang));
      focusAfterLoad.current = true; setReload(n => n + 1);
    } catch { setSwitchError(true); }
    finally { setSwitching(false); }
  }

  async function changeGoal(n: number) {
    if (goalSaving) return;
    setGoalSaving(true); setGoalError(false);
    try {
      await patchPreference({ dailyGoal: n });
      setReload(r => r + 1);
    } catch { setGoalError(true); }
    finally { setGoalSaving(false); }
  }

  const applyCarry = useCallback(async (plan: CarriedPlan) => {
    setCarrySaving(true); setCarryError(false);
    try {
      await patchPreference({ activeExam: plan.exam, examDate: plan.examDate, dailyGoal: plan.dailyGoal });
      setStoredExamSource(plan.exam);
      // The visitor stated exam, date and goal, so Home and the first quiz
      // round do not ask again. Best effort: the plan is saved either way.
      void fetch("/api/user/onboarding-complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examSource: plan.exam, examDate: plan.examDate, dailyGoal: plan.dailyGoal }),
      }).catch(() => {});
      const id = getStoredSession()?.user.id;
      if (id) safeStorage.setItem(planPromptKey(id), "lernplan");
      safeStorage.removeItem(PENDING_PLAN_KEY);
      stripCarryParams();
      setCarry(null);
      toast.success(ts("carry_done", lang));
      focusAfterLoad.current = true; setReload(n => n + 1);
    } catch {
      setCarry(plan); setCarryError(true);
    } finally { setCarrySaving(false); }
  }, [patchPreference, toast, lang]);

  useEffect(() => {
    if (!resp || carryChecked.current) return;
    carryChecked.current = true;
    const parsed = parseCarriedPlan(new URLSearchParams(window.location.search));
    // Invalid or stale parameters are dropped at once; a valid plan stays in
    // the address until it is applied or declined, so a reload keeps it.
    if (!parsed) { stripCarryParams(); return; }
    const fromCta = pendingPlanMatches(safeStorage.getItem(PENDING_PLAN_KEY), parsed, Date.now());
    if (!resp.hasExamDate && fromCta) void applyCarry(parsed);
    else setCarry(parsed);
  }, [resp, applyCarry]);

  function declineCarry() {
    safeStorage.removeItem(PENDING_PLAN_KEY);
    stripCarryParams();
    setCarry(null); setCarryError(false);
  }

  function openPicker() {
    setRollingSelected(false);
    setPickerLater(false);
    setPickerOpen(true);
    setSelection(null);
    requestAnimationFrame(() => pickerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function pickLater() {
    setPickerLater(true);
    setPickerOpen(false);
    try { localStorage.setItem(`medpruef_plan_picker_later_${session?.user.id}`, "1"); } catch { /* optional */ }
  }

  // The server's Vienna day wins, so "today" matches the plan between 00:00 and 02:00 (reviewer P2).
  const todayISO = resp?.todayISO ?? toLocalISO(new Date());
  const plan = resp?.plan ?? null;
  const user = session?.user;
  const dailyGoal = resp?.dailyGoal || user?.daily_goal || 20;
  const activeExam = resp?.activeExam || "kenntnispruefung";
  const targetDate = resp?.targetDate ?? resp?.examDate ?? plan?.generatedFor ?? null;
  const targetSource = resp?.targetSource ?? (resp?.hasExamDate ? "user_exam_date" : "next_official_sitting");
  const provisional = resp?.provisional ?? !resp?.hasExamDate;
  const expired = resp?.expired === true;
  const canMock = canUse("mock_exam", audience);
  // a-cram-part-plan: present only while CRAM_PART_PLAN_ENABLED is on.
  const cram = useMemo(() => parseCramView(resp?.cram), [resp?.cram]);
  const cramPart = cram && cram.part !== "all" ? cram : null;
  const streak = user?.streak_count || 0;

  const todayPlan = useMemo(() => plan?.dailySchedule.find(d => d.day === todayISO) ?? null, [plan, todayISO]);
  const nextDays = useMemo(() => (plan ? upcomingDays(plan, todayISO) : []), [plan, todayISO]);
  const phases = useMemo(() => (plan ? planPhases(plan, todayISO) : []), [plan, todayISO]);
  const regRows = useMemo(
    () => (targetDate && targetSource !== "fallback_horizon" ? registrationRows(activeExam, targetDate, todayISO) : []),
    [activeExam, targetDate, targetSource, todayISO],
  );
  const daysLeft = targetDate ? Math.max(0, daysBetween(todayISO, targetDate)) : 0;
  const showPicker = resp?.hasExamDate === false && !rollingSelected && (!pickerLater || pickerOpen);
  const showChangePicker = resp?.hasExamDate === true && pickerOpen;
  const showRolling = resp?.hasExamDate === false && rollingSelected && !!resp.rollingPlan;

  // cram_plan_view: once per part and bucket per page load (re-reads on tab return send nothing new).
  const cramViewSent = useRef<string | null>(null);
  useEffect(() => {
    if (!cram || !plan || showRolling) return;
    const key = `${cram.part}:${cram.days}`;
    if (cramViewSent.current === key) return;
    cramViewSent.current = key;
    trackEvent(CRAM_PLAN_VIEW_EVENT, { part: cram.part, days: cram.days });
  }, [cram, plan, showRolling]);

  if ((loading || error === "fetch_failed") && !resp) {
    return <main className="min-h-screen bg-[var(--mp-surface-sunken)] px-4 py-12"><DataRegion loading={loading} retry={() => setReload(n => n + 1)} />{loadError ? <StudyReadError page="plan" error={loadError} retry={() => setReload(n => n + 1)} lang={lang} /> : null}</main>;
  }

  if (error === "not_logged_in" || !user) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} />
        <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
          <div className="px-6 py-16 max-w-md mx-auto">
            <EmptyState
              icon={<Target className="w-10 h-10" aria-hidden />}
              title={ts("plan_title", lang)}
              body={ts("plan_signin_body", lang)}
              action={
                <Link href={buildAuthHref({ next: "/study-plan" }, "signin_required")} className="mp-btn mp-btn--primary">
                  {ts("plan_signin", lang)}
                </Link>
              }
            />
          </div>
        </main>
        <BottomNav lang={lang} />
      </div>
    );
  }

  const pickerCard = (
    <section ref={pickerRef} className="mp-card max-w-xl mx-auto p-5 space-y-4 scroll-mt-24" aria-busy={saving} aria-labelledby="plan-picker-title">
      <h2 id="plan-picker-title" className="text-xl font-display font-bold text-[var(--mp-fg)]">{t("study_pick_date_title", lang)}</h2>
      <p className="text-sm text-[var(--mp-fg-muted)]">{t("study_pick_date_body", lang)}</p>
      <ExamSittingPicker examType={activeExam} value={selection} onChange={setSelection} onCustomStart={() => setSelection(null)} lang={lang} />
      {saveError && <div role="alert" className="text-[var(--mp-status-error)]">{t("study_save_error", lang)}</div>}
      <button type="button" disabled={saving || selection === null} className="mp-btn mp-btn--primary min-h-11 w-full" onClick={() => void saveSelection()}>
        {t(saving ? "study_saving" : saveError ? "request_retry" : "study_create_plan", lang)}
      </button>
      {resp?.hasExamDate === false ? (
        <button type="button" className="mp-btn mp-btn--ghost min-h-11 w-full" onClick={pickLater}>{ts("provisional_later", lang)}</button>
      ) : (
        <button type="button" className="mp-btn mp-btn--ghost min-h-11 w-full" onClick={() => setPickerOpen(false)}>{t("cancel", lang)}</button>
      )}
    </section>
  );

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={user.id} userName={user.first_name} totalXp={user.xp_total || 0} streak={streak} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <PartialTranslationNote />
        <div className="px-4 lg:px-8 pt-4 pb-3 border-b border-[var(--mp-border)] flex items-center justify-between gap-2">
          <Link href="/" className="inline-flex items-center min-h-11 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
            &larr; {t("back_home", lang)}
          </Link>
          <h1 ref={planHeading} tabIndex={-1} className="text-base font-bold font-display text-[var(--mp-fg)]">{ts("plan_title", lang)}</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={(l: Lang) => setLangState(l)} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-[1120px] mx-auto pb-28 space-y-5">
          <DataRegion loading={loading && !!resp} retry={() => setReload(n => n + 1)} />
          {loadError ? <StudyReadError page="plan" error={loadError} retry={() => setReload(n => n + 1)} lang={lang} /> : null}
          {carry && (
            <section className="mp-card max-w-xl mx-auto p-5 space-y-3" aria-labelledby="plan-carry-title" aria-busy={carrySaving} data-testid="plan-carry">
              <h2 id="plan-carry-title" className="text-lg font-display font-bold text-[var(--mp-fg)]">{ts("carry_title", lang)}</h2>
              <p className="text-sm text-[var(--mp-fg-muted)]">
                {resp?.hasExamDate && resp.examDate
                  ? ts("carry_body", lang, { exam: getExamLabel(carry.exam, "full", lang), date: studyDate(carry.examDate, lang), n: carry.dailyGoal, own: studyDate(resp.examDate, lang) })
                  : ts("carry_body_new", lang, { exam: getExamLabel(carry.exam, "full", lang), date: studyDate(carry.examDate, lang), n: carry.dailyGoal })}
              </p>
              {carryError && <div role="alert" className="text-sm text-[var(--mp-status-error)]">{ts("carry_error", lang)}</div>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="mp-btn mp-btn--primary min-h-11" disabled={carrySaving} onClick={() => void applyCarry(carry)}>{ts("carry_apply", lang)}</button>
                <button type="button" className="mp-btn mp-btn--ghost min-h-11" disabled={carrySaving} onClick={declineCarry}>{ts("carry_keep", lang)}</button>
              </div>
            </section>
          )}
          {(showPicker || showChangePicker) && pickerCard}

          {showRolling && resp?.rollingPlan && (
            <section className="mp-card p-5 space-y-4">
              <h2 className="text-xl font-display font-bold text-[var(--mp-fg)]">{t("study_rolling_title", lang)}</h2>
              <p className="text-sm text-[var(--mp-fg-muted)]">{t("study_rolling_body", lang)}</p>
              <Link className="mp-btn mp-btn--primary min-h-11" href={buildQuizHref({ examSource: activeExam, practiceMode: "unseen", limit: 20, returnTo: "/study-plan" })}>{t("study_new_questions", lang)}</Link>
              {canUse("spaced_repetition", audience) && (
                <div className="rounded-xl border border-[var(--mp-border)] p-4 flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-sm text-[var(--mp-fg)]">{t("study_due_reviews", lang)}: <bdi>{resp.rollingPlan.dueReviews}</bdi></p>
                  {resp.rollingPlan.dueReviews > 0 && <Link className="mp-btn mp-btn--secondary min-h-11" href={buildQuizHref({ examSource: activeExam, practiceMode: "review", limit: Math.min(200, resp.rollingPlan.dueReviews), returnTo: "/study-plan" })}>{t("study_review_now", lang)}</Link>}
                </div>
              )}
              <button className="mp-btn mp-btn--ghost min-h-11" onClick={openPicker}>{t("study_add_date", lang)}</button>
            </section>
          )}

          {plan && targetDate && !showRolling && (
            <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-5 lg:gap-6 items-start">
              <div className="space-y-5 min-w-0">
                <PlanHero
                  lang={lang}
                  plan={plan}
                  daysLeft={daysLeft}
                  targetDate={targetDate}
                  targetSource={targetSource}
                  provisional={provisional}
                  expired={expired}
                  ownDate={resp?.examDate ?? null}
                  switching={switching}
                  switchError={switchError}
                  onSwitch={(iso) => void switchToSitting(iso)}
                  onChooseDate={openPicker}
                />
                <PlanRegistration rows={regRows} lang={lang} />
                <PlanEffort
                  lang={lang}
                  effort={plan.effort}
                  goal={dailyGoal}
                  targetDate={targetDate}
                  reach={reachableNew(plan, resp?.unseenTotal ?? 0)}
                  unseen={typeof resp?.unseenTotal === "number" ? resp.unseenTotal : null}
                  bankTotal={typeof resp?.bankTotal === "number" ? resp.bankTotal : null}
                  focus={resp?.focus ?? focus}
                  weakAvailable={resp?.weakAvailable === true}
                  goalSaving={goalSaving}
                  goalError={goalError}
                  onGoal={(n) => void changeGoal(n)}
                  onFocus={setFocus}
                />
                {phases.length > 1 && (
                  <p className="text-[13px] text-[var(--mp-fg-muted)] px-0.5" data-testid="plan-phase-strip">
                    {phases[0].key === "new"
                      ? ts("phase_strip", lang, { date: studyDate(phases[0].to, lang, { day: "numeric", month: "short" }) })
                      : ts("phase_strip_review", lang)}
                  </p>
                )}
                {cramPart && <PlanCramPart cram={cramPart} plan={plan} todayISO={todayISO} canMock={canMock} lang={lang} />}
                <PlanToday lang={lang} day={todayPlan} examSource={activeExam} goal={dailyGoal} answeredToday={resp?.answeredToday} canMock={canMock} />
                <MockExamLink examSource={activeExam} lang={lang} source="plan" part={cramPart?.part ?? "all"} />
                <PlanUpcoming days={nextDays} lang={lang} examSource={activeExam} canMock={canMock} />
                <p className="text-center text-[13px] text-[var(--mp-fg-muted)] pt-1">{ts("plan_adapts", lang)}</p>
              </div>

              <aside className="space-y-5 lg:sticky lg:top-5">
                <PlanPhases phases={phases} lang={lang} />
                {plan.weakTopics.length > 0 && (
                  <section className="mp-card p-4" aria-labelledby="plan-weak-title">
                    <h3 id="plan-weak-title" className="font-bold text-sm text-[var(--mp-fg)] mb-1 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[var(--mp-warning-text)]" aria-hidden />
                      {ts("weak_title", lang)}
                    </h3>
                    <p className="text-[13px] text-[var(--mp-fg-muted)] mb-3">{ts("weak_body", lang)}</p>
                    <ul className="flex flex-wrap gap-2">
                      {plan.weakTopics.map(topic => (
                        <li key={topic}>
                          <Link
                            href={weakTopicHref(topic, activeExam, audience)}
                            className="inline-flex items-center gap-1.5 min-h-11 bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)] text-[var(--mp-fg)] text-[13px] font-medium px-3 rounded-full"
                          >
                            <span lang="de">{topic}</span>
                            <ChevronRight className="w-3 h-3 text-[var(--mp-fg-subtle)]" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </aside>
            </div>
          )}
        </div>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}
