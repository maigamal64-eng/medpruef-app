"use client";
import PendingPaymentBanner from "@/components/PendingPaymentBanner";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import BillingReceipt from "@/components/BillingReceipt";

/**
 * Settings — "Clinical Nocturne" reimplementation (2026-06-26).
 *
 * Approved design: reviews/reimplementation-2026-06-26/design/
 *   09-settings-materials.html + SPECS.md §7.
 *
 * Layout: a merged profile card (avatar / name+rank / email / live tier
 * chip — the old /profile is folded in here) followed by grouped setting
 * rows — Lernen (exam date, daily goal, active exam), Darstellung (theme
 * segmented, language segmented, reminders switch) and Konto (subscription,
 * data-reset, logout). Offline-Modus keeps its own card (a real feature
 * with live IndexedDB data). Spark (teal) stays OFF this surface by design
 * — there is no progress/active/live here, and that restraint is the
 * premium signal (SPECS §"spark discipline").
 *
 * Data layer is UNCHANGED from the prior implementation: same useEffect
 * hydration, same PATCH to /api/user/exam-preference with
 * { examDate, dailyGoal }, same localStorage profile, same offline-mode
 * handlers, the same SubscriptionCard + EmailLinkCard sub-components, and
 * the same two confirm dialogs. Only the presentation was rebuilt onto the
 * grouped-rows grammar + MPDS tokens.
 *
 * Gamification weave: the profile card surfaces the user's live rank +
 * level from src/lib/xp.ts (getLevelFromXP) as a calm, earned sub-line —
 * no XP bar, no confetti, no spark. Achievement-as-identity, not arcade.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, useLang, renderLang, t } from "@/lib/i18n";
import LanguagePicker from "@/components/LanguagePicker";
import { getStoredSession, clearSession, storeSession } from "@/lib/auth";
import { listNoteQuestionIds, noteStorageKey } from "@/lib/notes-store";
import { clearAccountBookmarks, bookmarkStorageKey } from "@/lib/bookmarks";
import { getStoredTheme, setStoredTheme, type Theme } from "@/components/ThemeProvider";
import { authFetch } from "@/lib/authFetch";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { getLevelFromXP } from "@/lib/xp";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout, Card } from "@/components/ui";
import { shortSubscriptionLabel, subscriptionBillingState, type SubscriptionCardSnapshot } from "@/lib/subscription-display";
import ExamSittingPicker from "@/components/ExamSittingPicker";
import {
  BILLING_SUPPORT_EMAIL,
  SUPPORT_REPLY_PROMISE,
  billingAccountSentence,
} from "@/lib/billing-copy";
import { EXAM_SOURCES, setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import {
  Alert,
  Dialog,
  DialogFooter,
  TextField,
  useToast,
} from "@/components/ui";
import {
  ArrowRight,
  BookMarked,
  CalendarDays,
  CloudDownload,
  Crown,
  Database,
  Eye,
  EyeOff,
  Languages,
  LogOut,
  Mail,
  Moon,
  Sparkles,
  Sun,
  Trash2,
  Zap,
} from "lucide-react";
import {
  clearOfflineQuestions,
  clearLastSync,
  claimUnownedPendingAnswersForUser,
  countPendingAnswers,
  countUnownedPendingAnswers,
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

/** Two-letter avatar initials from the user's name (or "MP" fallback). */
function initialsOf(first?: string, last?: string): string {
  const a = (first || "").trim();
  const b = (last || "").trim();
  if (a && b) return (a[0] + b[0]).toUpperCase();
  if (a) return a.slice(0, 2).toUpperCase();
  return "MP";
}

