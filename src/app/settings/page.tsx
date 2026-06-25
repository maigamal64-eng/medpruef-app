"use client";

/**
 * Settings — MPDS v2 "Settings-B" grouped-cards layout.
 *
 * 4 panels: Prüfung (exam setup), Lernen (learning/display), Konto
 * (account), Sprache (display language). Each card uses `.mp-card`
 * and semantic tokens (var(--mp-fg), var(--mp-surface-*) etc.) so
 * dark mode "just works" without hex overrides.
 *
 * Business logic is untouched: the page still PATCHes
 * `/api/user/exam-preference` with { examDate, dailyGoal } and still
 * writes the same localStorage profile. Only the shell + controls
 * were migrated to the MPDS primitives.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession, clearSession, storeSession } from "@/lib/auth";
import { getStoredTheme, setStoredTheme, type Theme } from "@/components/ThemeProvider";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import ExamSittingPicker from "@/components/ExamSittingPicker";
import {
  Alert,
  Dialog,
  DialogFooter,
  Select,
  TextField,
  useToast,
} from "@/components/ui";
import {
  ArrowRight,
  Clock,
  CloudDownload,
  Crown,
  Database,
  Globe,
  Info,
  LogOut,
  Moon,
  Shield,
  Sparkles,
  Sun,
  Target,
  Trash2,
} from "lucide-react";
import {
  clearAllOffline,
  countQuestions,
  getLastSync,
  putQuestions,
  setLastSync,
  type OfflineQuestion,
} from "@/lib/offlineDb";

type Lang = "de" | "en";

const PROFILE_KEY = "medpruef_profile";

interface ProfileData {
  university: string;
  country: string;
  targetDate: string;
  dailyGoal: number;
}

function loadProfile(): ProfileData {
  if (typeof window === "undefined") {
    return { university: "", country: "", targetDate: "", dailyGoal: 20 };
  }
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return { university: "", country: "", targetDate: "", dailyGoal: 20, ...data };
  } catch {
    return { university: "", country: "", targetDate: "", dailyGoal: 20 };
  }
}

function saveProfile(data: ProfileData) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
}

export default function SettingsPage() {
  const toast = useToast();
  const [lang, setLangState] = useState<Lang>("de");
  const [theme, setThemeState] = useState<Theme>("light");
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [profile, setProfile] = useState<ProfileData>({
    university: "",
    country: "",
    targetDate: "",
    dailyGoal: 20,
  });
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  // ── Offline-mode state ──
  // Live count of cached questions, preset-size selector, last-sync ISO
  // timestamp, a "downloading" flag for button disabled state, and a
  // confirm dialog for the destructive "clear offline data" action.
  const [offlineCount, setOfflineCount] = useState<number>(0);
  const [offlineSize, setOfflineSize] = useState<100 | 250 | 500>(250);
  const [offlineLastSync, setOfflineLastSync] = useState<string | null>(null);
  const [offlineDownloading, setOfflineDownloading] = useState(false);
  const [offlineClearOpen, setOfflineClearOpen] = useState(false);

  // ── Active-subscription snapshot ─────────────────────────────────
  // Populated from /api/user/subscription on mount. Drives the
  // "Current plan" card in the Konto panel — specifically the €19
  // first-month trial countdown and the day-25 "Pick your next plan"
  // CTA. null = still loading, false = no active subscription, else
  // the full snapshot.
  const [activeSub, setActiveSub] = useState<
    | null
    | false
    | {
        tier: string;
        tier_human_name: string;
        tier_human_name_de: string;
        expires_at: string | null;
        days_remaining: number | null;
        is_first_month_trial: boolean;
        is_puyp_eligible_tier: boolean;
      }
  >(null);

  // Live-tier read (review-2026-04-26-A2). The settings page used to
  // hard-code "Free" as the fallback when /api/user/subscription
  // returned no active row. But admin-granted Pro (the 14 Tier-1
  // grants on 2026-04-26) updates users.tier directly without
  // creating a subscriptions row — so Obai's account showed "Free"
  // despite tier='pro' in the DB. useUserTier hits /api/auth/me which
  // is the canonical read.
  const { tier: liveTier, tierExpiresAt: liveTierExpiresAt, isPaid: liveIsPaid } =
    useUserTier();

  useEffect(() => {
    setLangState(getLang());
    setThemeState(getStoredTheme());
    const stored = getStoredSession();
    setSession(stored);
    const local = loadProfile();
    // Hydrate from server-stored daily_goal when available — server is
    // the source of truth for Lernplan, localStorage is fallback-only.
    if (stored?.user?.daily_goal && stored.user.daily_goal !== local.dailyGoal) {
      const merged = { ...local, dailyGoal: stored.user.daily_goal };
      setProfile(merged);
      saveProfile(merged);
    } else {
      setProfile(local);
    }
    // Read the offline question count + last-sync timestamp. The exam
    // preference lives on the session; fall back to the default exam
    // if the user hasn't picked one yet.
    const activeExam =
      (stored?.user as { active_exam?: string } | undefined)?.active_exam ||
      "kenntnispruefung";
    countQuestions()
      .then(setOfflineCount)
      .catch(() => setOfflineCount(0));
    setOfflineLastSync(getLastSync(activeExam));

    // Fetch active subscription snapshot — only for logged-in (non-
    // guest) users, since guests have no server-side row. Failure modes
    // here are non-critical (the settings page still works without a
    // subscription card) so we silently fall back to "no active sub".
    if (stored?.user?.id && !stored.user.id.startsWith("guest_")) {
      authFetch("/api/user/subscription")
        .then(async (r) => {
          if (!r.ok) {
            setActiveSub(false);
            return;
          }
          const data = await r.json().catch(() => null);
          if (data?.active && data.subscription) {
            setActiveSub(data.subscription);
          } else {
            setActiveSub(false);
          }
        })
        .catch(() => setActiveSub(false));
    } else {
      setActiveSub(false);
    }
  }, []);

  /**
   * Best-effort PATCH to /api/user/exam-preference. Failures are
   * swallowed because the local state is already the source of truth
   * for non-Lernplan features; the Lernplan page will simply show "no
   * exam date" if the server never received the update.
   */
  const persistToServer = async (patch: { examDate?: string | null; dailyGoal?: number }) => {
    const stored = getStoredSession();
    if (!stored?.user?.id || stored.user.id.startsWith("guest_")) return;
    try {
      await authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (patch.dailyGoal !== undefined) {
        // Keep the session in sync so Lernplan sees the new value without a re-login.
        const fresh = getStoredSession();
        if (fresh?.user) {
          storeSession({
            ...fresh,
            user: { ...fresh.user, daily_goal: patch.dailyGoal },
          });
        }
      }
    } catch {
      // non-critical
    }
  };

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const handleThemeToggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setThemeState(next);
  };

  const handleDailyGoalChange = (value: number) => {
    const clamped = Math.max(5, Math.min(100, value));
    const updated = { ...profile, dailyGoal: clamped };
    setProfile(updated);
    saveProfile(updated);
    void persistToServer({ dailyGoal: clamped });
    toast.success(
      lang === "de" ? "Tagesziel gespeichert" : "Daily goal saved",
    );
  };

  const handleTargetDateChange = (value: string) => {
    const updated = { ...profile, targetDate: value };
    setProfile(updated);
    saveProfile(updated);
    // Empty string → clear. Otherwise send as YYYY-MM-DD.
    void persistToServer({ examDate: value || null });
    toast.success(
      value
        ? (lang === "de" ? "Prüfungstermin gespeichert" : "Exam date saved")
        : (lang === "de" ? "Prüfungstermin entfernt" : "Exam date cleared"),
    );
  };

  const handleClearData = () => {
    // Clear quiz-related localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        (key.startsWith("medpruef_notes_") ||
          key === "medpruef_favorites" ||
          key === "medpruef_quiz_autosave" ||
          key === "medpruef_weakness")
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    setClearDialogOpen(false);
    toast.success(t("data_cleared", lang));
  };

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  // ── Offline: download a batch and persist to IndexedDB ──
  const handleDownloadOffline = async () => {
    const activeExam =
      (session?.user as { active_exam?: string } | undefined)?.active_exam ||
      "kenntnispruefung";
    setOfflineDownloading(true);
    try {
      const res = await authFetch(
        `/api/offline/questions?examType=${encodeURIComponent(
          activeExam,
        )}&count=${offlineSize}`,
      );
      if (!res.ok) {
        toast.error(
          lang === "de" ? "Download fehlgeschlagen" : "Download failed",
          lang === "de"
            ? "Bitte überprüfe deine Verbindung und versuche es erneut."
            : "Check your connection and try again.",
        );
        return;
      }
      const data: { questions?: OfflineQuestion[] } = await res.json();
      const batch = Array.isArray(data.questions) ? data.questions : [];
      if (batch.length === 0) {
        toast.warning(
          lang === "de" ? "Keine Fragen verfügbar" : "No questions available",
        );
        return;
      }
      await putQuestions(batch);
      const now = new Date().toISOString();
      setLastSync(activeExam, now);
      setOfflineLastSync(now);
      const fresh = await countQuestions();
      setOfflineCount(fresh);
      toast.success(
        lang === "de"
          ? `${batch.length} Fragen heruntergeladen`
          : `${batch.length} questions downloaded`,
        lang === "de"
          ? "Du kannst jetzt offline weiterlernen."
          : "You can now keep studying offline.",
      );
    } catch (e) {
      console.error("[settings] offline download", e);
      toast.error(
        lang === "de" ? "Download fehlgeschlagen" : "Download failed",
      );
    } finally {
      setOfflineDownloading(false);
    }
  };

  const handleClearOffline = async () => {
    try {
      await clearAllOffline();
      setOfflineCount(0);
      setOfflineLastSync(null);
      setOfflineClearOpen(false);
      toast.success(
        lang === "de" ? "Offline-Daten gelöscht" : "Offline data cleared",
      );
    } catch (e) {
      console.error("[settings] clear offline", e);
      toast.error(
        lang === "de" ? "Löschen fehlgeschlagen" : "Could not clear offline data",
      );
    }
  };

  const user = session?.user;
  const gam = session?.gamification;
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  const isGuest = !user || user.id?.startsWith("guest_");
  const tierLabel = lang === "de" ? "Kostenlos" : "Free";

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={user?.id}
          userName={user?.first_name}
          totalXp={gam?.total_xp || 0}
          streak={gam?.current_streak || 0}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={user?.id} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border-subtle)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">{t("settings", lang)}</h1>
          <div className="w-16" />
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-5xl mx-auto pb-28">
          {/* Page intro */}
          <div className="mb-6">
            <h2 className="mp-h2 text-[var(--mp-fg)]">
              {lang === "de" ? "Einstellungen" : "Settings"}
            </h2>
            <p className="mp-small mt-1">
              {lang === "de"
                ? "Änderungen werden automatisch gespeichert."
                : "Changes are saved automatically."}
            </p>
          </div>

          {/* 2-col grid on desktop, single column on mobile */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* ═══ 1 · Prüfung ═══ */}
            <section className="mp-card p-6">
              <header className="mb-5">
                <h3 className="mp-h3 flex items-center gap-2">
                  <Target className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                  {lang === "de" ? "Prüfung" : "Exam"}
                </h3>
                <p className="mp-small mt-1">
                  {lang === "de"
                    ? "Welche Prüfung du ablegen möchtest und wann."
                    : "Which exam you plan to take and when."}
                </p>
              </header>

              <div className="space-y-5">
                {/* Exam target date — anchored on the real Austrian
                    sittings via the shared ExamSittingPicker (same control
                    as onboarding). Lets Telegram-only / preset-era users
                    whose exam_date is still NULL anchor to a real sitting. */}
                <div>
                  <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                    {t("exam_target_date", lang)}
                  </p>
                  <p className="text-xs text-[var(--mp-fg-subtle)] mb-3">
                    {lang === "de"
                      ? "Wähle deinen Prüfungstermin, um einen personalisierten Lernplan freizuschalten."
                      : "Pick your exam date to unlock a personalized study plan."}
                  </p>
                  <ExamSittingPicker
                    examType={(session?.user as { active_exam?: string } | undefined)?.active_exam || "kenntnispruefung"}
                    value={profile.targetDate}
                    onChange={handleTargetDateChange}
                    lang={lang}
                  />
                </div>

                {/* Daily goal */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {t("daily_goal_setting", lang)}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)]">
                        {lang === "de" ? "5–100 Fragen pro Tag" : "5–100 questions per day"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal - 5)}
                        className="w-9 h-9 rounded-lg border border-[var(--mp-border)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] transition-colors text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={profile.dailyGoal <= 5}
                        aria-label={lang === "de" ? "Ziel verringern" : "Decrease goal"}
                      >
                        −
                      </button>
                      <span className="w-10 text-center text-lg font-bold text-[var(--mp-viridian)] font-mono tabular-nums">
                        {profile.dailyGoal}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal + 5)}
                        className="w-9 h-9 rounded-lg border border-[var(--mp-border)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] transition-colors text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={profile.dailyGoal >= 100}
                        aria-label={lang === "de" ? "Ziel erhöhen" : "Increase goal"}
                      >
                        +
                      </button>
                    </div>
                  </div>
                  {/* Goal progress bar preview */}
                  <div
                    className="h-1.5 bg-[var(--mp-surface-sunken)] rounded-full overflow-hidden"
                    role="presentation"
                  >
                    <div
                      className="h-full bg-[var(--mp-viridian)] rounded-full transition-all duration-300"
                      style={{ width: `${profile.dailyGoal}%` }}
                    />
                  </div>
                </div>

                {/* Exam source (read-only summary) */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-sm font-semibold text-[var(--mp-fg)]">
                      {t("exam_source_label", lang)}
                    </p>
                    <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                      {lang === "de"
                        ? "Kenntnisprüfung Wien · Stichprobentest (Innsbruck) · Pharmakologie"
                        : "Kenntnisprüfung Vienna · Stichprobentest (Innsbruck) · Pharmacology"}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] text-xs font-semibold rounded-lg border border-[rgba(0,123,95,0.2)]">
                    3 {lang === "de" ? "Prüfungen" : "exams"}
                  </span>
                </div>
              </div>
            </section>

            {/* ═══ 2 · Lernen ═══ */}
            <section className="mp-card p-6">
              <header className="mb-5">
                <h3 className="mp-h3 flex items-center gap-2">
                  {theme === "dark" ? (
                    <Moon className="w-5 h-5 text-[var(--mp-info)]" aria-hidden />
                  ) : (
                    <Sun
                      className="w-5 h-5"
                      style={{ color: "var(--mp-status-warning)" }}
                      aria-hidden
                    />
                  )}
                  {lang === "de" ? "Lernen & Darstellung" : "Learning & Display"}
                </h3>
                <p className="mp-small mt-1">
                  {lang === "de"
                    ? "Farbschema und Lernvoreinstellungen."
                    : "Color scheme and learning defaults."}
                </p>
              </header>

              <div className="space-y-5">
                {/* Dark mode toggle */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {theme === "dark" ? (
                      <Moon className="w-5 h-5 text-[var(--mp-info)]" aria-hidden />
                    ) : (
                      <Sun
                        className="w-5 h-5"
                        style={{ color: "var(--mp-status-warning)" }}
                        aria-hidden
                      />
                    )}
                    <div>
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {t("dark_mode", lang)}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)]">
                        {theme === "dark"
                          ? lang === "de"
                            ? "Aktiviert"
                            : "Enabled"
                          : lang === "de"
                          ? "Deaktiviert"
                          : "Disabled"}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleThemeToggle}
                    role="switch"
                    aria-checked={theme === "dark"}
                    aria-label={t("dark_mode", lang)}
                    className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${
                      theme === "dark"
                        ? "bg-[var(--mp-cta-blue)]"
                        : "bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 flex items-center justify-center ${
                        theme === "dark" ? "translate-x-5" : "translate-x-0"
                      }`}
                    >
                      {theme === "dark" ? (
                        <Moon className="w-3.5 h-3.5 text-[var(--mp-cta-blue)]" aria-hidden />
                      ) : (
                        <Sun
                          className="w-3.5 h-3.5"
                          style={{ color: "var(--mp-status-warning)" }}
                          aria-hidden
                        />
                      )}
                    </span>
                  </button>
                </div>

                {/* Notifications (coming soon) inline alert */}
                <Alert
                  variant="info"
                  title={`${t("notifications", lang)} · ${t("coming_soon_label", lang)}`}
                >
                  {lang === "de"
                    ? "Tägliche Erinnerungen, Streak-Warnungen und wöchentliche Zusammenfassungen kommen bald."
                    : "Daily reminders, streak warnings, and weekly summaries are coming soon."}
                </Alert>
              </div>
            </section>

            {/* ═══ 2.5 · Offline-Modus ═══
                Backlog #7 — 6/11 surveys rank this as the #1 improvement.
                Lets the user pre-download a batch of questions into
                IndexedDB so the quiz keeps working on trains / hospital
                WiFi dead zones. Answers recorded offline queue locally
                and auto-sync when `initOfflineSync` sees `online` fire. */}
            <section className="mp-card p-6 lg:col-span-2">
              <header className="mb-5">
                <h3 className="mp-h3 flex items-center gap-2">
                  <CloudDownload
                    className="w-5 h-5 text-[var(--mp-viridian)]"
                    aria-hidden
                  />
                  {lang === "de" ? "Offline-Modus" : "Offline mode"}
                </h3>
                <p className="mp-small mt-1">
                  {lang === "de"
                    ? "Lade Fragen vorab herunter, um auch ohne Internet weiterzulernen."
                    : "Download questions ahead of time to keep studying without internet."}
                </p>
              </header>

              <div className="space-y-5">
                {/* Stat row — cached count + last sync */}
                <div className="flex items-start justify-between gap-4 p-4 rounded-[var(--mp-r-input)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)]">
                  <div className="flex items-center gap-3 min-w-0">
                    <Database
                      className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="text-lg font-bold text-[var(--mp-fg)] font-mono tabular-nums">
                        {offlineCount.toLocaleString(
                          lang === "de" ? "de-DE" : "en-US",
                        )}{" "}
                        <span className="text-sm font-semibold text-[var(--mp-fg-muted)]">
                          {lang === "de" ? "Fragen gespeichert" : "questions saved"}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                        {offlineLastSync
                          ? lang === "de"
                            ? `Zuletzt aktualisiert: ${new Date(offlineLastSync).toLocaleString("de-AT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                            : `Last updated: ${new Date(offlineLastSync).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
                          : lang === "de"
                            ? "Noch nicht heruntergeladen."
                            : "Not yet downloaded."}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Preset size chips */}
                <div>
                  <p className="text-sm font-semibold text-[var(--mp-fg)] mb-2">
                    {lang === "de"
                      ? "Wie viele Fragen herunterladen?"
                      : "How many questions to download?"}
                  </p>
                  <div
                    role="radiogroup"
                    aria-label={
                      lang === "de"
                        ? "Anzahl der Fragen"
                        : "Number of questions"
                    }
                    className="flex flex-wrap gap-2"
                  >
                    {[100, 250, 500].map((n) => {
                      const active = offlineSize === n;
                      return (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setOfflineSize(n as 100 | 250 | 500)}
                          className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                            active
                              ? "bg-[var(--mp-viridian)] text-white border-[var(--mp-viridian)]"
                              : "bg-[var(--mp-surface-raised)] text-[var(--mp-fg-muted)] border-[var(--mp-border)] hover:border-[var(--mp-viridian)] hover:text-[var(--mp-fg)]"
                          }`}
                        >
                          {n.toLocaleString(
                            lang === "de" ? "de-DE" : "en-US",
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-[var(--mp-fg-subtle)] mt-2">
                    {lang === "de"
                      ? "Größere Pakete brauchen länger und mehr Speicher."
                      : "Larger packs take longer and use more storage."}
                  </p>
                </div>

                {/* Action buttons — stacked on mobile, inline on desktop */}
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleDownloadOffline}
                    disabled={offlineDownloading || isGuest}
                    className="mp-btn mp-btn--primary w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CloudDownload className="w-4 h-4" aria-hidden />
                    {offlineDownloading
                      ? lang === "de"
                        ? "Lädt…"
                        : "Downloading…"
                      : lang === "de"
                        ? "Herunterladen"
                        : "Download"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setOfflineClearOpen(true)}
                    disabled={offlineCount === 0}
                    className="mp-btn mp-btn--ghost w-full sm:w-auto disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                    {lang === "de"
                      ? "Offline-Daten löschen"
                      : "Clear offline data"}
                  </button>
                </div>

                {/* Guest warning — offline requires a real user row for sync */}
                {isGuest && (
                  <Alert
                    variant="info"
                    title={
                      lang === "de"
                        ? "Anmeldung erforderlich"
                        : "Sign-in required"
                    }
                  >
                    {lang === "de"
                      ? "Der Offline-Modus ist nur für angemeldete Nutzer verfügbar — nur so können beantwortete Fragen später synchronisiert werden."
                      : "Offline mode is only available to signed-in users — so that answers recorded offline can sync back to your account."}
                  </Alert>
                )}
              </div>
            </section>

            {/* ═══ 3 · Konto ═══ */}
            <section className="mp-card p-6">
              <header className="mb-5">
                <h3 className="mp-h3 flex items-center gap-2">
                  <Crown className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                  {lang === "de" ? "Konto" : "Account"}
                </h3>
                <p className="mp-small mt-1">
                  {lang === "de"
                    ? "Abo, Anmeldung und Datenschutz."
                    : "Plan, sign-in, and privacy."}
                </p>
              </header>

              <div className="space-y-5">
                {/* Email */}
                {user?.email && (
                  <div>
                    <p className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wide mb-1">
                      {lang === "de" ? "E-Mail" : "Email"}
                    </p>
                    <p className="text-sm text-[var(--mp-fg)] font-mono break-all">
                      {user.email}
                    </p>
                  </div>
                )}

                {/* Current tier / active subscription
                    Three branches:
                      1. activeSub object → /api/user/subscription found
                         a real subscriptions row (card- or crypto-paid).
                         Render the rich SubscriptionCard with countdown.
                      2. !activeSub but liveIsPaid → admin-granted Pro
                         (no subscriptions row exists; users.tier was
                         updated directly by /api/admin/users/<id>/grant).
                         Render a minimal Pro card with the expiry from
                         /api/auth/me. review-2026-04-26-A2.
                      3. !activeSub && !liveIsPaid → genuine free user. */}
                {activeSub ? (
                  <SubscriptionCard sub={activeSub} lang={lang} />
                ) : liveIsPaid ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {lang === "de" ? "Aktueller Tarif" : "Current plan"}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                        {liveTierExpiresAt
                          ? lang === "de"
                            ? `Pro · gültig bis ${new Date(liveTierExpiresAt).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}`
                            : `Pro · valid until ${new Date(liveTierExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
                          : lang === "de"
                            ? "Pro · Vollzugriff aktiv"
                            : "Pro · full access active"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] text-xs font-semibold rounded-lg border border-[rgba(0,123,95,0.2)]">
                      {liveTier === "admin" ? (lang === "de" ? "Admin" : "Admin") : "Pro"}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {lang === "de" ? "Aktueller Tarif" : "Current plan"}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                        {lang === "de"
                          ? "Kostenlos · 150 Fragen pro Prüfung"
                          : "Free · 150 questions per exam"}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] text-xs font-semibold rounded-lg border border-[var(--mp-border-subtle)]">
                      {tierLabel}
                    </span>
                  </div>
                )}

                {/* Upgrade CTA for free users / neutral pricing link for Pro/admin */}
                {liveIsPaid ? (
                  <Link
                    href="/pricing"
                    className="flex items-center justify-between p-3 rounded-[var(--mp-r-input)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] hover:border-[rgba(0,123,95,0.3)] group transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Crown className="w-4 h-4 text-[var(--mp-accent)]" aria-hidden />
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {lang === "de" ? "Preise & Tarife ansehen" : "See pricing & plans"}
                      </p>
                    </div>
                    <ArrowRight
                      className="w-4 h-4 text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-viridian)] group-hover:translate-x-0.5 transition-all"
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <Link
                    href="/pricing"
                    className="flex items-center justify-between p-3 rounded-[var(--mp-r-input)] bg-[var(--mp-oxford-blue,#001B3D)] hover:opacity-90 group transition-opacity"
                  >
                    <div className="flex items-center gap-3">
                      <Sparkles className="w-4 h-4 text-white/80" aria-hidden />
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {lang === "de" ? "Auf Pro upgraden" : "Upgrade to Pro"}
                        </p>
                        <p className="text-xs text-white/70">
                          {lang === "de"
                            ? "Unbegrenzter Zugang ab 19 €"
                            : "Unlimited access from 19 €"}
                        </p>
                      </div>
                    </div>
                    <ArrowRight
                      className="w-4 h-4 text-white/60 group-hover:text-white group-hover:translate-x-0.5 transition-all"
                      aria-hidden
                    />
                  </Link>
                )}

                {/* Clear study data */}
                <div className="pt-2 border-t border-[var(--mp-border-subtle)]">
                  <p className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wide mb-3 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5" aria-hidden />
                    {t("data_privacy", lang)}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {t("clear_data", lang)}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)]">
                        {lang === "de"
                          ? "Lesezeichen, Notizen und Quiz-Daten entfernen"
                          : "Remove bookmarks, notes, and quiz data"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setClearDialogOpen(true)}
                      className="mp-btn mp-btn--destructive mp-btn--sm flex-shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden />
                      {t("clear_data", lang)}
                    </button>
                  </div>
                </div>

                {/* Logout */}
                {user && !isGuest && (
                  <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--mp-border-subtle)]">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--mp-fg)]">
                        {t("logout", lang)}
                      </p>
                      <p className="text-xs text-[var(--mp-fg-subtle)]">
                        {user.first_name} ·{" "}
                        {lang === "de" ? "angemeldet" : "signed in"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="mp-btn mp-btn--destructive mp-btn--sm flex-shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" aria-hidden />
                      {t("logout", lang)}
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* ═══ 4 · Sprache ═══ */}
            <section className="mp-card p-6">
              <header className="mb-5">
                <h3 className="mp-h3 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden />
                  {t("language", lang)}
                </h3>
                <p className="mp-small mt-1">
                  {lang === "de"
                    ? "Sprache der Benutzeroberfläche."
                    : "Interface language."}
                </p>
              </header>

              <div className="space-y-5">
                <Select
                  label={lang === "de" ? "Oberflächensprache" : "Interface language"}
                  helper={
                    lang === "de"
                      ? "Die Prüfungsfragen bleiben in Deutsch."
                      : "Exam questions remain in German."
                  }
                  value={lang}
                  onChange={(e) => switchLang(e.target.value as Lang)}
                  options={[
                    { value: "de", label: "Deutsch" },
                    { value: "en", label: "English" },
                  ]}
                />

                {/* About */}
                <div className="pt-3 border-t border-[var(--mp-border-subtle)]">
                  <div className="flex items-center gap-2 mb-3">
                    <Info className="w-4 h-4 text-[var(--mp-info)]" aria-hidden />
                    <p className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wide">
                      {t("about", lang)}
                    </p>
                  </div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-[var(--mp-fg-muted)]">
                      {t("app_version", lang)}
                    </p>
                    <span className="text-sm font-mono text-[var(--mp-viridian)]">
                      MedPr&uuml;f v1.0
                    </span>
                  </div>
                  <p className="text-xs text-[var(--mp-fg-subtle)] mb-3">
                    {lang === "de"
                      ? "Österreichische Medizinprüfungen — über 10.000 Fragen"
                      : "Austrian medical exams — over 10,000 questions"}
                  </p>
                  <Link
                    href="/about"
                    className="text-sm text-[var(--mp-viridian)] hover:text-[var(--mp-accent)] transition-colors font-semibold inline-flex items-center gap-1"
                  >
                    {lang === "de" ? "Mehr erfahren" : "Learn more"}
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>

      {/* Destructive confirm dialog */}
      <Dialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title={t("clear_data", lang)}
        description={
          lang === "de"
            ? "Lesezeichen, Notizen, Quiz-Autosave und lokale Schwachstellen-Daten werden entfernt."
            : "Bookmarks, notes, quiz autosave, and local weakness data will be removed."
        }
        footer={
          <DialogFooter>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setClearDialogOpen(false)}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--destructive"
              onClick={handleClearData}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              {t("clear_data", lang)}
            </button>
          </DialogFooter>
        }
      >
        <Alert
          variant="warning"
          title={lang === "de" ? "Kann nicht rückgängig gemacht werden" : "Cannot be undone"}
        >
          {t("clear_data_confirm", lang)}
        </Alert>
      </Dialog>

      {/* Offline-data confirm dialog — separate from the general clear
          dialog so the copy can be specific about IndexedDB questions +
          pending-answer queue. Queued answers will be lost if the user
          clears before they sync. */}
      <Dialog
        open={offlineClearOpen}
        onOpenChange={setOfflineClearOpen}
        title={
          lang === "de" ? "Offline-Daten löschen?" : "Clear offline data?"
        }
        description={
          lang === "de"
            ? "Alle heruntergeladenen Fragen und nicht synchronisierte Antworten werden entfernt."
            : "All downloaded questions and unsynced answers will be removed."
        }
        footer={
          <DialogFooter>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setOfflineClearOpen(false)}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--destructive"
              onClick={handleClearOffline}
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              {lang === "de" ? "Löschen" : "Clear"}
            </button>
          </DialogFooter>
        }
      >
        <Alert
          variant="warning"
          title={
            lang === "de"
              ? "Nicht synchronisierte Antworten gehen verloren"
              : "Unsynced answers will be lost"
          }
        >
          {lang === "de"
            ? "Falls du Antworten offline gegeben hast, die noch nicht an den Server gesendet wurden, werden diese gelöscht."
            : "Any answers you recorded offline that have not yet been sent to the server will be deleted."}
        </Alert>
      </Dialog>
    </AppLayout>
  );
}

