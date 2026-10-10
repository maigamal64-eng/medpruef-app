"use client";

/**
 * FindYourPath — the public, ANON-SAFE guided orientation flow.
 *
 * Audience: a CONFUSED candidate who does not know which Austrian
 * recognition route is theirs, the deadlines, or where to start (the
 * Instagram lead who DM'd about the exam). It is the orientation layer
 * the existing in-app Onboarding assumes already happened.
 *
 * Why this is its OWN component (not a reuse of Onboarding.tsx): the
 * landing CTA serves a NOT-logged-in lead, so every step + the output
 * must run client-side with NO auth-gated call in the critical path.
 * Onboarding.tsx + /api/user/study-plan are requireUser-gated. This
 * component MIRRORS the approved v3 look (shell-breaking step flow,
 * spark progress, sticky bottom action, MPDS tokens/primitives) and
 * REUSES buildStudyPath + StudyPathTimeline for study phases only,
 * suppressing unverified registration advice on this public flow,
 * and generateStudyPlan (the
 * plan SHAPE only — see the topic-data note below).
 *
 * Persistence: writes the SAME localStorage keys the in-app onboarding
 * writes (medpruef_onboarding / medpruef_profile / medpruef-lang), so
 * the lead's choice carries into the app after they register and the
 * home page does not re-onboard them. A one-time post-auth sync in
 * app/page.tsx pushes those to the server (the anon flow cannot PATCH).
 *
 * Topic-data note: generateStudyPlan needs PER-TOPIC question counts,
 * which only the server has (get_topic_counts). An anon lead cannot
 * hit it, and content-truth.ts only exposes AGGREGATE counts. So the
 * output renders the real timeline + the plan SHAPE (total days,
 * ~questions = dailyGoal x days, the 70/30 philosophy), never a
 * fabricated per-topic day-by-day. That precise breakdown personalizes
 * once they are in the app.
 *
 * Austrian, not German. No em dashes in user copy ([name]'s rule). Exam
 * dates are entered by the learner as study targets, never suggested
 * from an unverified institutional mapping; prose follows SoT §§0.1–0.2.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  Compass,
  Stethoscope,
  GraduationCap,
  HelpCircle,
  CheckCircle2,
  Calendar,
  Target,
  Sparkles,
  CalendarClock,
  RotateCcw,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { getStoredTheme } from "./ThemeProvider";
import LanguageToggle from "./LanguageToggle";
import { LogoMark } from "./Logo";
import { t as tr } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";
import {
  OFFICIAL_KEYS_BY_BANK,
  getNextOfficialDeadlineGroup,
  getUpcomingOfficialFor,
  type PuypExamType,
} from "@/lib/exam-dates";
import {
  describeDeadlineGroup,
  describeStpSitting,
  describeUpcomingGroup,
  td,
} from "@/lib/i18n-dates";
import { generateStudyPlan, type TopicProgress } from "@/lib/studyPlan";
import { buildStudyPath } from "@/lib/studyPath";
import StudyPathTimeline from "./StudyPathTimeline";

/**
 * The next official deadline for a route, from the C7 export (W1-CAL).
 * Vienna route: SIP4a/SIP5a registration close. Stichprobentest route: the
 * next sitting with both publishers' deadlines, each labelled. null when
 * nothing official is open.
 */
function officialDeadlineText(examType: PuypExamType, lang: string): string | null {
  const now = new Date();
  const exams = OFFICIAL_KEYS_BY_BANK[examType];
  const g = getNextOfficialDeadlineGroup({ exams, now });
  if (!g) return null;
  if (examType === "kmp_innsbruck") {
    const date = g.rows[0].date;
    return describeStpSitting(
      getUpcomingOfficialFor({ exams, now }).filter((r) => r.date === date),
      lang,
    );
  }
  return g.started ? describeDeadlineGroup(g, lang, now) : describeUpcomingGroup(g, lang);
}

type Lang = "de" | "en";