export default function SettingsPage() {
  const toast = useToast();
  const [lang, setLangState] = useState<Lang>("de");
  const uiLang = useLang();
  useEffect(() => { setLangState(renderLang(uiLang)); }, [uiLang]);
  const [theme, setThemeState] = useState<Theme>("light");
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [serverActiveExam, setServerActiveExam] = useState<ExamSourceId | null>(null);
  const [examDateSaved, setExamDateSaved] = useState(false);
  const [returnToStudyPlan, setReturnToStudyPlan] = useState(false);
  const [serverExamDate, setServerExamDate] = useState<string | null | undefined>(undefined);
  const [profile, setProfile] = useState<ProfileData>({
    university: "",
    country: "",
    targetDate: "",
    dailyGoal: 20,
  });
  const [examPickerOpen, setExamPickerOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  // ── Offline-mode state ──
  // Live count of cached questions, preset-size selector, last-sync ISO
  // timestamp, a "downloading" flag for button disabled state, and a
  // confirm dialog for the destructive "clear offline data" action.
  const [offlineCount, setOfflineCount] = useState<number>(0);
  const [offlinePendingCount, setOfflinePendingCount] = useState<number>(0);
  const [offlineLegacyPendingCount, setOfflineLegacyPendingCount] = useState<number>(0);
  const [legacyRecoveryOpen, setLegacyRecoveryOpen] = useState(false);
  const [legacyRecoveryUserId, setLegacyRecoveryUserId] = useState<string | null>(null);
  const [legacyRecoveryBusy, setLegacyRecoveryBusy] = useState(false);
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
  const [activeSub, setActiveSub] = useState<SubscriptionCardSnapshot | null | false>(null);

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
    countPendingAnswers(stored?.user?.id).then(setOfflinePendingCount).catch(() => setOfflinePendingCount(0));
    countUnownedPendingAnswers()
      .then(setOfflineLegacyPendingCount)
      .catch(() => setOfflineLegacyPendingCount(0));
    setOfflineLastSync(getLastSync(activeExam));

    // The cached session can survive an exam-preference change on another
    // device. Settings reads the authenticated server value so its summary
    // and date agree with the study plan. The cached values remain the
    // fallback while offline or before the request resolves.
    if (stored?.user?.id && !stored.user.id.startsWith("guest_")) {
      const userId = stored.user.id;
      authFetch("/api/user/exam-preference")
        .then(async (response) => {
          if (!response.ok) return;
          const data = await response.json().catch(() => null);
          if (getStoredSession()?.user?.id !== userId) return;
          const validExam = EXAM_SOURCES.some((source) => source.id === data?.activeExam);
          if (validExam) {
            const canonicalExam = data.activeExam as ExamSourceId;
            setServerActiveExam(canonicalExam);
            setStoredExamSource(canonicalExam);
            setOfflineLastSync(getLastSync(canonicalExam));
            const fresh = getStoredSession();
            if (fresh?.user) {
              const updated = { ...fresh, user: { ...fresh.user, active_exam: canonicalExam } };
              storeSession(updated);
              setSession(updated);
            }
          }
          setServerExamDate(typeof data?.examDate === "string" ? data.examDate : null);
        })
        .catch(() => { /* cached settings remain available offline */ });
    } else {
      setServerExamDate(null);
    }

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
          if (data?.subscription) {
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
  useEffect(() => {
    const url = new URL(window.location.href);
    setReturnToStudyPlan(url.searchParams.get("returnTo") === "/study-plan");
    if (url.hash === "#exam-date") setExamPickerOpen(true);
  }, []);

  const persistToServer = async (patch: { examDate?: string | null; dailyGoal?: number }) => {
    const stored = getStoredSession();
    if (!stored?.user?.id || stored.user.id.startsWith("guest_")) return false;
    try {
      const response = await authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) return false;
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
      return true;
    } catch {
      return false;
    }
  };

  const applyTheme = (next: Theme) => {
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

  const handleTargetDateChange = async (value: string) => {
    setExamDateSaved(false);
    const saved = await persistToServer({ examDate: value || null });
    if (!saved) {
      toast.error(lang === "de" ? "Prüfungstermin konnte nicht gespeichert werden" : "Could not save exam date");
      return;
    }
    const updated = { ...profile, targetDate: value };
    setProfile(updated);
    setServerExamDate(value || null);
    saveProfile(updated);
    setExamDateSaved(Boolean(value));
    toast.success(value
      ? (lang === "de" ? "Prüfungstermin gespeichert" : "Exam date saved")
      : (lang === "de" ? "Prüfungstermin entfernt" : "Exam date cleared"));
  };

  const handleClearData = () => {
    // Clear this account's notes and bookmark cache only. Ownerless legacy
    // favorites and other account caches may belong to another browser user.
    const userId = getStoredSession()?.user?.id || null;
    if (userId) {
      for (const questionId of listNoteQuestionIds(userId)) {
        const noteKey = noteStorageKey(questionId, userId);
        if (noteKey) localStorage.removeItem(noteKey);
      }
      void clearAccountBookmarks(userId);
    }
    // Clear quiz-related localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (
        key &&
        ((userId && key === bookmarkStorageKey(userId)) ||
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
          ? "Sie stehen bei kurzen Verbindungsabbrüchen in einer geöffneten Sitzung bereit."
          : "They are ready for brief connection drops during an open session.",
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
      await clearOfflineQuestions();
      setOfflineCount(0);
      setOfflineLastSync(null);
      const activeExam =
        (getStoredSession()?.user as { active_exam?: string } | undefined)?.active_exam ||
        "kenntnispruefung";
      clearLastSync(activeExam);
      setOfflineClearOpen(false);
      toast.success(lang === "de" ? "Heruntergeladene Fragen gelöscht" : "Downloaded questions cleared");
    } catch (e) {
      console.error("[settings] clear offline", e);
      toast.error(
        lang === "de" ? "Löschen fehlgeschlagen" : "Could not clear offline data",
      );
    }
  };

  const handleClaimLegacyOfflineAnswers = async () => {
    const currentUserId = getStoredSession()?.user?.id;
    if (!legacyRecoveryUserId || currentUserId !== legacyRecoveryUserId || isGuest || currentUserId?.startsWith("guest_")) {
      setLegacyRecoveryOpen(false);
      toast.error(lang === "de" ? "Konto geändert. Bitte erneut prüfen." : "Account changed. Please review again.");
      return;
    }
    setLegacyRecoveryBusy(true);
    try {
      const claimed = await claimUnownedPendingAnswersForUser(currentUserId);
      const [legacyCount, accountCount] = await Promise.all([
        countUnownedPendingAnswers(),
        countPendingAnswers(currentUserId),
      ]);
      setOfflineLegacyPendingCount(legacyCount);
      setOfflinePendingCount(accountCount);
      setLegacyRecoveryOpen(false);
      setLegacyRecoveryUserId(null);
      toast.success(lang === "de"
        ? `${claimed} ältere Antworten diesem Konto zugeordnet.`
        : `${claimed} older answers assigned to this account.`);
      if (typeof navigator !== "undefined" && navigator.onLine) {
        window.dispatchEvent(new Event("online"));
      }
    } catch (error) {
      console.error("[settings] recover legacy offline answers", error);
      toast.error(lang === "de" ? "Antworten konnten nicht übernommen werden" : "Could not recover answers");
    } finally {
      setLegacyRecoveryBusy(false);
    }
  };

  const user = session?.user;
  const gam = session?.gamification;
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  const isGuest = !user || user.id?.startsWith("guest_");

  // ── Profile-card derived values ──
  const displayName =
    [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim() ||
    (lang === "de" ? "Gast" : "Guest");
  const avatarInitials = initialsOf(user?.first_name, user?.last_name);
  const { level: rankLevel, rank: rankName } = getLevelFromXP(gam?.total_xp || 0);
  // Calm tier label for the profile chip. Paid cohorts surface their human
  // name; admin shows Admin; everyone else reads Kostenlos.
  const tierChipLabel =
    activeSub && (activeSub as { tier_human_name_de?: string }).tier_human_name_de
      ? lang === "de"
        ? (activeSub as { tier_human_name_de: string }).tier_human_name_de
        : (activeSub as { tier_human_name: string }).tier_human_name
      : liveTier === "admin"
        ? "Admin"
        : liveIsPaid
          ? "Pro"
          : lang === "de"
            ? "Kostenlos"
            : "Free";
  const tierChipIsPaid = liveIsPaid || !!activeSub;

  // Resolve the active-exam display label from the canonical source.
  const activeExamId =
    serverActiveExam ||
    (user as { active_exam?: string } | undefined)?.active_exam ||
    "kenntnispruefung";
  const activeExamLabel =
    EXAM_SOURCES.find((e) => e.id === activeExamId)?.label ||
    "Kenntnisprüfung Wien";
  const preferenceTargetDate =
    serverExamDate === undefined ? profile.targetDate : serverExamDate || "";

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
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-bg)]">
        <PendingPaymentBanner />
        <PartialTranslationNote />
        <BillingReceipt />
        {/* Scoped presentation styles for the grouped-rows grammar.
            Settings-only — no globals.css / shared-primitive edits. All
            colors are MPDS tokens so light + dark + DE/EN "just work". */}
        <style jsx>{`
          .set-wrap {
            max-width: 880px;
            margin: 0 auto;
            padding: 20px 16px 120px;
          }
          @media (min-width: 1024px) {
            .set-wrap {
              padding: 28px 32px 64px;
            }
          }
          .set-pagehead h1 {
            font-family: var(--mp-font-display);
            font-weight: 800;
            font-size: 22px;
            color: var(--mp-fg);
            letter-spacing: -0.01em;
          }
          .set-pagehead p {
            font-size: 13px;
            color: var(--mp-fg-subtle);
            margin-top: 4px;
          }
          /* profile card (merged /profile) */
          .profile-card {
            margin-top: 18px;
            background: var(--mp-surface);
            border: 1px solid var(--mp-border-soft);
            border-radius: var(--mp-r-card);
            padding: 18px;
            box-shadow: var(--mp-shadow-card);
            display: flex;
            align-items: center;
            gap: 14px;
          }
          .pc-av {
            width: 54px;
            height: 54px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--mp-cta-blue), var(--mp-oxford-blue));
            color: #fff;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: var(--mp-font-display);
            font-weight: 700;
            font-size: 19px;
            flex-shrink: 0;
          }
          .pc-body {
            flex: 1;
            min-width: 0;
          }
          .pc-name {
            font-family: var(--mp-font-display);
            font-weight: 800;
            font-size: 17px;
            color: var(--mp-fg);
            line-height: 1.2;
          }
          .pc-rank {
            font-size: 12px;
            color: var(--mp-fg-muted);
            margin-top: 3px;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .pc-rank .pc-lvl {
            font-family: var(--mp-font-mono);
            font-weight: 700;
            color: var(--mp-viridian);
          }
          .pc-mail {
            font-size: 12px;
            color: var(--mp-fg-subtle);
            margin-top: 2px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .pc-tier {
            display: inline-flex;
            align-items: center;
            gap: 5px;
            margin-top: 8px;
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            padding: 3px 9px;
            border-radius: 9999px;
          }
          .pc-tier :global(svg) {
            width: 12px;
            height: 12px;
          }
          .pc-tier.paid {
            color: var(--mp-viridian);
            background: var(--mp-success-bg);
          }
          .pc-tier.free {
            color: var(--mp-fg-muted);
            background: var(--mp-surface-sunken);
          }
          /* grouped setting cards */
          .set-group {
            margin-top: 20px;
          }
          .set-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            color: var(--mp-fg-subtle);
            padding: 0 4px 9px;
          }
          .set-card {
            background: var(--mp-surface);
            border: 1px solid var(--mp-border-soft);
            border-radius: var(--mp-r-card);
            overflow: hidden;
            box-shadow: var(--mp-shadow-card);
          }
          .set-row {
            display: flex;
            align-items: center;
            gap: 13px;
            padding: 14px 15px;
            border-bottom: 1px solid var(--mp-border-soft);
            text-align: left;
            width: 100%;
            background: transparent;
          }
          .set-row:last-child {
            border-bottom: none;
          }
          button.set-row {
            cursor: pointer;
            transition: background var(--mp-dur-base);
          }
          button.set-row:hover {
            background: var(--mp-surface-sunken);
          }
          .sr-ic {
            width: 34px;
            height: 34px;
            border-radius: 9px;
            background: var(--mp-surface-sunken);
            color: var(--mp-fg-muted);
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
          }
          .sr-ic :global(svg) {
            width: 18px;
            height: 18px;
          }
          .sr-body {
            flex: 1;
            min-width: 0;
          }
          .sr-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--mp-fg);
          }
          .sr-sub {
            font-size: 12px;
            color: var(--mp-fg-subtle);
            margin-top: 1px;
          }
          .sr-ctrl {
            flex-shrink: 0;
          }
          .sr-val {
            font-size: 13px;
            font-weight: 600;
            color: var(--mp-fg-muted);
            display: flex;
            align-items: center;
            gap: 5px;
          }
          .sr-val :global(svg) {
            width: 15px;
            height: 15px;
            color: var(--mp-fg-subtle);
          }
          /* segmented control (theme / language) */
          .seg {
            display: flex;
            background: var(--mp-surface-sunken);
            border-radius: 9px;
            padding: 3px;
            gap: 3px;
          }
          .seg button {
            padding: 6px 11px;
            border-radius: 7px;
            border: none;
            background: transparent;
            font-size: 12px;
            font-weight: 600;
            color: var(--mp-fg-muted);
            display: flex;
            align-items: center;
            gap: 5px;
            cursor: pointer;
            transition: color var(--mp-dur-base);
          }
          .seg button :global(svg) {
            width: 14px;
            height: 14px;
          }
          .seg button.on {
            background: var(--mp-surface-high);
            color: var(--mp-fg);
            box-shadow: var(--mp-shadow-xs);
          }
          /* viridian switch */
          .sw {
            width: 44px;
            height: 26px;
            border-radius: 9999px;
            background: var(--mp-viridian);
            position: relative;
            cursor: pointer;
            border: none;
            flex-shrink: 0;
            transition: background var(--mp-dur-base);
          }
          .sw::after {
            content: "";
            position: absolute;
            top: 3px;
            left: 21px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: #fff;
            transition: left var(--mp-dur-base);
          }
          .sw.off {
            background: var(--mp-surface-sunken);
            border: 1px solid var(--mp-border-soft);
          }
          .sw.off::after {
            left: 3px;
          }
          .sw:disabled {
            opacity: 0.55;
            cursor: not-allowed;
          }
          /* inline goal stepper (mono numeral) */
          .gstep {
            display: flex;
            align-items: center;
            gap: 9px;
          }
          .gstep button {
            width: 30px;
            height: 30px;
            border-radius: 8px;
            border: 1px solid var(--mp-border-soft);
            background: var(--mp-surface-sunken);
            color: var(--mp-fg-muted);
            font-size: 16px;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: border-color var(--mp-dur-base), color var(--mp-dur-base);
          }
          .gstep button:hover:not(:disabled) {
            border-color: var(--mp-viridian);
            color: var(--mp-fg);
          }
          .gstep button:disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }
          .gstep b {
            font-family: var(--mp-font-mono);
            font-size: 14px;
            font-weight: 700;
            color: var(--mp-fg);
            min-width: 30px;
            text-align: center;
          }
          /* destructive row */
          .set-row.danger .sr-ic {
            background: var(--mp-error-bg);
            color: var(--mp-error);
          }
          .set-row.danger .sr-title {
            color: var(--mp-error);
          }
          /* desktop two-column grouping */
          .set-2col {
            display: grid;
            grid-template-columns: 1fr;
            gap: 20px;
          }
          @media (min-width: 1024px) {
            .set-2col {
              grid-template-columns: 1fr 1fr;
              align-items: start;
            }
            .set-2col .set-group {
              margin-top: 0;
            }
            .set-span2 {
              grid-column: 1 / -1;
            }
          }
        `}</style>

        <div className="set-wrap">
          <div className="set-pagehead">
            <h1>{lang === "de" ? "Einstellungen" : "Settings"}</h1>
            <p>
              {lang === "de"
                ? "Änderungen werden automatisch gespeichert."
                : "Changes are saved automatically."}
            </p>
          </div>

          {/* ─── Profile card (merged /profile) ─── */}
          <div className="profile-card">
            <div className="pc-av">{avatarInitials}</div>
            <div className="pc-body">
              <div className="pc-name">{displayName}</div>
              {!isGuest && (
                <div className="pc-rank">
                  {rankName}
                  <span className="pc-lvl">
                    {lang === "de" ? `Stufe ${rankLevel}` : `Level ${rankLevel}`}
                  </span>
                </div>
              )}
              {user?.email && <div className="pc-mail">{user.email}</div>}
              <span className={`pc-tier ${tierChipIsPaid ? "paid" : "free"}`}>
                {tierChipIsPaid ? (
                  <Crown aria-hidden />
                ) : (
                  <Zap aria-hidden />
                )}
                {tierChipLabel}
              </span>
            </div>
          </div>

          {/* Two columns on desktop: Lernen+Darstellung left, Konto right.
              Single column on mobile in source order. */}
          <div className="set-2col" style={{ marginTop: 20 }}>
            {/* ═══ Lernen ═══ */}
            <div className="set-group">
              <div className="set-label">{lang === "de" ? "Lernen" : "Learning"}</div>
              <div className="set-card">
                {/* Exam date → opens the sitting picker dialog */}
                <button
                  type="button"
                  className="set-row"
                  id="exam-date"
                  onClick={() => setExamPickerOpen(true)}
                >
                  <div className="sr-ic">
                    <CalendarDays aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{t("exam_target_date", lang)}</div>
                    <div className="sr-sub">
                      {lang === "de"
                        ? "Steuert deinen Lernplan"
                        : "Drives your study plan"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      {preferenceTargetDate
                        ? new Date(preferenceTargetDate).toLocaleDateString(
                            lang === "de" ? "de-AT" : "en-GB",
                            { day: "numeric", month: "short", year: "numeric" },
                          )
                        : lang === "de"
                          ? "Festlegen"
                          : "Set"}
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </button>

                {/* Daily goal — inline mono stepper */}
                <div className="set-row">
                  <div className="sr-ic">
                    <span className="font-mono text-[15px] font-bold">
                      {String(profile.dailyGoal)}
                    </span>
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">
                      {lang === "de" ? "Tagesziel" : "Daily goal"}
                    </div>
                    <div className="sr-sub">
                      {lang === "de"
                        ? "5–100 Fragen pro Tag"
                        : "5–100 questions per day"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <div className="gstep">
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal - 5)}
                        disabled={profile.dailyGoal <= 5}
                        aria-label={lang === "de" ? "Ziel verringern" : "Decrease goal"}
                      >
                        −
                      </button>
                      <b>{profile.dailyGoal}</b>
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal + 5)}
                        disabled={profile.dailyGoal >= 100}
                        aria-label={lang === "de" ? "Ziel erhöhen" : "Increase goal"}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Active exam — read-only summary */}
                <div className="set-row">
                  <div className="sr-ic">
                    <BookMarked aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">
                      {lang === "de" ? "Aktive Prüfung" : "Active exam"}
                    </div>
                    <div className="sr-sub">{activeExamLabel}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ Darstellung ═══ */}
            <div className="set-group">
              <div className="set-label">
                {lang === "de" ? "Darstellung" : "Display"}
              </div>
              <div className="set-card">
                {/* Theme — segmented (sun / moon). The live ThemeProvider
                    persists only light|dark, so we expose exactly those two
                    rather than a 'system' button that could not be saved. */}
                <div className="set-row">
                  <div className="sr-ic">
                    {theme === "dark" ? <Moon aria-hidden /> : <Sun aria-hidden />}
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{lang === "de" ? "Design" : "Theme"}</div>
                    <div className="sr-sub">
                      {theme === "dark"
                        ? lang === "de"
                          ? "Dunkel"
                          : "Dark"
                        : lang === "de"
                          ? "Hell"
                          : "Light"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <div
                      className="seg"
                      role="radiogroup"
                      aria-label={lang === "de" ? "Design" : "Theme"}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={theme === "light"}
                        className={theme === "light" ? "on" : ""}
                        onClick={() => applyTheme("light")}
                        aria-label={lang === "de" ? "Hell" : "Light"}
                      >
                        <Sun aria-hidden />
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={theme === "dark"}
                        className={theme === "dark" ? "on" : ""}
                        onClick={() => applyTheme("dark")}
                        aria-label={lang === "de" ? "Dunkel" : "Dark"}
                      >
                        <Moon aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="set-row !flex-wrap">
                  <div className="sr-ic"><Languages aria-hidden /></div>
                  <div className="sr-body">
                    <div className="sr-title">{t("language_app", lang)}</div>
                    <div className="sr-sub">{lang === "de" ? "Menüs und Hinweise in deiner Sprache. Die Prüfungsfragen bleiben auf Deutsch, wie in der Prüfung." : "Menus and guidance in your language. Exam questions stay in German, as in the exam."}</div>
                  </div>
                  <LanguagePicker settings className="w-full sm:w-auto" />
                </div>
              </div>
            </div>

            {/* ═══ Offline-Modus ═══ (full-width — a real feature card)
                Backlog #7 — 6/11 surveys rank this as the #1 improvement.
                Lets the user pre-download a batch of questions into
                IndexedDB so the quiz keeps working on trains / hospital
                WiFi dead zones. */}
            <div className="set-group set-span2">
              <div className="set-label">
                {lang === "de" ? "Offline-Modus" : "Offline mode"}
              </div>
              <div className="set-card" style={{ padding: 18 }}>
                <div className="flex items-center gap-3 mb-4">
                  <div className="sr-ic">
                    <CloudDownload aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="sr-title">
                      {lang === "de"
                        ? "Fragen offline verfügbar machen"
                        : "Make questions available offline"}
                    </div>
                    <div className="sr-sub">
                      {lang === "de"
                        ? "Lädt Fragen auf dieses Gerät, damit eine bereits geöffnete Sitzung bei kurzen Verbindungsabbrüchen weiterläuft. Die App ganz ohne Internet zu starten ist noch nicht möglich."
                        : "Loads questions onto this device so a session that is already open keeps going through brief connection drops. Starting the app without any internet is not possible yet."}
                    </div>
                  </div>
                </div>

                {/* Stat row — cached count + last sync */}
                <div className="flex items-center gap-3 p-4 rounded-[var(--mp-r-input)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] mb-4">
                  <Database
                    className="w-5 h-5 text-[var(--mp-fg-muted)] flex-shrink-0"
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

                {/* Preset size chips */}
                <p className="text-sm font-semibold text-[var(--mp-fg)] mb-2">
                  {lang === "de"
                    ? "Wie viele Fragen herunterladen?"
                    : "How many questions to download?"}
                </p>
                <div
                  role="radiogroup"
                  aria-label={
                    lang === "de" ? "Anzahl der Fragen" : "Number of questions"
                  }
                  className="flex flex-wrap gap-2 mb-4"
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
                            : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] border-[var(--mp-border-soft)] hover:border-[var(--mp-viridian)] hover:text-[var(--mp-fg)]"
                        }`}
                      >
                        {n.toLocaleString(lang === "de" ? "de-DE" : "en-US")}
                      </button>
                    );
                  })}
                </div>

                {/* Action buttons */}
                <div className="flex flex-col sm:flex-row gap-2">
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
                    {lang === "de" ? "Offline-Daten löschen" : "Clear offline data"}
                  </button>
                </div>

                {/* Guest warning — offline requires a real user row for sync */}
                {offlinePendingCount > 0 && (
                  <p className="mt-3 text-sm text-amber-800" role="status">
                    {lang === "de"
                      ? `${offlinePendingCount} Antworten warten auf Synchronisierung. Sie bleiben erhalten, wenn du die heruntergeladenen Fragen löschst.`
                      : `${offlinePendingCount} answers are waiting to sync. They stay queued when you clear downloaded questions.`}
                  </p>
                )}
                {offlineLegacyPendingCount > 0 && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" role="status">
                    <p>
                      {lang === "de"
                        ? `${offlineLegacyPendingCount} ältere Offline-Antworten sind auf diesem Gerät erhalten. Das zugehörige Konto ist nicht gespeichert, deshalb werden sie nicht automatisch synchronisiert.`
                        : `${offlineLegacyPendingCount} older offline answers are preserved on this device. Their account was not recorded, so they are not synced automatically.`}
                    </p>
                    {!isGuest && session?.user?.id && (
                      <button
                        type="button"
                        className="mp-btn mp-btn--secondary mt-3"
                        onClick={() => {
                          setLegacyRecoveryUserId(session.user.id);
                          setLegacyRecoveryOpen(true);
                        }}
                      >
                        {lang === "de" ? "Diesem Konto zuordnen…" : "Assign to this account…"}
                      </button>
                    )}
                  </div>
                )}
                {isGuest && (
                  <div className="mt-4">
                    <Alert
                      variant="info"
                      title={
                        lang === "de" ? "Anmeldung erforderlich" : "Sign-in required"
                      }
                    >
                      {lang === "de"
                        ? "Der Offline-Modus ist nur für angemeldete Nutzer verfügbar, nur so können beantwortete Fragen später synchronisiert werden."
                        : "Offline mode is only available to signed-in users, so that answers recorded offline can sync back to your account."}
                    </Alert>
                  </div>
                )}
              </div>
            </div>

            {/* ═══ Konto ═══ */}
            <div className="set-group set-span2">
              <div className="set-label">{lang === "de" ? "Konto" : "Account"}</div>

              {/* Email-linking card — Telegram-only users (no email yet) */}
              {user?.telegram_id && !user?.email && (
                <div className="mb-4">
                  <EmailLinkCard lang={lang} />
                </div>
              )}

              {/* Active subscription / current plan — rich card branches */}
              {activeSub ? (
                <div className="mb-4">
                  <SubscriptionCard sub={activeSub} lang={lang} />
                </div>
              ) : null}

              <div className="set-card">
                {/* Plan summary row (only when there's no rich activeSub card) */}
                {!activeSub && (
                  <div className="set-row">
                    <div className="sr-ic">
                      <Crown aria-hidden />
                    </div>
                    <div className="sr-body">
                      <div className="sr-title">
                        {lang === "de" ? "Aktueller Tarif" : "Current plan"}
                      </div>
                      <div className="sr-sub">
                        {liveIsPaid
                          ? liveTierExpiresAt
                            ? lang === "de"
                              ? `Pro · gültig bis ${new Date(liveTierExpiresAt).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}`
                              : `Pro · valid until ${new Date(liveTierExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
                            : lang === "de"
                              ? "Pro · Vollzugriff aktiv"
                              : "Pro · full access active"
                          : lang === "de"
                            ? "Kostenlos · 150 Fragen pro Prüfung"
                            : "Free · 150 questions per exam"}
                      </div>
                    </div>
                    <div className="sr-ctrl">
                      <span
                        className={`pc-tier ${liveIsPaid ? "paid" : "free"}`}
                        style={{ marginTop: 0 }}
                      >
                        {liveTier === "admin"
                          ? "Admin"
                          : liveIsPaid
                            ? "Pro"
                            : lang === "de"
                              ? "Kostenlos"
                              : "Free"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Manage subscription / pricing */}
                <Link href="/history" className="set-row min-h-11">{t("exam_history", lang)}</Link>
                <Link href="/pricing" className="set-row" style={{ display: "flex" }}>
                  <div className="sr-ic">
                    <Sparkles aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">
                      {liveIsPaid
                        ? lang === "de"
                          ? "Tarife ansehen"
                          : "View plans"
                        : lang === "de"
                          ? "Pro ansehen"
                          : "View Pro"}
                    </div>
                    <div className="sr-sub">
                      {liveIsPaid
                        ? lang === "de"
                          ? "Preise & Tarife ansehen"
                          : "See pricing & plans"
                        : lang === "de"
                          ? "Unbegrenzter Zugang"
                          : "Unlimited access"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </Link>

                {/* Clear study data — destructive */}
                <button
                  type="button"
                  className="set-row danger"
                  onClick={() => setClearDialogOpen(true)}
                >
                  <div className="sr-ic">
                    <Trash2 aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{t("clear_data", lang)}</div>
                    <div className="sr-sub">
                      {lang === "de"
                        ? "Lesezeichen, Notizen und Quiz-Daten entfernen"
                        : "Remove bookmarks, notes, and quiz data"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </button>

                {/* Logout */}
                {user && !isGuest && (
                  <button type="button" className="set-row" onClick={handleLogout}>
                    <div className="sr-ic">
                      <LogOut aria-hidden />
                    </div>
                    <div className="sr-body">
                      <div className="sr-title">{t("logout", lang)}</div>
                      <div className="sr-sub">
                        {user.first_name} ·{" "}
                        {lang === "de" ? "angemeldet" : "signed in"}
                      </div>
                    </div>
                    <div className="sr-ctrl">
                      <span className="sr-val">
                        <ArrowRight aria-hidden />
                      </span>
                    </div>
                  </button>
                )}
              </div>

              {/* About / version footer */}
              <div className="flex items-center justify-between px-1 mt-4">
                <Link
                  href="/about"
                  className="text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors font-semibold inline-flex items-center gap-1"
                >
                  {lang === "de" ? "Über MedPrüf" : "About MedPrüf"}
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </Link>
                <span className="text-xs font-mono text-[var(--mp-fg-subtle)]">
                  MedPr&uuml;f v1.0
                </span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Exam-date picker dialog — wraps the shared ExamSittingPicker
          (same control as onboarding) so it stays anchored to the real
          Austrian sittings. */}
      <Dialog
        open={examPickerOpen}
        onOpenChange={setExamPickerOpen}
        title={t("exam_target_date", lang)}
        description={
          lang === "de"
            ? "Wähle deinen Prüfungstermin, um einen personalisierten Lernplan freizuschalten."
            : "Pick your exam date to unlock a personalized study plan."
        }
        footer={
          <DialogFooter>
            {returnToStudyPlan && examDateSaved && <Link href="/study-plan" className="mp-btn mp-btn--primary min-h-11">
              {lang === "de" ? "Zum Lernplan zurück" : "Return to study plan"}
            </Link>}
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setExamPickerOpen(false)}
            >
              {lang === "de" ? "Fertig" : "Done"}
            </button>
          </DialogFooter>
        }
      >
        <ExamSittingPicker
          examType={activeExamId}
          value={preferenceTargetDate}
          onChange={handleTargetDateChange}
          lang={lang}
        />
      </Dialog>

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
        open={legacyRecoveryOpen}
        onOpenChange={(open) => {
          if (!legacyRecoveryBusy) setLegacyRecoveryOpen(open);
          if (!open && !legacyRecoveryBusy) setLegacyRecoveryUserId(null);
        }}
        title={lang === "de" ? "Offline-Antworten übernehmen?" : "Recover offline answers?"}
        description={lang === "de"
          ? "Nur fortfahren, wenn diese älteren Antworten in diesem Browser von dir und für dieses Konto gegeben wurden."
          : "Continue only if you recorded these older answers in this browser and they belong to this account."}
        footer={
          <DialogFooter>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              disabled={legacyRecoveryBusy}
              onClick={() => {
                setLegacyRecoveryOpen(false);
                setLegacyRecoveryUserId(null);
              }}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--primary"
              disabled={legacyRecoveryBusy}
              onClick={handleClaimLegacyOfflineAnswers}
            >
              {legacyRecoveryBusy
                ? (lang === "de" ? "Wird übernommen…" : "Recovering…")
                : (lang === "de" ? "Ja, diesem Konto zuordnen" : "Yes, assign to this account")}
            </button>
          </DialogFooter>
        }
      >
        <Alert
          variant="warning"
          title={lang === "de" ? "Danach können sie synchronisiert werden" : "They may sync after this"}
        >
          {lang === "de"
            ? "Nach deiner Bestätigung werden nur Antworten ohne gespeicherte Konto-ID diesem Konto zugeordnet. Sobald eine Verbindung besteht, werden sie an dein Konto gesendet. Die Zuordnung lässt sich hier nicht rückgängig machen. Bei Abbrechen bleiben alle Antworten unverändert auf diesem Gerät."
            : "After confirmation, only answers with no stored account ID will be assigned to this account. They will sync to it when a connection is available. This assignment cannot be undone here. Cancel leaves every answer unchanged on this device."}
        </Alert>
      </Dialog>

      <Dialog
        open={offlineClearOpen}
        onOpenChange={setOfflineClearOpen}
        title={lang === "de" ? "Offline-Fragen löschen?" : "Clear offline questions?"}
        description={
          lang === "de"
          ? "Heruntergeladene Fragen werden entfernt. Nicht synchronisierte Antworten bleiben erhalten."
            : "Downloaded questions will be removed. Unsynced answers will be kept."
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
              ? "Antworten bleiben erhalten"
              : "Answers will be kept"
          }
        >
          {lang === "de"
            ? "Nur heruntergeladene Fragen werden entfernt. Nicht synchronisierte Antworten bleiben auf diesem Gerät erhalten."
            : "Only downloaded questions will be removed. Unsynced answers will remain on this device."}
        </Alert>
      </Dialog>
    </AppLayout>
  );
}