/* ═══════════════════════ SubscriptionCard ═══════════════════════ */

/**
 * Renders the user's active subscription inside the Konto panel.
 *
 * Special treatment for the €19 first-month trial (tier ==
 * 'first_month_19'):
 *   - Countdown chip showing days_remaining.
 *   - At day 25+ OR when days_remaining <= 5, a prominent CTA invites
 *     the user to pick a longer plan. "Pick your next plan" routes to
 *     /pricing — we intentionally don't auto-redirect or pre-select, to
 *     respect the "never auto-renew" promise.
 *   - At any earlier point, a calmer "you're on the €19 trial" copy.
 *
 * Non-trial tiers (Cohort / Pro / etc.) show a simpler summary with
 * the tier name, status, and expiry.
 */
function SubscriptionCard({
  sub,
  lang,
}: {
  sub: {
    tier: string;
    tier_human_name: string;
    tier_human_name_de: string;
    expires_at: string | null;
    days_remaining: number | null;
    is_first_month_trial: boolean;
    is_starter_3mo_trial?: boolean;
    is_puyp_eligible_tier: boolean;
  };
  lang: Lang;
}) {
  const humanName =
    lang === "de" ? sub.tier_human_name_de : sub.tier_human_name;
  const expiresLabel = sub.expires_at
    ? new Date(sub.expires_at).toLocaleDateString(
        lang === "de" ? "de-AT" : "en-GB",
        { year: "numeric", month: "long", day: "numeric" },
      )
    : null;

  const days = sub.days_remaining ?? 0;
  // Day-25 reminder rule from the brief: at day 25+ of a 30-day trial
  // (i.e. 5 or fewer days remaining), light up the "Pick your next
  // plan" CTA. Defensive min(<=5, >0) so expired rows (0) don't flash
  // the picker — that state should already have flipped via the cron.
  // For the €27 / 3-month entry tier we use a wider 14-day window so
  // the user has more lead-time to evaluate Cohort vs single-month
  // before access lapses (90-day arc, not 30-day).
  const showTrialPicker =
    (sub.is_first_month_trial && days > 0 && days <= 5) ||
    (sub.is_starter_3mo_trial === true && days > 0 && days <= 14);
  // Both the €19 single-month and the €27 / 3-month entry tier render
  // through the same compact trial-card layout — same trust signals,
  // same countdown, same "Pick your next plan" CTA. The card body text
  // already adapts to the live `humanName` so a `first_3mo_27` row
  // reads "3-Monats-Einstieg" and a `first_month_19` row reads
  // "Einzelmonat" without further branching.
  const isTrialCard =
    sub.is_first_month_trial || sub.is_starter_3mo_trial === true;

  if (isTrialCard) {
    // ── €19 first-month trial card ──
    return (
      <div
        className="rounded-[var(--mp-r-card)] p-5 flex flex-col gap-4"
        style={{
          background: "var(--mp-surface-sunken)",
          border: `1px solid ${
            showTrialPicker
              ? "rgba(244,162,97,0.35)"
              : "var(--mp-border-subtle)"
          }`,
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[var(--mp-fg-muted)] uppercase tracking-wide mb-1">
              {lang === "de" ? "Aktueller Tarif" : "Current plan"}
            </p>
            <p className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
              <Sparkles
                className="w-4 h-4 text-[var(--mp-cta-blue)]"
                aria-hidden
              />
              {humanName}
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)] mt-1">
              {lang === "de"
                ? "Einmalige Zahlung · keine automatische Verlängerung"
                : "One-time payment · no auto-renewal"}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap"
            style={{
              background: showTrialPicker
                ? "rgba(244,162,97,0.12)"
                : "rgba(0,58,140,0.08)",
              color: showTrialPicker
                ? "var(--mp-warning)"
                : "var(--mp-cta-blue)",
              border: `1px solid ${
                showTrialPicker
                  ? "rgba(244,162,97,0.3)"
                  : "rgba(0,58,140,0.22)"
              }`,
            }}
          >
            <Clock className="w-3 h-3" aria-hidden />
            {days === 1
              ? lang === "de"
                ? "1 Tag übrig"
                : "1 day left"
              : lang === "de"
                ? `${days} Tage übrig`
                : `${days} days left`}
          </span>
        </div>

        {expiresLabel && (
          <p className="text-xs text-[var(--mp-fg-subtle)]">
            {lang === "de"
              ? `Zugang läuft am ${expiresLabel} aus.`
              : `Access expires on ${expiresLabel}.`}
          </p>
        )}

        {showTrialPicker ? (
          <div
            className="rounded-[var(--mp-r-input)] p-4 flex flex-col gap-3"
            style={{
              background: "var(--mp-surface-raised)",
              border: "1px solid rgba(244,162,97,0.25)",
            }}
          >
            <p className="text-sm font-semibold text-[var(--mp-fg)]">
              {lang === "de"
                ? "Wähle deinen nächsten Tarif"
                : "Pick your next plan"}
            </p>
            <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
              {lang === "de"
                ? "Dein 1-Monats-Test läuft bald aus. Wir verlängern nichts automatisch — du entscheidest selbst, ob du weitermachst."
                : "Your 1-month trial ends soon. Nothing will renew automatically — you decide whether to continue."}
            </p>
            <Link
              href="/pricing"
              className="mp-btn mp-btn--primary inline-flex items-center justify-center gap-2 self-start"
            >
              {lang === "de" ? "Tarife ansehen" : "See all plans"}
              <ArrowRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
            {lang === "de"
              ? "Am Tag 25 schreiben wir dir. Wenn du vorher einen längeren Tarif wählst, aktiviert sich der beim Ende deines Tests automatisch."
              : "We'll email you on day 25. If you pick a longer plan before then, it activates automatically when this trial ends."}
          </p>
        )}
      </div>
    );
  }

  // ── Non-trial paid tier (Cohort / Pro) ──
  return (
    <div
      className="flex items-center justify-between p-4 rounded-[var(--mp-r-input)] gap-3"
      style={{
        background: "var(--mp-success-bg)",
        border: "1px solid rgba(0,123,95,0.2)",
      }}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[var(--mp-viridian)] uppercase tracking-wide mb-1">
          {lang === "de" ? "Aktueller Tarif" : "Current plan"}
        </p>
        <p className="text-sm font-bold text-[var(--mp-fg)] flex items-center gap-1.5">
          <Crown
            className="w-3.5 h-3.5 text-[var(--mp-viridian)] flex-shrink-0"
            aria-hidden
          />
          {humanName}
        </p>
        {expiresLabel && (
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
            {lang === "de"
              ? `Gültig bis ${expiresLabel}`
              : `Valid until ${expiresLabel}`}
          </p>
        )}
      </div>
      <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[var(--mp-surface-raised)] text-[var(--mp-viridian)] text-xs font-semibold rounded-lg border border-[rgba(0,123,95,0.25)] whitespace-nowrap">
        {lang === "de" ? "Aktiv" : "Active"}
      </span>
    </div>
  );
}