/** The two top-level recognition ROUTES (Pharma is a Route-B subject,
 *  not a top-level route here, per SoT §1). "unsure" reveals the
 *  explainer. Each route maps to a real exam_type / examSource. */
type RouteChoice = "kenntnispruefung" | "kmp_innsbruck" | "unsure";

/** Short curated weak-area chips per route. Labels are the real topic
 *  strings (so the choice could later seed weighting). Optional + purely
 *  for the lead to feel seen; not load-bearing for the anon plan shape. */
const WEAK_AREAS: Record<"kenntnispruefung" | "kmp_innsbruck", string[]> = {
  kenntnispruefung: [
    "Innere Medizin",
    "Chirurgische Fächer",
    "Notfall- und Intensivmedizin",
    "Neurologie",
    "Psychiatrie",
    "Frauenheilkunde/Gynäkologie",
    "Kinder- und Jugendheilkunde",
    "Dermatologie und Venerologie",
  ],
  kmp_innsbruck: [
    "Innere Medizin",
    "Allgemeine Chirurgie",
    "Intensivmedizin",
    "Gynäkologie und Geburtshilfe",
    "Kinder und Jugendheilkunde",
    "Dermatologie",
    "HNO",
  ],
};

const GOAL_PRESETS = [10, 20, 30, 50];

/** Format an ISO date for the explainer / output. Austrian lens. */
function formatDate(iso: string, lang: Lang): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map((n) => parseInt(n, 10));
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(
    lang === "de" ? "de-AT" : "en-GB",
    { day: "numeric", month: "long", year: "numeric" },
  );
}

/** Phase order. 0 = route (+ inline explainer), 1 = date, 2 = background.
 *  The output is rendered separately once submitted. */
const STEP_COUNT = 3;
const STEP_ICONS = [Compass, Calendar, Target];

