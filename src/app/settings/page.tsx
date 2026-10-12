"use client";
import { rankLabel } from "@/lib/i18n-study-dash";
import InstallAppRow from "@/components/master-pwa/InstallAppRow";
import OfflinePackCard from "@/components/OfflinePackCard";
import { to } from "@/lib/i18n-offline";
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

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  billingAmount,
  VERIFIED_CANCEL_PATH,
  WHOP_MANAGE_URL,
} from "@/lib/billing-copy";
import { TIERS } from "@/lib/content-truth";
import ExamSwitcherInline from "@/components/ExamSwitcherInline";
import { te } from "@/lib/i18n-exam";
import { settingsBuildLabel } from "@/components/settings/build-label";
import { EXAM_SOURCES, setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import {
  Alert,
  ConfirmAction,
  Dialog,
  DialogFooter,
  TextField,
  useToast,
} from "@/components/ui";
import {
  ArrowRight,
  BookMarked,
  GraduationCap,
  History,
  CalendarDays,
  Crown,
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
  claimUnownedPendingAnswersForUser,
  countPendingAnswers,
  countUnownedPendingAnswers,
} from "@/lib/offlineDb";
import { MyReportsList } from "@/components/reports/MyReportsList";
import MentorSettingsCard from "@/components/mentor/entries/MentorSettingsCard";

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
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>("de");
  const uiLang = useLang();
  // One render-language flag instead of inline lang ternaries (LX-19 ratchet).
  const de = lang === "de";
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
  // Logout confirmation (UX-ACC-38): the pending count is re-read when the
  // learner asks to sign out, so the warning never shows a stale number.
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [logoutPendingCount, setLogoutPendingCount] = useState(0);

  // ── Offline state ──
  // Downloads, counts, sync stamps and clearing live in OfflinePackCard (a28);
  // the page keeps the outbox counts and the legacy-answer recovery.
  const [offlinePendingCount, setOfflinePendingCount] = useState<number>(0);
  const [offlineLegacyPendingCount, setOfflineLegacyPendingCount] = useState<number>(0);
  const [legacyRecoveryOpen, setLegacyRecoveryOpen] = useState(false);
  const [legacyRecoveryUserId, setLegacyRecoveryUserId] = useState<string | null>(null);
  const [legacyRecoveryBusy, setLegacyRecoveryBusy] = useState(false);

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
    countPendingAnswers(stored?.user?.id).then(setOfflinePendingCount).catch(() => setOfflinePendingCount(0));
    countUnownedPendingAnswers()
      .then(setOfflineLegacyPendingCount)
      .catch(() => setOfflineLegacyPendingCount(0));

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
      de ? "Tagesziel gespeichert" : "Daily goal saved",
    );
  };

  const handleTargetDateChange = async (value: string) => {
    setExamDateSaved(false);
    const saved = await persistToServer({ examDate: value || null });
    if (!saved) {
      toast.error(de ? "Prüfungstermin konnte nicht gespeichert werden" : "Could not save exam date");
      return;
    }
    const updated = { ...profile, targetDate: value };
    setProfile(updated);
    setServerExamDate(value || null);
    saveProfile(updated);
    setExamDateSaved(Boolean(value));
    toast.success(value
      ? (de ? "Prüfungstermin gespeichert" : "Exam date saved")
      : (de ? "Prüfungstermin entfernt" : "Exam date cleared"));
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
          key === "medpruef_quiz_session_v2" ||
          key === "medpruef_weakness")
      ) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    setClearDialogOpen(false);
    toast.success(t("data_cleared", lang));
  };

  const requestLogout = async () => {
    const userId = getStoredSession()?.user?.id;
    const pending = await countPendingAnswers(userId).catch(() => 0);
    setLogoutPendingCount(pending);
    setLogoutConfirmOpen(true);
  };

  const handleLogout = () => {
    clearSession({ logout: true });
    window.location.href = "/";
  };

  /** Paid learners: "Abo und Zahlung" moves to the subscription card. */
  const openBillingCard = () => {
    const target = document.getElementById("abo-und-zahlung");
    if (!target) {
      router.push("/pricing");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.focus({ preventScroll: true });
  };

  // Outbox counts after the pack card downloads or clears (queued answers are never cleared there).
  const refreshOfflinePending = () => {
    const currentUserId = getStoredSession()?.user?.id;
    countPendingAnswers(currentUserId).then(setOfflinePendingCount).catch(() => setOfflinePendingCount(0));
    countUnownedPendingAnswers().then(setOfflineLegacyPendingCount).catch(() => setOfflineLegacyPendingCount(0));
  };
  const offlineExam =
    serverActiveExam ||
    (session?.user as { active_exam?: string } | undefined)?.active_exam ||
    "kenntnispruefung";

  const handleClaimLegacyOfflineAnswers = async () => {
    const currentUserId = getStoredSession()?.user?.id;
    if (!legacyRecoveryUserId || currentUserId !== legacyRecoveryUserId || isGuest || currentUserId?.startsWith("guest_")) {
      setLegacyRecoveryOpen(false);
      toast.error(de ? "Konto geändert. Bitte erneut prüfen." : "Account changed. Please review again.");
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
      toast.success(de
        ? `${claimed} ältere Antworten diesem Konto zugeordnet.`
        : `${claimed} older answers assigned to this account.`);
      if (typeof navigator !== "undefined" && navigator.onLine) {
        window.dispatchEvent(new Event("online"));
      }
    } catch (error) {
      console.error("[settings] recover legacy offline answers", error);
      toast.error(de ? "Antworten konnten nicht übernommen werden" : "Could not recover answers");
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
    (de ? "Gast" : "Guest");
  const avatarInitials = initialsOf(user?.first_name, user?.last_name);
  const { level: rankLevel } = getLevelFromXP(gam?.total_xp || 0);
  // Calm tier label for the profile chip. Paid cohorts surface their human
  // name; admin shows Admin; everyone else reads Kostenlos.
  const tierChipLabel =
    activeSub && (activeSub as { tier_human_name_de?: string }).tier_human_name_de
      ? de
        ? (activeSub as { tier_human_name_de: string }).tier_human_name_de
        : (activeSub as { tier_human_name: string }).tier_human_name
      : liveTier === "admin"
        ? "Admin"
        : liveIsPaid
          ? "Pro"
          : de
            ? "Kostenlos"
            : "Free";
  const tierChipIsPaid = liveIsPaid || !!activeSub;

  // Resolve the active-exam display label from the canonical source.
  const activeExamId =
    serverActiveExam ||
    (user as { active_exam?: string } | undefined)?.active_exam ||
    "kenntnispruefung";
  const preferenceTargetDate =
    serverExamDate === undefined ? profile.targetDate : serverExamDate || "";
  // Free plan row (UX-ACC-20): the entry price comes from TIERS via billing-copy.
  const monthlyFrom = billingAmount(TIERS.first_month_19.price_cents, de ? "de" : "en");
  // Clear-data row and its confirmation name exactly what is removed (UX-ACC-38).
  const clearDataLabel = de
    ? "Notizen, Lesezeichen und Zwischenstand löschen"
    : "Delete notes, bookmarks and saved quiz";
  const clearDataScope = de
    ? "Löscht Ihre Notizen zu Fragen auf diesem Gerät, alle Lesezeichen in Ihrem Konto und den Quiz-Zwischenstand. Lernfortschritt und Abo bleiben erhalten."
    : "Deletes your question notes on this device, all bookmarks in your account and the saved quiz session. Learning progress and subscription stay.";
  const logoutConsequence = (() => {
    const base = de
      ? "Sie werden auf diesem Gerät abgemeldet. Ihr Lernfortschritt bleibt in Ihrem Konto gespeichert."
      : "You will be signed out on this device. Your learning progress stays saved in your account.";
    if (logoutPendingCount <= 0) return base;
    const unsent = de
      ? logoutPendingCount === 1
        ? "1 Antwort wurde noch nicht gesendet. Sie bleibt auf diesem Gerät und wird erst gesendet, wenn Sie sich hier wieder mit diesem Konto anmelden und online sind."
        : `${logoutPendingCount} Antworten wurden noch nicht gesendet. Sie bleiben auf diesem Gerät und werden erst gesendet, wenn Sie sich hier wieder mit diesem Konto anmelden und online sind.`
      : logoutPendingCount === 1
        ? "1 answer has not been sent yet. It stays on this device and is only sent once you sign in here again with this account while online."
        : `${logoutPendingCount} answers have not been sent yet. They stay on this device and are only sent once you sign in here again with this account while online.`;
    return `${unsent} ${base}`;
  })();

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
          /* Active-exam row: the shared picker trigger covers the row. */
          .exam-row {
            position: relative;
            cursor: pointer;
          }
          .exam-row:hover {
            background: var(--mp-surface-sunken);
          }
          .exam-row .sr-ctrl :global(.relative) {
            position: static;
          }
          .exam-row .sr-ctrl :global(button[aria-haspopup="dialog"]) {
            min-height: 44px;
            max-width: 12rem;
          }
          .exam-row .sr-ctrl :global(button[aria-haspopup="dialog"])::after {
            content: "";
            position: absolute;
            inset: 0;
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
            /* minmax(0, 1fr): a long row (language picker, exam switch)
               must wrap inside the column, never widen it at 375 px. */
            grid-template-columns: minmax(0, 1fr);
            gap: 20px;
          }
          @media (min-width: 1024px) {
            .set-2col {
              grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
            <h1>{de ? "Einstellungen" : "Settings"}</h1>
            <p>
              {de
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
                  {rankLabel(rankLevel, lang)}
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
              <div className="set-label">{de ? "Lernen" : "Learning"}</div>
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
                      {de
                        ? "Steuert Ihren Lernplan"
                        : "Drives your study plan"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      {preferenceTargetDate
                        ? new Date(preferenceTargetDate).toLocaleDateString(
                            de ? "de-AT" : "en-GB",
                            { day: "numeric", month: "short", year: "numeric" },
                          )
                        : de
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
                      {de ? "Tagesziel" : "Daily goal"}
                    </div>
                    <div className="sr-sub">
                      {de
                        ? "5 bis 100 Fragen pro Tag"
                        : "5 to 100 questions per day"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <div className="gstep">
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal - 5)}
                        disabled={profile.dailyGoal <= 5}
                        aria-label={de ? "Ziel verringern" : "Decrease goal"}
                      >
                        −
                      </button>
                      <b>{profile.dailyGoal}</b>
                      <button
                        type="button"
                        onClick={() => handleDailyGoalChange(profile.dailyGoal + 5)}
                        disabled={profile.dailyGoal >= 100}
                        aria-label={de ? "Ziel erhöhen" : "Increase goal"}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Active exam (UX-ACC-38): the whole row opens the shared
                    exam picker. ExamSwitcherInline owns the trigger and the
                    sheet; the row stretches its trigger over the row so any
                    tap on the row opens it (no second picker). */}
                <div className="set-row exam-row" data-active-exam={activeExamId}>
                  <div className="sr-ic">
                    <BookMarked aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">
                      {de ? "Aktive Prüfung" : "Active exam"}
                    </div>
                    <div className="sr-sub">
                      {de
                        ? "Fragen, Lernplan und Simulation folgen dieser Prüfung."
                        : "Questions, study plan and simulations follow this exam."}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <ExamSwitcherInline variant="header" />
                  </div>
                </div>
              </div>
            </div>

            {/* ═══ Darstellung ═══ */}
            <div className="set-group">
              <div className="set-label">
                {de ? "Darstellung" : "Display"}
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
                    <div className="sr-title">{de ? "Design" : "Theme"}</div>
                    <div className="sr-sub">
                      {theme === "dark"
                        ? de
                          ? "Dunkel"
                          : "Dark"
                        : de
                          ? "Hell"
                          : "Light"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <div
                      className="seg"
                      role="radiogroup"
                      aria-label={de ? "Design" : "Theme"}
                    >
                      <button
                        type="button"
                        role="radio"
                        aria-checked={theme === "light"}
                        className={theme === "light" ? "on" : ""}
                        onClick={() => applyTheme("light")}
                        aria-label={de ? "Hell" : "Light"}
                      >
                        <Sun aria-hidden />
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={theme === "dark"}
                        className={theme === "dark" ? "on" : ""}
                        onClick={() => applyTheme("dark")}
                        aria-label={de ? "Dunkel" : "Dark"}
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
                    <div className="sr-sub">{de ? "Menüs und Hinweise in Ihrer Sprache. Die Prüfungsfragen bleiben auf Deutsch, wie in der Prüfung." : "Menus and guidance in your language. Exam questions stay in German, as in the exam."}</div>
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
            <div id="offline" className="set-group set-span2 scroll-mt-20">
              <div className="set-label">{to("card_label", lang)}</div>
              <OfflinePackCard
                lang={lang}
                examType={offlineExam}
                userId={!isGuest && session?.user?.id ? session.user.id : null}
                onChanged={refreshOfflinePending}
              />
              {(offlinePendingCount > 0 || offlineLegacyPendingCount > 0 || isGuest) && (
              <div className="set-card mt-3" style={{ padding: 18 }}>
                {/* Guest warning — offline requires a real user row for sync */}
                {offlinePendingCount > 0 && (
                  <p className="mt-3 text-sm text-[var(--mp-warning-text)]" role="status">
                    {de
                      ? `${offlinePendingCount} Antworten warten auf Synchronisierung. Sie bleiben erhalten, wenn Sie die heruntergeladenen Fragen löschen.`
                      : `${offlinePendingCount} answers are waiting to sync. They stay queued when you clear downloaded questions.`}
                  </p>
                )}
                {offlineLegacyPendingCount > 0 && (
                  <div className="mt-3 rounded-lg border border-[var(--mp-status-warning)] bg-[var(--mp-warning-bg)] p-3 text-sm text-[var(--mp-warning-text)]" role="status">
                    <p>
                      {de
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
                        {de ? "Diesem Konto zuordnen…" : "Assign to this account…"}
                      </button>
                    )}
                  </div>
                )}
                {isGuest && (
                  <div className="mt-4">
                    <Alert
                      variant="info"
                      title={
                        de ? "Anmeldung erforderlich" : "Sign-in required"
                      }
                    >
                      {de
                        ? "Der Offline-Modus ist nur für angemeldete Nutzer verfügbar, nur so können beantwortete Fragen später synchronisiert werden."
                        : "Offline mode is only available to signed-in users, so that answers recorded offline can sync back to your account."}
                    </Alert>
                  </div>
                )}
              </div>
              )}
              {/* LX-12 / UX-ACC-46: install row (Android prompt, iOS steps, installed state); renders nothing elsewhere. */}
              <InstallAppRow lang={lang} />
            </div>

            {/* ═══ Meine Meldungen (a15, QLT-03/TR-10) ═══ */}
            {user && !isGuest && (
              <div className="set-group set-span2 scroll-mt-24" id="meine-meldungen">
                <div className="set-card p-4">
                  <MyReportsList />
                </div>
              </div>
            )}

            {/* ═══ KI-Mentor (MUX-110): renders only while the mentor is available ═══ */}
            {user && !isGuest && (
              <div className="set-group set-span2 empty:hidden">
                <MentorSettingsCard lang={lang} />
              </div>
            )}

            {/* ═══ Konto ═══ (anchor: the Mehr sheet's "Abo und Zahlung" entry) */}
            <div className="set-group set-span2" id="konto" tabIndex={-1}>
              <div className="set-label">{de ? "Konto" : "Account"}</div>

              {/* Email-linking card — Telegram-only users (no email yet) */}
              {user?.telegram_id && !user?.email && (
                <div className="mb-4">
                  <EmailLinkCard lang={lang} />
                </div>
              )}

              {/* Active subscription / current plan — rich card branches.
                  "Abo und Zahlung" (UX-ACC-20) scrolls here and focuses it. */}
              {activeSub ? (
                <div className="mb-4 scroll-mt-24" id="abo-und-zahlung" tabIndex={-1}>
                  <SubscriptionCard sub={activeSub} lang={lang} />
                  <div className="mt-2 px-1 flex flex-col gap-1 text-xs text-[var(--mp-fg-muted)]">
                    <p>
                      {de
                        ? "Quittungen sendet Whop an die E-Mail-Adresse Ihres Whop-Kontos."
                        : "Whop sends receipts to the email address of your Whop account."}
                    </p>
                    <p>
                      {de
                        ? "Rückerstattung innerhalb von 7 Tagen nach einem Kauf: schreiben Sie an "
                        : "Refunds within 7 days of a purchase: write to "}
                      <a className="underline underline-offset-2" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>
                      {de ? ". Die Erstattung erfolgt über Whop." : ". The refund is paid through Whop."}
                    </p>
                  </div>
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
                        {de ? "Aktueller Tarif" : "Current plan"}
                      </div>
                      <div className="sr-sub">
                        {liveIsPaid
                          ? liveTierExpiresAt
                            ? de
                              ? `Pro · gültig bis ${new Date(liveTierExpiresAt).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}`
                              : `Pro · valid until ${new Date(liveTierExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`
                            : de
                              ? "Pro · Vollzugriff aktiv"
                              : "Pro · full access active"
                          : de
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
                            : de
                              ? "Kostenlos"
                              : "Free"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Plan row (UX-ACC-20): a real 44 px row like its siblings.
                    styled-jsx scopes .set-row to intrinsic elements only, so
                    these rows are buttons with router.push, not next/link. */}
                {activeSub ? (
                  <button type="button" className="set-row" onClick={openBillingCard}>
                    <div className="sr-ic">
                      <Crown aria-hidden />
                    </div>
                    <div className="sr-body">
                      <div className="sr-title">{de ? "Abo und Zahlung" : "Plan and billing"}</div>
                      <div className="sr-sub">
                        {de ? "Ihr Tarif, Abrechnung und Rückerstattung" : "Your plan, billing and refunds"}
                      </div>
                    </div>
                    <div className="sr-ctrl">
                      <span className="sr-val">
                        <ArrowRight aria-hidden />
                      </span>
                    </div>
                  </button>
                ) : (
                  <button type="button" className="set-row" onClick={() => router.push("/pricing")}>
                    <div className="sr-ic">
                      <Sparkles aria-hidden />
                    </div>
                    <div className="sr-body">
                      <div className="sr-title">
                        {liveIsPaid
                          ? de
                            ? "Tarife ansehen"
                            : "View plans"
                          : de
                            ? `Pro freischalten, ab ${monthlyFrom} pro Monat`
                            : `Unlock Pro, from ${monthlyFrom} per month`}
                      </div>
                      <div className="sr-sub">
                        {de ? "Preise und Bedingungen ansehen" : "See prices and terms"}
                      </div>
                    </div>
                    <div className="sr-ctrl">
                      <span className="sr-val">
                        <ArrowRight aria-hidden />
                      </span>
                    </div>
                  </button>
                )}

                {/* UX-EXM-44: record the real exam result (Pass-Until-You-Pass). */}
                <button type="button" className="set-row" onClick={() => router.push("/dashboard/exam-result")}>
                  <div className="sr-ic">
                    <GraduationCap aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{te("settings_real_result", lang)}</div>
                    <div className="sr-sub">{te("settings_real_result_sub", lang)}</div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </button>

                {/* Saved simulations */}
                <button type="button" className="set-row" onClick={() => router.push("/history")}>
                  <div className="sr-ic">
                    <History aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{t("exam_history", lang)}</div>
                    <div className="sr-sub">
                      {de ? "Ihre gespeicherten Simulationen" : "Your saved simulations"}
                    </div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </button>

                {/* Clear notes, bookmarks and the quiz resume (UX-ACC-38) */}
                <button
                  type="button"
                  className="set-row danger"
                  onClick={() => setClearDialogOpen(true)}
                >
                  <div className="sr-ic">
                    <Trash2 aria-hidden />
                  </div>
                  <div className="sr-body">
                    <div className="sr-title">{clearDataLabel}</div>
                    <div className="sr-sub">{clearDataScope}</div>
                  </div>
                  <div className="sr-ctrl">
                    <span className="sr-val">
                      <ArrowRight aria-hidden />
                    </span>
                  </div>
                </button>

                {/* Logout (asks first, warns about unsent offline answers) */}
                {user && !isGuest && (
                  <button type="button" className="set-row" onClick={() => void requestLogout()}>
                    <div className="sr-ic">
                      <LogOut aria-hidden />
                    </div>
                    <div className="sr-body">
                      <div className="sr-title">{t("logout", lang)}</div>
                      <div className="sr-sub">
                        {user.first_name} ·{" "}
                        {de ? "angemeldet" : "signed in"}
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

              {/* About / build footer (short build id names the deployed build in bug reports) */}
              <div className="flex items-center justify-between px-1 mt-4">
                <Link
                  href="/about"
                  className="text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors font-semibold inline-flex items-center gap-1"
                >
                  {de ? "Über MedPrüf" : "About MedPrüf"}
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden />
                </Link>
                <span className="text-xs font-mono text-[var(--mp-fg-subtle)]">
                  Version {settingsBuildLabel()}
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
          de
            ? "Wählen Sie Ihren Prüfungstermin, um einen persönlichen Lernplan freizuschalten."
            : "Pick your exam date to unlock a personalized study plan."
        }
        footer={
          <DialogFooter>
            {returnToStudyPlan && examDateSaved && <Link href="/study-plan" className="mp-btn mp-btn--primary min-h-11">
              {de ? "Zum Lernplan zurück" : "Return to study plan"}
            </Link>}
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setExamPickerOpen(false)}
            >
              {de ? "Fertig" : "Done"}
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

      {/* Destructive confirm: repeats what is removed, Cancel focused first. */}
      <ConfirmAction
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title={clearDataLabel}
        consequence={`${clearDataScope} ${de ? "Das kann nicht rückgängig gemacht werden." : "This cannot be undone."}`}
        confirmLabel={de ? "Löschen" : "Delete"}
        cancelLabel={de ? "Abbrechen" : "Cancel"}
        destructive
        onConfirm={handleClearData}
      />

      {/* Logout confirm (UX-ACC-38): warns when offline answers are unsent. */}
      <ConfirmAction
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title={de ? "Abmelden?" : "Sign out?"}
        consequence={logoutConsequence}
        confirmLabel={t("logout", lang)}
        cancelLabel={de ? "Angemeldet bleiben" : "Stay signed in"}
        onConfirm={handleLogout}
      />

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
        title={de ? "Offline-Antworten übernehmen?" : "Recover offline answers?"}
        description={de
          ? "Fahren Sie nur fort, wenn Sie diese älteren Antworten in diesem Browser selbst für dieses Konto gegeben haben."
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
              {de ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--primary"
              disabled={legacyRecoveryBusy}
              onClick={handleClaimLegacyOfflineAnswers}
            >
              {legacyRecoveryBusy
                ? (de ? "Wird übernommen…" : "Recovering…")
                : (de ? "Ja, diesem Konto zuordnen" : "Yes, assign to this account")}
            </button>
          </DialogFooter>
        }
      >
        <Alert
          variant="warning"
          title={de ? "Danach können sie synchronisiert werden" : "They may sync after this"}
        >
          {de
            ? "Nach Ihrer Bestätigung werden nur Antworten ohne gespeicherte Konto-ID diesem Konto zugeordnet. Sobald eine Verbindung besteht, werden sie an Ihr Konto gesendet. Die Zuordnung lässt sich hier nicht rückgängig machen. Bei Abbrechen bleiben alle Antworten unverändert auf diesem Gerät."
            : "After confirmation, only answers with no stored account ID will be assigned to this account. They will sync to it when a connection is available. This assignment cannot be undone here. Cancel leaves every answer unchanged on this device."}
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
  const de = lang === "de";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  // UX-ACC-44: field errors go through TextField's error prop (aria-invalid,
  // aria-describedby); only a connection/server failure is a form-level alert.
  const [emailErr, setEmailErr] = useState("");
  const [passwordErr, setPasswordErr] = useState("");
  const [formErr, setFormErr] = useState("");
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // aria-disabled keeps the button focusable, so the guard lives here.
    if (sending) return;
    setEmailErr("");
    setPasswordErr("");
    setFormErr("");

    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailErr(de ? "Bitte geben Sie eine gültige E-Mail-Adresse ein." : "Please enter a valid email address.");
      emailRef.current?.focus();
      return;
    }
    if (password.length < 8) {
      setPasswordErr(de ? "Das Passwort braucht mindestens 8 Zeichen." : "The password needs at least 8 characters.");
      passwordRef.current?.focus();
      return;
    }

    setSending(true);
    let res: Response;
    try {
      res = await authFetch("/api/user/link-email/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed, password, lang }),
      });
    } catch {
      setSending(false);
      setFormErr(de ? "Keine Verbindung. Bitte versuchen Sie es erneut." : "Connection error. Please try again.");
      return;
    }

    setSending(false);

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 409 && data.error === "email_taken") {
        setEmailErr(
          de
            ? "Diese E-Mail-Adresse ist bereits einem anderen Konto zugeordnet."
            : "This email address is already linked to another account.",
        );
        emailRef.current?.focus();
      } else if (res.status === 409) {
        setEmailErr(
          de
            ? "Eine Bestätigungs-E-Mail wurde bereits gesendet. Bitte prüfen Sie Ihren Posteingang."
            : "A verification email was already sent. Please check your inbox.",
        );
        emailRef.current?.focus();
      } else {
        setFormErr(data.message ?? (de ? "Fehler. Bitte versuchen Sie es erneut." : "Error. Please try again."));
      }
      return;
    }

    setSent(true);
    toast.success(
      de ? "Bestätigungs-E-Mail gesendet" : "Verification email sent",
      de
        ? `Wir haben eine E-Mail an ${trimmed} gesendet.`
        : `We sent an email to ${trimmed}.`,
    );
  };

  if (sent) {
    return (
      <div
        ref={successRef}
        role="status"
        tabIndex={-1}
        className="p-4 rounded-[var(--mp-r-card)] bg-[var(--mp-success-bg)] border border-[var(--mp-border-subtle)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mp-focus-color)]"
      >
        <p className="text-sm font-semibold text-[var(--mp-viridian)] mb-1">
          {de ? "Bestätigungs-E-Mail gesendet" : "Verification email sent"}
        </p>
        <p className="text-xs text-[var(--mp-fg-muted)]">
          {de
            ? `Bitte öffnen Sie den Link in der E-Mail an ${email.trim()}, um die Verknüpfung abzuschließen.`
            : `Please open the link in the email we sent to ${email.trim()} to complete the linking.`}
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
            {de ? "E-Mail-Adresse hinzufügen" : "Add email address"}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
            {de
              ? "Damit können Sie sich auch per E-Mail und Passwort anmelden. Ihre Telegram-Anmeldung bleibt aktiv."
              : "This lets you also sign in with email and password. Your Telegram login stays active."}
          </p>
        </div>
      </div>

      {formErr && (
        <div role="alert" className="mb-3 text-xs text-[var(--mp-error-text)] bg-[var(--mp-error-bg)] border border-[var(--mp-border-subtle)] rounded-lg px-3 py-2">
          {formErr}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-3">
        <TextField
          ref={emailRef}
          label={de ? "E-Mail-Adresse" : "Email address"}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => { setEmail(e.target.value); setEmailErr(""); }}
          placeholder="name@example.com"
          error={emailErr || undefined}
        />
        <div className="relative">
          <TextField
            ref={passwordRef}
            label={de ? "Neues Passwort" : "New password"}
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordErr(""); }}
            placeholder={de ? "Mindestens 8 Zeichen" : "At least 8 characters"}
            helper={de ? "Mindestens 8 Zeichen." : "At least 8 characters."}
            error={passwordErr || undefined}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword
              ? (de ? "Passwort verbergen" : "Hide password")
              : (de ? "Passwort anzeigen" : "Show password")}
            className="absolute right-3 top-[34px] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" aria-hidden />
            ) : (
              <Eye className="w-4 h-4" aria-hidden />
            )}
          </button>
        </div>
        <button
          type="submit"
          aria-disabled={sending || undefined}
          className="mp-btn mp-btn--primary w-full justify-center aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
        >
          <Mail className="w-4 h-4" aria-hidden />
          {sending
            ? (de ? "E-Mail wird gesendet…" : "Sending email…")
            : (de ? "Bestätigungs-E-Mail senden" : "Send verification email")}
        </button>
      </form>
    </div>
  );
}

/* ═══════════════════════ SubscriptionCard ═══════════════════════ */

/** Provider billing and actual access expiry are deliberately separate. */
function SubscriptionCard({ sub, lang }: { sub: SubscriptionCardSnapshot; lang: Lang }) {
  const copyLang = renderLang(lang);
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
        {/* Until VERIFIED_CANCEL_PATH, no label claims a verified self-serve
            cancellation: the link opens Whop's membership page and the steps
            below are instructions. */}
        <a href={VERIFIED_CANCEL_PATH ? sub.manage_url! : WHOP_MANAGE_URL} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary min-h-11 h-auto whitespace-normal text-left">
          {canManage && VERIFIED_CANCEL_PATH
            ? copyLang === "de" ? "Kündigen oder verwalten (öffnet Whop in einem neuen Tab)" : "Cancel or manage (opens Whop in a new tab)"
            : copyLang === "de" ? "Abo bei Whop verwalten (öffnet Whop in einem neuen Tab, Seite auf Englisch)" : "Manage your plan at Whop (opens Whop in a new tab)"}
        </a>
      </div>}
      {canManage && <details className="text-sm text-[var(--mp-fg-muted)]">
        <summary className="min-h-11 flex items-center cursor-pointer text-[var(--mp-fg)]">{copyLang === "de" ? "Schritte zur Kündigung bei Whop" : "Steps to cancel at Whop"}</summary>
        <p className="leading-relaxed">{copyLang === "de" ? 'Melden Sie sich bei Whop mit derselben E-Mail-Adresse an, wählen Sie Ihre Mitgliedschaft und dann „Cancel membership“. Die Whop-Seite ist auf Englisch.' : 'Log in to Whop with the same email, select your membership, then "Cancel membership".'}</p>
      </details>}
      <p className="text-sm text-[var(--mp-fg-muted)]">
        {copyLang === "de" ? "Fragen zur Abrechnung? " : "Questions about billing? "}
        <a className="underline underline-offset-2" href={`mailto:${BILLING_SUPPORT_EMAIL}`}>{BILLING_SUPPORT_EMAIL}</a>
        {" "}{SUPPORT_REPLY_PROMISE[copyLang === "de" ? "de" : "en"]}
      </p>
    </Card>
  );
}