/* ═══════════════════════ EmailLinkCard ══════════════════════════ */

/**
 * Shown inside the Konto section for Telegram-only users (no email yet).
 * Starts the email-linking flow by calling POST /api/user/link-email/start.
 *
 * Auth guardrails enforced server-side:
 *   - requireUser on the start route (userId from signed session token)
 *   - email collision → 409 rejected, never merges accounts
 *   - session_invalidated_at is never touched: the live Telegram session
 *     keeps working throughout and after the linking
 *   - credentials committed to users only after verify confirms the email
 */
function EmailLinkCard({ lang }: { lang: Lang }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const toast = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setErr("");

    let res: Response;
    try {
      res = await authFetch("/api/user/link-email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, lang }),
      });
    } catch {
      setSending(false);
      setErr(lang === "de" ? "Verbindungsfehler" : "Connection error");
      return;
    }

    setSending(false);

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 409 && data.error === "email_taken") {
        setErr(
          lang === "de"
            ? "Diese E-Mail-Adresse ist bereits einem anderen Konto zugeordnet."
            : "This email address is already linked to another account.",
        );
      } else if (res.status === 409) {
        setErr(
          lang === "de"
            ? "Eine Bestätigungs-E-Mail wurde bereits gesendet. Bitte prüfen Sie Ihren Posteingang."
            : "A verification email was already sent. Please check your inbox.",
        );
      } else {
        setErr(data.message ?? (lang === "de" ? "Fehler. Bitte erneut versuchen." : "Error. Please try again."));
      }
      return;
    }

    setSent(true);
    toast.success(
      lang === "de" ? "Bestätigungs-E-Mail gesendet" : "Verification email sent",
      lang === "de"
        ? `Wir haben eine E-Mail an ${email} gesendet.`
        : `We sent an email to ${email}.`,
    );
  };

  if (sent) {
    return (
      <div className="p-4 rounded-[var(--mp-r-card)] bg-[var(--mp-success-bg)] border border-[rgba(0,123,95,0.2)]">
        <p className="text-sm font-semibold text-[var(--mp-viridian)] mb-1">
          {lang === "de" ? "Bestätigungs-E-Mail gesendet" : "Verification email sent"}
        </p>
        <p className="text-xs text-[var(--mp-fg-muted)]">
          {lang === "de"
            ? `Bitte öffnen Sie den Link in der E-Mail an ${email}, um die Verknüpfung abzuschließen.`
            : `Please open the link in the email we sent to ${email} to complete the linking.`}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 rounded-[var(--mp-r-card)] bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] shadow-[var(--mp-shadow-card)]">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-9 h-9 rounded-lg bg-[var(--mp-surface-sunken)] flex items-center justify-center flex-shrink-0">
          <Mail className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--mp-fg)]">
            {lang === "de" ? "E-Mail-Adresse hinzufügen" : "Add email address"}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
            {lang === "de"
              ? "Damit können Sie sich auch per E-Mail und Passwort anmelden. Ihre Telegram-Anmeldung bleibt aktiv."
              : "This lets you also sign in with email and password. Your Telegram login stays active."}
          </p>
        </div>
      </div>

      {err && (
        <div className="mb-3 text-xs text-[var(--mp-error)] bg-[var(--mp-error-bg)] border border-[rgba(214,69,69,0.2)] rounded-lg px-3 py-2">
          {err}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <TextField
          label={lang === "de" ? "E-Mail-Adresse" : "Email address"}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
        />
        <div className="relative">
          <TextField
            label={lang === "de" ? "Neues Passwort" : "New password"}
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={lang === "de" ? "Min. 8 Zeichen" : "Min. 8 characters"}
            helper={lang === "de" ? "Mindestens 8 Zeichen." : "At least 8 characters."}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword
              ? (lang === "de" ? "Passwort verbergen" : "Hide password")
              : (lang === "de" ? "Passwort anzeigen" : "Show password")}
            className="absolute right-3 top-[34px] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        <button
          type="submit"
          disabled={sending}
          className="mp-btn mp-btn--primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Mail className="w-4 h-4" aria-hidden />
          {sending
            ? (lang === "de" ? "Sende E-Mail..." : "Sending email...")
            : (lang === "de" ? "Bestätigungs-E-Mail senden" : "Send verification email")}
        </button>
      </form>
    </div>
  );
}