export default function FindYourPath({ initialLang = "de" }: { initialLang?: Lang }) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const t = (k: Parameters<typeof tr>[0]) => tr(k, lang);

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  // Session-awareness: the flow is anon-safe, but a LOGGED-IN confused
  // user can also reach it (entry point #2 — the in-app Onboarding links
  // here for "I'm not sure which exam is mine"). When a real session
  // exists we (a) push the choice straight to the server on finish (no
  // anon-then-post-auth-sync needed) and (b) swap the output CTA from
  // "create account" to "start studying". SSR-safe: read on mount.
  const [loggedIn, setLoggedIn] = useState(false);
  useEffect(() => {
    const s = getStoredSession();
    setLoggedIn(Boolean(s?.user?.id && !s.user.id.startsWith("guest_")));
  }, []);

  const [route, setRoute] = useState<RouteChoice | null>(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [examDate, setExamDate] = useState(""); // "" = no date yet
  const [weak, setWeak] = useState<string[]>([]);
  const [dailyGoal, setDailyGoal] = useState(20);

  // The resolved exam type once a real route is chosen ("unsure" is not
  // a real exam type — the picker / output only run after a real pick).
  const examType: PuypExamType | null =
    route === "kenntnispruefung" || route === "kmp_innsbruck" ? route : null;

  const handleLang = (next: Lang) => {
    setLang(next);
    // Mirror the global lang key so the rest of the app honors the
    // choice when the lead lands in it (same key i18n.setLang uses).
    try {
      localStorage.setItem("medpruef-lang", next);
    } catch {
      /* noop */
    }
  };

  const pickRoute = (r: RouteChoice) => {
    if (r === "unsure") {
      setRoute("unsure");
      setShowExplainer(true);
      return;
    }
    setRoute(r);
    setShowExplainer(false);
    // Reset a date that belonged to a different exam type.
    setExamDate("");
    setWeak([]);
  };

  const canProceed = (): boolean => {
    if (step === 0) return examType !== null; // a real route is required
    return true; // date + background are optional
  };

  const persist = () => {
    if (!examType) return;
    const isISO = /^\d{4}-\d{2}-\d{2}$/.test(examDate);
    const payloadExamDate = isISO ? examDate : "not_planned";
    try {
      // Same shape the in-app Onboarding.finishWith writes, so the home
      // handler + post-auth sync read exactly what they expect.
      localStorage.setItem(
        "medpruef_onboarding",
        JSON.stringify({
          examSource: examType,
          examDate: payloadExamDate,
          level: "intermediate",
          dailyGoal,
          language: lang,
          darkMode: getStoredTheme() === "dark",
          completedAt: new Date().toISOString(),
          source: "find-your-path",
        }),
      );
      localStorage.setItem(
        "medpruef_profile",
        JSON.stringify({
          targetDate: isISO ? examDate : "",
          examSource: examType,
        }),
      );
      // Carry the exam-source preference too (the app reads this key on
      // first load to pre-select the exam).
      localStorage.setItem("medpruef_exam_source", examType);
      localStorage.setItem("medpruef-lang", lang);
      // A logged-in user already synced to the server below, so the home
      // page's one-time post-auth sync should not re-fire.
      if (loggedIn) localStorage.setItem("medpruef_fyp_synced", "1");
    } catch {
      /* noop — never block the orientation on storage */
    }

    // Logged-in confused user (entry point #2): push the choice straight
    // to the server so users.active_exam / exam_date / daily_goal are set
    // and /api/user/study-plan generates immediately. Best-effort; never
    // block the output. Anon users skip this (no session) and rely on the
    // localStorage carry + the home post-auth sync after they register.
    if (loggedIn) {
      const body: Record<string, string | number> = { activeExam: examType };
      if (dailyGoal > 0) body.dailyGoal = dailyGoal;
      if (isISO) body.examDate = examDate;
      authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
      authFetch("/api/user/onboarding-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examSource: examType,
          examDate: payloadExamDate,
          dailyGoal,
          language: lang,
        }),
      }).catch(() => {});
    }
  };

  const handleNext = () => {
    if (step < STEP_COUNT - 1) {
      setStep(step + 1);
      return;
    }
    persist();
    setDone(true);
  };

  const handleRestart = () => {
    setRoute(null);
    setShowExplainer(false);
    setExamDate("");
    setWeak([]);
    setDailyGoal(20);
    setStep(0);
    setDone(false);
  };

  const toggleWeak = (topic: string) => {
    setWeak((cur) =>
      cur.includes(topic) ? cur.filter((x) => x !== topic) : [...cur, topic],
    );
  };

  const stepLabel = t("fyp_step_label")
    .replace("{current}", String(step + 1))
    .replace("{total}", String(STEP_COUNT));

  // ── OUTPUT ────────────────────────────────────────────────────────
  if (done && examType) {
    return (
      <YourPath
        lang={lang}
        onLang={handleLang}
        examType={examType}
        examDate={examDate}
        dailyGoal={dailyGoal}
        loggedIn={loggedIn}
        onRestart={handleRestart}
      />
    );
  }

  const StepIcon = STEP_ICONS[step];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--mp-surface-sunken)]">
      <div className="mx-auto flex h-full w-full max-w-lg flex-col">
        {/* Top bar: brand + language toggle */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-5">
          <Link href="/landing" className="flex items-center gap-2" aria-label="MedPrüf">
            <LogoMark className="h-7 w-7" />
            <span className="font-display text-sm font-extrabold text-[var(--mp-fg)]">
              MedPrüf
            </span>
          </Link>
          <LanguageToggle lang={lang} onChange={handleLang} />
        </div>

        {/* Scrollable step content */}
        <div className="flex-1 overflow-y-auto px-5">
          {/* Spark-filled step progress (matches Onboarding) */}
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

          {/* Header */}
          <div className="pt-2 pb-5">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--mp-accent-text)]">
              <StepIcon className="h-3.5 w-3.5" aria-hidden />
              {stepLabel}
            </div>
            <h1 className="mt-1.5 font-display text-[22px] font-extrabold leading-tight text-[var(--mp-fg)]">
              {step === 0 ? t("fyp_s1_title") : step === 1 ? t("fyp_s2_title") : t("fyp_s3_title")}
            </h1>
            <p className="mt-1.5 text-[13px] text-[var(--mp-fg-muted)]">
              {step === 0 ? t("fyp_s1_sub") : step === 1 ? t("fyp_s2_sub") : t("fyp_s3_sub")}
            </p>
          </div>

          {/* ── Step 1: route ── */}
          {step === 0 && (
            <div className="space-y-3 pb-2">
              <RouteCard
                selected={route === "kenntnispruefung"}
                icon={<Stethoscope className="h-5 w-5" aria-hidden />}
                title={t("fyp_route_kp_name")}
                desc={t("fyp_route_kp_desc")}
                onClick={() => pickRoute("kenntnispruefung")}
              />
              <RouteCard
                selected={route === "kmp_innsbruck"}
                icon={<GraduationCap className="h-5 w-5" aria-hidden />}
                title={t("fyp_route_stp_name")}
                desc={t("fyp_route_stp_desc")}
                onClick={() => pickRoute("kmp_innsbruck")}
              />
              <RouteCard
                selected={route === "unsure"}
                icon={<HelpCircle className="h-5 w-5" aria-hidden />}
                title={t("fyp_route_unsure_name")}
                desc={t("fyp_route_unsure_desc")}
                onClick={() => pickRoute("unsure")}
              />

              {/* Inline two-route explainer (revealed by "I'm not sure") */}
              {showExplainer && (
                <RouteExplainer lang={lang} onChoose={pickRoute} />
              )}
            </div>
          )}

          {/* ── Step 2: exam date (reuses ExamSittingPicker) ── */}
          {step === 1 && examType && (
            <div className="pb-2">
              <p className="mb-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]" role="note">
                {examType === "kenntnispruefung" ? td("fyp_kp_notice", lang) : t("fyp_university_notice")}
              </p>
              {officialDeadlineText(examType, lang) && (
                <p className="mb-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3 text-xs leading-relaxed text-[var(--mp-fg)]">
                  <span className="font-semibold">{td("fyp_next_deadline", lang)}:</span>{" "}
                  {officialDeadlineText(examType, lang)}
                </p>
              )}
              <label className="block text-sm font-medium text-[var(--mp-fg)]">
                {t("fyp_study_target_label")}
                <input
                  type="date"
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="mt-2 w-full rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-sm text-[var(--mp-fg)]"
                />
              </label>
              <button
                type="button"
                onClick={() => setExamDate("")}
                className="mt-3 text-xs font-semibold text-[var(--mp-cta-blue)] hover:underline"
              >
                {t("fyp_study_target_clear")}
              </button>
              <a
                href={examType === "kenntnispruefung"
                  ? "https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/"
                  : "https://www.i-med.ac.at/studium/"}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-xs text-[var(--mp-viridian)] hover:underline"
              >
                {t("fyp_university_link")}
              </a>
            </div>
          )}

          {/* ── Step 3: optional background ── */}
          {step === 2 && examType && (
            <div className="space-y-6 pb-2">
              {/* Weak areas */}
              <div>
                <label className="text-[13px] font-semibold text-[var(--mp-fg)]">
                  {t("fyp_s3_weak_label")}
                </label>
                <p className="mt-0.5 text-xs text-[var(--mp-fg-subtle)]">
                  {t("fyp_s3_weak_hint")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {WEAK_AREAS[examType].map((topic) => {
                    const on = weak.includes(topic);
                    return (
                      <button
                        key={topic}
                        type="button"
                        onClick={() => toggleWeak(topic)}
                        aria-pressed={on}
                        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                          on
                            ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)] text-[var(--mp-cta-blue)]"
                            : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-fg-subtle)]"
                        }`}
                      >
                        {topic}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Daily goal */}
              <div>
                <label className="text-[13px] font-semibold text-[var(--mp-fg)]">
                  {t("fyp_s3_goal_label")}
                </label>
                <div className="mt-3 text-center">
                  <span className="font-display text-5xl font-black text-[var(--mp-cta-blue)]">
                    {dailyGoal}
                  </span>
                  <p className="mt-1 text-sm text-[var(--mp-fg-subtle)]">
                    {t("fyp_s3_goal_qpd")}
                  </p>
                </div>
                <input
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={dailyGoal}
                  onChange={(e) => setDailyGoal(parseInt(e.target.value))}
                  className="mt-4 w-full accent-[var(--mp-cta-blue)]"
                  aria-label={t("fyp_s3_goal_qpd")}
                />
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {GOAL_PRESETS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setDailyGoal(g)}
                      className={`rounded-xl border py-2 text-sm font-semibold transition-all ${
                        dailyGoal === g
                          ? "border-[var(--mp-cta-blue)] bg-[var(--mp-cta-blue)] text-white"
                          : "border-[var(--mp-border)] bg-[var(--mp-surface)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-cta-blue)]"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>

        {/* Sticky bottom action */}
        <div className="shrink-0 space-y-2 px-5 pb-6 pt-3">
          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn-primary flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {step === STEP_COUNT - 1 ? t("fyp_see_path") : t("fyp_next")}
            <ArrowRight className="h-4 w-4" />
          </button>
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-medium text-[var(--mp-fg-muted)] transition-colors hover:text-[var(--mp-fg)]"
            >
              <ArrowLeft className="h-4 w-4" />
              {t("fyp_back")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Route option card ── */
function RouteCard({
  selected,
  icon,
  title,
  desc,
  onClick,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3.5 rounded-2xl border-[1.5px] p-4 text-left transition-all ${
        selected
          ? "border-[var(--mp-cta-blue)] bg-[var(--mp-tint-brand)]"
          : "border-[var(--mp-border)] bg-[var(--mp-surface)] hover:border-[var(--mp-fg-subtle)]"
      }`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          selected
            ? "bg-[var(--mp-cta-blue)] text-white"
            : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
        }`}
        aria-hidden
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-bold text-[var(--mp-fg)]">{title}</h3>
        <p className="mt-0.5 text-xs text-[var(--mp-fg-muted)]">{desc}</p>
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
}

/* ── The two-route explainer (revealed by "I'm not sure") ──
   Facts from SoT §1; next-sitting dates pulled live from exam-dates.ts
   (never hardcoded). Each card ends with a "this is my route" pick. */
function RouteExplainer({
  lang,
  onChoose,
}: {
  lang: Lang;
  onChoose: (r: RouteChoice) => void;
}) {
  const t = (k: Parameters<typeof tr>[0]) => tr(k, lang);

  return (
    <div className="mt-2 rounded-2xl border border-[var(--mp-border)] bg-[var(--mp-surface)] p-4">
      <h2 className="font-display text-[15px] font-extrabold text-[var(--mp-fg)]">
        {t("fyp_explain_title")}
      </h2>
      <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">{t("fyp_explain_sub")}</p>

      {/* Kenntnisprüfung */}
      <div className="mt-4 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3.5">
        <div className="flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-[var(--mp-cta-blue)]" aria-hidden />
          <span className="text-[13px] font-bold text-[var(--mp-fg)]">
            {t("fyp_route_kp_name")}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
          {t("fyp_explain_kp_p")}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[var(--mp-fg-muted)]" role="note">{td("fyp_kp_notice", lang)}</p>
        <button
          type="button"
          onClick={() => onChoose("kenntnispruefung")}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-cta-blue)] hover:underline"
        >
          {t("fyp_explain_choose_kp")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* Stichprobentest */}
      <div className="mt-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-3.5">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />
          <span className="text-[13px] font-bold text-[var(--mp-fg)]">
            {t("fyp_route_stp_name")}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
          {t("fyp_explain_stp_p")}
        </p>
        <button
          type="button"
          onClick={() => onChoose("kmp_innsbruck")}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--mp-viridian)] hover:underline"
        >
          {t("fyp_explain_choose_stp")}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/* ── OUTPUT: "Your Path" ──
   Route paragraph + real timeline (register-by anchor + phase ladder)
   + plan SHAPE + "start here" + a primary CTA into the app. Anon-safe:
   no server call. */
function YourPath({
  lang,
  onLang,
  examType,
  examDate,
  dailyGoal,
  loggedIn,
  onRestart,
}: {
  lang: Lang;
  onLang: (l: Lang) => void;
  examType: PuypExamType;
  examDate: string;
  dailyGoal: number;
  loggedIn: boolean;
  onRestart: () => void;
}) {
  const t = (k: Parameters<typeof tr>[0]) => tr(k, lang);
  const isKP = examType === "kenntnispruefung";
  const hasDate = /^\d{4}-\d{2}-\d{2}$/.test(examDate);

  // Real timeline (pure, client-safe). null when no date / date past.
  const studyPath = useMemo(
    () => (hasDate ? buildStudyPath(examDate, examType) : null),
    [hasDate, examDate, examType],
  );

  // Plan SHAPE only. We have no per-topic counts client-side, so feed
  // the generator a single synthetic bucket sized to the bank so the
  // day-count + total are honest; we render totalDays + the qpd x days
  // figure + the 70/30 philosophy, NOT a per-topic day-by-day.
  const planShape = useMemo(() => {
    if (!hasDate) return null;
    const examDateObj = new Date(`${examDate}T00:00:00`);
    const availableTopics: TopicProgress[] = [
      { topic: "Mix", total: 9999, answered: 0, correct: 0, accuracy: 0 },
    ];
    return generateStudyPlan({
      examDate: examDateObj,
      dailyQuestionGoal: dailyGoal,
      availableTopics,
    });
  }, [hasDate, examDate, dailyGoal]);

  const freeHref = `/quiz?exam=${examType}&free=1`;

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      {/* Top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]/92 px-5 py-3 backdrop-blur-xl">
        <Link href="/landing" className="flex items-center gap-2" aria-label="MedPrüf">
          <LogoMark className="h-7 w-7" />
          <span className="font-display text-sm font-extrabold text-[var(--mp-fg)]">
            MedPrüf
          </span>
        </Link>
        <LanguageToggle lang={lang} onChange={onLang} />
      </div>

      <div className="mx-auto max-w-lg px-5 py-6 pb-24">
        {/* Eyebrow + title */}
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--mp-accent-text)]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t("fyp_out_eyebrow")}
        </div>
        <h1 className="mt-1.5 font-display text-[26px] font-black leading-tight text-[var(--mp-fg)]">
          {isKP ? t("fyp_out_title_kp") : t("fyp_out_title_stp")}
        </h1>

        {/* Route paragraph */}
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--mp-fg-muted)]">
          {isKP ? t("fyp_out_route_kp_p") : t("fyp_out_route_stp_p")}
        </p>

        <p className="mt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]" role="note">
          {isKP ? td("fyp_kp_notice", lang) : t("fyp_university_notice")}
        </p>
        {officialDeadlineText(examType, lang) && (
          <p className="mt-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-xs leading-relaxed text-[var(--mp-fg)]">
            <span className="font-semibold">{td("fyp_next_deadline", lang)}:</span>{" "}
            {officialDeadlineText(examType, lang)}
          </p>
        )}

        {/* Timeline */}
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-[var(--mp-fg)]">
            <CalendarClock className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />
            {t("fyp_out_timeline_title")}
          </h2>

          {studyPath ? (
            <div className="space-y-3">
              {/* Days-left figure */}
              <div className="mp-card flex items-center gap-4 p-4">
                <div className="text-center">
                  <div className="font-display text-4xl font-black leading-none text-[var(--mp-cta-blue)]">
                    {studyPath.daysLeft}
                  </div>
                </div>
                <div className="text-sm text-[var(--mp-fg-muted)]">
                  {t("fyp_out_days_left")}
                  <div className="mt-0.5 text-xs text-[var(--mp-fg-subtle)]">
                    {formatDate(examDate, lang)}
                  </div>
                </div>
              </div>

              {/* Register-by anchor + phase ladder (shared component) */}
              <StudyPathTimeline path={{ ...studyPath, registration: null }} lang={lang} />
            </div>
          ) : (
            <div className="mp-card p-4">
              <p className="text-sm font-semibold text-[var(--mp-fg)]">
                {t("fyp_out_nodate_title")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
                {t("fyp_out_nodate_body")}
              </p>
            </div>
          )}
        </section>

        {/* Plan shape */}
        {planShape && (
          <section className="mt-6">
            <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-[var(--mp-fg)]">
              <Target className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />
              {t("fyp_out_plan_title")}
            </h2>
            <div className="mp-card p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-[var(--mp-surface-sunken)] p-3 text-center">
                  <div className="font-mono text-2xl font-black text-[var(--mp-fg)] tabular-nums">
                    {planShape.totalDays}
                  </div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--mp-fg-subtle)]">
                    {t("fyp_out_plan_days")}
                  </div>
                </div>
                <div className="rounded-xl bg-[var(--mp-surface-sunken)] p-3 text-center">
                  <div className="font-mono text-2xl font-black text-[var(--mp-fg)] tabular-nums">
                    {dailyGoal}
                  </div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[var(--mp-fg-subtle)]">
                    {t("fyp_out_plan_qpd")}
                  </div>
                </div>
              </div>
              {planShape.status !== "tight" && planShape.status !== "expired" && (
                <p className="mt-3 text-xs leading-relaxed text-[var(--mp-fg-muted)]">
                  {t("fyp_out_plan_split")}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-[var(--mp-fg-subtle)]">
                {t("fyp_out_plan_inapp")}
              </p>
            </div>
          </section>
        )}

        {/* Start here */}
        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 font-display text-base font-bold text-[var(--mp-fg)]">
            <BookOpen className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />
            {t("fyp_out_start_title")}
          </h2>
          <div className="mp-card p-4">
            <p className="text-xs leading-relaxed text-[var(--mp-fg-muted)]">
              {t("fyp_out_start_body")}
            </p>
            <Link
              href={freeHref}
              className="btn-secondary mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm"
            >
              {t("fyp_out_cta_practice")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </section>

        {/* Primary CTA into the app. Logged-in (entry point #2): their
            choice is already on the server, so send them to the study
            plan. Anon: create a free account (then the home post-auth
            sync carries the choice). */}
        <div className="mt-6">
          {loggedIn ? (
            <Link
              href="/study-plan"
              className="btn-primary flex h-[52px] w-full items-center justify-center gap-2 rounded-xl text-[15px]"
            >
              {t("fyp_out_cta_studyplan")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <Link
              href="/login"
              className="btn-primary flex h-[52px] w-full flex-col items-center justify-center rounded-xl text-[15px] leading-tight"
            >
              <span className="flex items-center gap-2">
                {t("fyp_out_cta_account")}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-[11px] font-medium text-white/80">
                {t("fyp_out_cta_account_sub")}
              </span>
            </Link>
          )}
          {!loggedIn && (
            <p className="mt-3 text-center text-[11px] leading-relaxed text-[var(--mp-fg-subtle)]">
              {t("fyp_out_price_note")}
            </p>
          )}
          <button
            type="button"
            onClick={onRestart}
            className="mx-auto mt-3 flex items-center gap-1.5 text-xs font-medium text-[var(--mp-fg-muted)] transition-colors hover:text-[var(--mp-fg)]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t("fyp_out_restart")}
          </button>
        </div>

        {/* Official source link (transparency, opens in new tab) */}
        <div className="mt-6 text-center">
          <a
            href={
              isKP
                ? "https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/"
                : "https://www.i-med.ac.at/studium/"
            }
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-viridian)] transition-colors"
          >
            {lang === "de" ? "Offizielle Informationen" : "Official information"}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </div>
      </div>
    </div>
  );
}