/* ═══════════════════════ SubscriptionCard ═══════════════════════ */

/** Provider billing and actual access expiry are deliberately separate. */
function SubscriptionCard({ sub, lang }: { sub: SubscriptionCardSnapshot; lang: Lang }) {
  const copyLang = lang === "de" ? "de" : "en";
  const state = subscriptionBillingState(sub);
  const labels = {
    active: { de: "Aktiv", en: "Active" }, trial: { de: "Pro-Test", en: "Pro trial" },
    ending: { de: "Endet bald", en: "Ending soon" }, cancelled: { de: "Gekündigt", en: "Canceled" },
    past_due: { de: "Zahlung ausstehend", en: "Payment overdue" }, refunded: { de: "Erstattet", en: "Refunded" },
    chargeback: { de: "Zahlung zurückgebucht", en: "Payment reversed" }, expired: { de: "Abgelaufen", en: "Expired" },
    unknown: { de: "Details offen", en: "Details unavailable" },
  };
  // Only a known recurring provider plan gets a cancellation action.
  const canManage = sub.billing_cadence === "auto_renews" && Boolean(sub.manage_url) &&
    ["active", "trial", "past_due", "cancelled"].includes(state) && sub.provider_state_verified;
  const canViewBilling = Boolean(sub.manage_url) && sub.payment_provider === "whop";
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold text-[var(--mp-fg-muted)] mb-1">{copyLang === "de" ? "Aktueller Tarif" : "Current plan"}</p>
          <p className="text-base font-bold text-[var(--mp-fg)]">{shortSubscriptionLabel(sub, copyLang)}</p>
        </div>
        <span className="rounded-[var(--mp-r-input)] bg-[var(--mp-surface-sunken)] px-3 py-1 text-sm font-semibold text-[var(--mp-fg)]">{labels[state][copyLang]}</span>
      </div>
      <p className="text-sm leading-relaxed text-[var(--mp-fg)]">{billingAccountSentence(sub, copyLang)}</p>
      {canViewBilling && <div className="flex flex-col gap-2 items-start">
        <a href={sub.manage_url!} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary min-h-11">
          {canManage ? copyLang === "de" ? "Kündigen oder verwalten" : "Cancel or manage" : copyLang === "de" ? "Abrechnung bei Whop ansehen" : "View billing at Whop"}
        </a>
        <p className="text-xs text-[var(--mp-fg-muted)]">{copyLang === "de" ? "Öffnet Whop in einem neuen Tab." : "Opens Whop in a new tab."}</p>
      </div>}
      {canManage && <details className="text-sm text-[var(--mp-fg-muted)]">
        <summary className="min-h-11 flex items-center cursor-pointer text-[var(--mp-fg)]">{copyLang === "de" ? "Kündigung bei Whop" : "Cancellation at Whop"}</summary>
        <p className="leading-relaxed">{copyLang === "de" ? 'Logg dich bei Whop mit derselben E-Mail ein, wähle deine Mitgliedschaft und dann „Cancel membership“. Die Whop-Seite ist auf Englisch.' : 'Log in to Whop with the same email, select your membership, then "Cancel membership".'}</p>
      </details>}
      <p className="text-sm text-[var(--mp-fg-muted)]">
        {copyLang === "de" ? "Fragen zur Abrechnung? " : "Questions about billing? "}
        <a className="underline underline-offset-2" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>
        {" "}{SUPPORT_REPLY_PROMISE[copyLang === "de" ? "de" : "en"]}
      </p>
    </Card>
  );
}
