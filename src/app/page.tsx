"use client";
import PendingPaymentBanner from "@/components/PendingPaymentBanner";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { buildQuizHref } from "@/lib/quiz-links";

import { loadHomeTopics, miniAppAuthFailure } from "@/lib/home-topics-request";
import { Alert, Button } from "@/components/ui";
import { startTopicProgressRequest } from "@/lib/topic-progress-request";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { DataRegion } from "@/components/ui/DataRegion";
import { trackEvent } from "@/lib/tracker";
import { DataResponseError, createRequestSequence } from "@/lib/async-data";
import { completeAuthEntry } from "@/lib/auth-entry-completion";
import { readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import { t, getUiLang, useLang, renderLang, type Lang } from "@/lib/i18n";
import { Lightbulb, ClipboardList, CheckCircle, User, ChevronRight, Search, Target, ArrowRight } from "lucide-react";
import { isTelegramMiniApp, getMiniAppInitData, getStoredSession, storeSession, setSessionToken, clearSession } from "@/lib/auth";
import { isStandalonePWA, isTouchFirstDevice } from "@/lib/telegram-login";
import TelegramCodeHandoff from "@/components/TelegramCodeHandoff";
import { useUserTier } from "@/lib/hooks/useUserTier";
import {
  getStoredExamSource,
  hasSelectedExam,
  setStoredExamSource,
  VIENNA_EXAM_PARTS,
  type ExamSourceId,
} from "@/lib/topics";
import LanguagePicker from "@/components/LanguagePicker";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import TopicCard from "@/components/TopicCard";
import HomeHero from "@/components/HomeHero";
import HomeStatStrip from "@/components/HomeStatStrip";
import HomeDeadlineLine from "@/components/HomeDeadlineLine";
import TelegramActivationCard from "@/components/TelegramActivationCard";
import TrialAnnouncementCard from "@/components/TrialAnnouncementCard";
import ExamSelector from "@/components/ExamSelector";
import ExamSwitcherInline from "@/components/ExamSwitcherInline";
import Onboarding from "@/components/Onboarding";
import SearchModal from "@/components/SearchModal";
import ThemeToggle from "@/components/ThemeToggle";
import { getWeakTopics, type TopicStats } from "@/lib/weakness";
import Link from "next/link";
import WhatsNewModal from "@/components/WhatsNewModal";
import OrientationModal from "@/components/OrientationModal";
import ReferralShareFloater from "@/components/ReferralShareFloater";
import ReferralCodeCard from "@/components/ReferralCodeCard";
import CheckoutStallPrompt from "@/components/CheckoutStallPrompt";
import UserSurveyModal from "@/components/UserSurveyModal";
import ResumeSessionCard from "@/components/ResumeSessionCard";
import { useToast } from "@/components/ui";



interface User {
  id: string;
  telegram_id?: number;
  first_name: string;
  last_name?: string;
  xp_total: number;
  streak_count: number;
  daily_goal: number;
}

interface Gamification {
  total_xp: number;
  current_streak: number;
  total_questions_answered: number;
  total_correct: number;
  daily_questions_today: number;
}

interface TopicCount {
  topic: string;
  count: number;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: Record<string, unknown>;
        ready: () => void;
        expand: () => void;
        setHeaderColor: (color: string) => void;
        setBackgroundColor: (color: string) => void;
        themeParams: Record<string, string>;
      };
    };
  }
}

/** Floating weakness toast — appears top-right, auto-dismisses after 8s.
 *  Retuned Apr 23 to use the viridian "suggestion" palette (calm coach tone)
 *  rather than the old warning-yellow accent. Matches the inline suggestion
 *  card below the hero. */
function WeaknessToast({ weakTopics, lang }: { weakTopics: TopicStats[]; lang: Lang }) {
  const [visible, setVisible] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (weakTopics.length === 0) return;
    const timer = setTimeout(() => setVisible(false), 8000);
    return () => clearTimeout(timer);
  }, [weakTopics.length]);

  if (!visible || dismissed || weakTopics.length === 0) return null;
  const wt = weakTopics[0];
  const acc = Math.min(Math.round(wt.accuracy), 100);

  return (
    <div className="fixed top-4 right-4 z-50 max-w-sm animate-slide-up">
      <div
        className="rounded-2xl p-4 shadow-[var(--mp-shadow-elev)] bg-[var(--mp-surface-raised)] border-l-[3px]"
        style={{ borderLeftColor: "var(--mp-viridian)", border: "1px solid var(--mp-border-subtle)", borderLeft: "3px solid var(--mp-viridian)" }}
      >
        <div className="flex items-start gap-3">
          <Lightbulb className="w-5 h-5 text-[var(--mp-viridian)] flex-shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[var(--mp-fg)] mb-0.5">
              {t("home_focus", lang).replace("{topic}", wt.topic)}
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)]">
              {t("home_focus_body", lang).replace("{n}", String(acc))}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0 mp-focusable"
            aria-label={t("home_close", lang)}
          >
            <span className="text-lg leading-none">&times;</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Time-of-day-aware greeting. German/English parity. Kept local since it's
 *  tiny and the dashboard is the only consumer. */
function getGreeting(lang: Lang): string {
  const h = new Date().getHours();
  if (h < 12) return t("home_good_morning", lang);
  if (h < 18) return t("home_good_afternoon", lang);
  return t("home_good_evening", lang);
}

/** Human label for the active exam — used in the cohort chip next to the
 *  greeting. Matches the ExamSwitcherInline naming. */
function getExamLabel(examSource: string, lang: Lang): string {
  if (examSource === "kenntnispruefung") return t("home_kenntnispr_fung_vienna", lang);
  if (examSource === "kmp_innsbruck") return t("home_stichprobentest_innsbruck", lang);
  if (examSource === "pharma") return t("home_pharmakologie", lang);
  return examSource;
}

export default function Home() {
  const router = useRouter();
  // Live tier read: refreshes from /api/auth/me on mount so a just-paid
  // buyer who lands here via the success page doesn't see a stale-free
  // screen. referralsEnabled gates the referral card (invite-only).
  const { referralsEnabled } = useUserTier();

  const [user, setUser] = useState<User | null>(null);
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topicsError, setTopicsError] = useState(false);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsExam, setTopicsExam] = useState<ExamSourceId | null>(null);
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const topicRequest = useRef(createRequestSequence());
  const uiLang = useLang();
  const lang = renderLang(uiLang);
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const [showExamSelector, setShowExamSelector] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [weakTopics, setWeakTopics] = useState<TopicStats[]>([]);
  // Search state in the authenticated shell is delegated to <SearchModal/>.
  // We only track whether the modal is open — the query/results/loading live
  // inside the modal itself.
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileData, setProfileData] = useState<{ targetDate?: string } | null>(null);
  // Initialize synchronously on first render: if the URL already carries
  // `?tg_token=...`, we're in the middle of a Telegram bot deep-link
  // exchange. Setting the flag NOW (not in a useEffect, which runs AFTER
  // first paint) prevents the early-return "redirect to /landing" branch
  // from firing before the exchange useEffect can claim the token.
  // Fixes C-3 Telegram deep-link race (was: commit `86caf6b` — unverified).
  //
  // FB-08 (mobile-PWA): we only auto-exchange here when the session will
  // persist in the RIGHT storage context — the installed PWA (standalone)
  // or a desktop browser. On a phone that is NOT the installed app (i.e.
  // Telegram's in-app browser or a mobile browser tab), auto-exchanging
  // would burn the single-use token in throwaway storage and the app
  // would still be logged out. There we show the copy-code hand-off
  // instead (see handoffToken below), so the user pastes the code into
  // the app and the session mints where they actually study.
  const [processingTgToken, setProcessingTgToken] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const hasToken = new URLSearchParams(window.location.search).has("tg_token");
      if (!hasToken) return false;
      // Auto-exchange only where the session sticks: the installed PWA, or
      // a fine-pointer (desktop) browser. A touch-first device that isn't
      // the installed app gets the copy-code hand-off instead.
      return isStandalonePWA() || !isTouchFirstDevice();
    } catch {
      return false;
    }
  });
  // When set, render the copy-code hand-off screen instead of exchanging:
  // the mobile-browser/WebView case where the session must be minted in
  // the installed app, not here. Initialised synchronously (same reason
  // as processingTgToken) so the /landing redirect branch never wins.
  const [handoffToken, setHandoffToken] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const tok = new URLSearchParams(window.location.search).get("tg_token");
      if (!tok) return null;
      const autoExchange = isStandalonePWA() || !isTouchFirstDevice();
      return autoExchange ? null : tok;
    } catch {
      return null;
    }
  });
  const [showCohortConfetti, setShowCohortConfetti] = useState(false);
  const toast = useToast();

  // Juni-26-Kohorte post-checkout greeting — fires when the NOWPayments
  // success redirect lands on /?welcome=cohort (or the legacy
  // /?welcome=founder alias that older invoices may still carry).
  // Shows a one-time toast + pure-CSS confetti burst, then cleans the
  // URL so the greeting does NOT replay on refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const welcome = url.searchParams.get("welcome");
    if (welcome !== "cohort" && welcome !== "founder") return;

    // Small delay so the ToastProvider is mounted (layout wraps us).
    const timer = setTimeout(() => {
      const lng = getUiLang();
      toast.success(
        t("home_welcome_to_the_exam_cohort", lng),
        t("home_your_full_access_is_active_for_6_months_with_pass_until_you_pass_good_", lng)
      );
      setShowCohortConfetti(true);
      // Clean the URL so refresh doesn't retrigger.
      url.searchParams.delete("welcome");
      window.history.replaceState({}, "", url.pathname + url.search);
      // Remove confetti from the DOM once the animation finishes.
      setTimeout(() => setShowCohortConfetti(false), 3000);
    }, 200);

    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const src = getStoredExamSource();
    setExamSource(src);
    // Onboarding only shows AFTER login, not before (non-logged-in users go to /landing)
    // Checked after authenticate() resolves — see below
  }, []);

  // Bot deep-link login: if URL carries ?tg_token=..., exchange it for a session.
  // This runs BEFORE the redirect-to-landing check so we don't lose the token.
  //
  // FB-08: in the mobile-browser/WebView case we do NOT exchange here —
  // the token must be pasted into the installed app so the session mints
  // in the right context. That case is handled by <TelegramCodeHandoff>
  // (handoffToken is set synchronously above). Bailing before the
  // exchange keeps the single-use token ALIVE for the app to claim.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const tgToken = url.searchParams.get("tg_token");
    if (!tgToken) return;
    // Hand-off context: leave the token in the URL untouched, show the
    // copy-code screen instead of burning it here.
    if (!isStandalonePWA() && isTouchFirstDevice()) return;
    setProcessingTgToken(true);
    (async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenExchange: tgToken }), timeoutMs: 15_000, skipAuthRedirect: true,
        });
        if (res.ok) {
          const data = await res.json();
          storeSession({ user: data.user, gamification: data.gamification });
          // Persist the signed session token (S-1) before the reload so
          // authFetch can authenticate the post-reload requests.
          setSessionToken(data.sessionToken);
          // Remove the one-time token from the URL so a refresh can't replay it.
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
          // Reload so the rest of the app picks up the new session.
          window.location.replace(await completeAuthEntry(new URLSearchParams(window.location.search)));
        } else {
          // Clear the bad token from the URL and fall through to normal flow
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
          window.location.replace(buildAuthHref(readAuthEntry(), "telegram_expired"));
        }
      } catch {
        setProcessingTgToken(false); setError("auth");
      }
    })();
  }, []);

  const fetchTopics = useCallback(async (src: ExamSourceId) => {
    const request = topicRequest.current.begin();
    setTopicsLoading(true);
    try {
      const data = await loadHomeTopics(src, fetch, request.signal);
      if (request.current()) { setTopics(data); setTopicsExam(src); setTopicsError(false); }

    } catch (failure) {
      if (request.current()) {
        setTopicsError(true);
        const reason = !navigator.onLine ? "offline" : failure instanceof DOMException && failure.name === "TimeoutError" ? "timeout"
          : failure instanceof DataResponseError ? failure.status === 502 ? "malformed" : "server" : "network";
        trackEvent("home_load_failed", { region: "topics", reason, examSource: src });
      }
    }
    finally { if (request.current()) setTopicsLoading(false); }
  }, []);

  const authenticate = useCallback(async () => {
    try {
      const isMiniApp = isTelegramMiniApp();
      const tg = window.Telegram?.WebApp;

      if (isMiniApp && tg) {
        tg.ready();
        tg.expand();
        tg.setHeaderColor("#F7F9FC");
        tg.setBackgroundColor("#F7F9FC");
      }

      const src = getStoredExamSource();
      setExamSource(src);
      const cached = getStoredSession();
      if (cached?.user) { setUser(cached.user); setGam(cached.gamification); setLoading(false); }
      // Topics must never decide whether the learner has a session.
      void fetchTopics(src).catch(() => setError("data"));

      if (isMiniApp) {
        const initData = getMiniAppInitData();
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!res.ok) {
          if (miniAppAuthFailure(res.status, !!cached?.user) === "auth") { setError("auth"); setUser(null); setGam(null); if (res.status === 401 || res.status === 403) clearSession(); }
          setLoading(false);
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setGam(data.gamification);
        // Persist the signed session token (S-1) so authFetch can
        // authenticate the Mini App's subsequent API calls. Previously
        // the Mini App set React state only — with no x-user-id in
        // localStorage, authFetch sent nothing and guarded calls failed.
        setSessionToken(data.sessionToken);
        // Mini App: auto-select exam if not set
        if (!hasSelectedExam()) {
          setStoredExamSource("kenntnispruefung");
          setExamSource("kenntnispruefung");
        }
      } else {
        const stored = getStoredSession();
        if (stored) {
          setUser(stored.user);
          setGam(stored.gamification);
          // Show onboarding ONLY for logged-in users who haven't
          // completed it. Server-side state is the source of truth
          // (review-2026-04-26-A2): localStorage clears on every fresh
          // browser/incognito, which previously re-fired the flow for
          // returning users (Aml, [name], Obai). We optimistically check
          // localStorage first to avoid a flicker for the common case;
          // if it's empty we hit /api/user/onboarding-state, and ONLY
          // show the modal when the server confirms incomplete.
          try {
            const onboardingData = localStorage.getItem("medpruef_onboarding");
            const parsed = onboardingData ? JSON.parse(onboardingData) : null;
            if (parsed?.completedAt) {
              // Already completed locally — no server call needed.
            } else {
              // localStorage doesn't say completed. Ask the server
              // before showing the modal.
              fetch("/api/user/onboarding-state")
                .then((r) => (r.ok ? r.json() : null))
                .then((s) => {
                  if (s?.completed_at || s?.skipped_at) {
                    // Server says we already finished. Mirror to
                    // localStorage so future renders skip the network.
                    try {
                      localStorage.setItem(
                        "medpruef_onboarding",
                        JSON.stringify({
                          completedAt: s.completed_at ?? s.skipped_at,
                          ...(s.data ?? {}),
                        }),
                      );
                    } catch {}
                  } else if (s && s.completed_at === null) {
                    setShowOnboarding(true);
                  }
                })
                .catch(() => {
                  // Network failure — fall back to the localStorage
                  // outcome (i.e. show the modal). Better to re-show
                  // than to lose users to "no onboarding ever ran."
                  setError("data");
                });
            }
          } catch {}
        } else {
          setError("auth");
        }
      }
    } catch {
      if (miniAppAuthFailure(null, !!getStoredSession()?.user) === "auth") setError("auth");
    } finally {
      setLoading(false);
    }
  }, [fetchTopics]);

  useEffect(() => {
    const requests = topicRequest.current;
    void authenticate();
    const onTelegramReady = () => void authenticate();
    window.addEventListener("medpruef:telegram-ready", onTelegramReady);
    return () => { window.removeEventListener("medpruef:telegram-ready", onTelegramReady); requests.cancel(); };
  }, [authenticate]);

  // Refresh gamification data when returning from a quiz (page becomes visible again)
  useEffect(() => {
    let lastRefresh = 0;
    const handleVisibility = () => {
      if (Date.now() - lastRefresh < 60_000) return;
      lastRefresh = Date.now();
      if (document.visibilityState === 'visible' && user?.id && !user.id.startsWith('guest_')) {
        // Simpler: just re-read the stored session (which the answer API updates)
        const stored = getStoredSession();
        if (stored?.gamification) setGam(stored.gamification);
      }
    };
    const onOnline = () => { trackEvent("offline_state", { online: true }); void fetchTopics(getStoredExamSource()); };
    const onOffline = () => trackEvent("offline_state", { online: false });
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { document.removeEventListener('visibilitychange', handleVisibility); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, [user?.id, fetchTopics]);

  // Fetch server-side per-topic progress once user and examSource are known
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressAccount, setProgressAccount] = useState<string | null>(null);
  const [progressExam, setProgressExam] = useState<ExamSourceId | null>(null);
  const [topicProgressError, setTopicProgressError] = useState(false);
  const [topicProgressRetry, setTopicProgressRetry] = useState(0);
  const [topicProgress, setTopicProgress] = useState<Record<string, { answered: number; correct: number; wrong: number; accuracy: number }>>({});
  useEffect(() => {
    setWeakTopics([]);
    setProgressLoading(true);

    if (!user?.id || user.id.startsWith('guest_')) {
      setWeakTopics(getWeakTopics());
      setProgressLoading(false);
      return;
    }
    const request = startTopicProgressRequest(examSource, fetch, data => {
      const map: typeof topicProgress = {};
      const weak: TopicStats[] = [];
      for (const tp of data) {
        map[tp.topic] = { answered: tp.answered, correct: tp.correct, wrong: tp.wrong, accuracy: tp.accuracy };
        if (tp.answered > 0) weak.push({ topic: tp.topic, correct: tp.correct, total: tp.answered, accuracy: tp.accuracy });
      }
      setTopicProgressError(false);
      setTopicProgress(map);
      setProgressExam(examSource);
      setProgressAccount(user.id);
      setProgressLoading(false);
      setWeakTopics(weak.filter(w => w.accuracy < 80).sort((a, b) => a.accuracy - b.accuracy));
    }, () => { setTopicProgressError(true); setProgressLoading(false); });
    return request.cancel;
  }, [user?.id, examSource, topicProgressRetry]);

  // Load profile data (exam target date) from localStorage. Prefer
  // `medpruef_profile.targetDate` — written by BOTH onboarding's
  // handleFinish AND Settings — so re-anchoring the date in Settings (the
  // path for the ~60 users still on exam_date=NULL) reflects on the home
  // guided-path card. Fall back to the legacy `medpruef_onboarding.examDate`.
  useEffect(() => {
    try {
      const profileRaw = localStorage.getItem("medpruef_profile");
      const onbRaw = localStorage.getItem("medpruef_onboarding");
      const profileDate = profileRaw ? JSON.parse(profileRaw)?.targetDate : undefined;
      const onbDate = onbRaw ? JSON.parse(onbRaw)?.examDate : undefined;
      const targetDate = profileDate || onbDate;
      if (targetDate) setProfileData({ targetDate });
    } catch {}
  }, []);

  // Post-auth sync for the public Find-Your-Path flow.
  //
  // The anon /find-your-path flow writes the lead's route + exam date +
  // daily goal to localStorage (same keys as in-app onboarding) but it
  // CANNOT PATCH the server (no session). So a lead who oriented before
  // signing up lands with users.active_exam / exam_date still NULL, and
  // the in-app study plan would be empty. On the first authenticated
  // home load, if localStorage carries a path (examSource) but the
  // server user has no active_exam, push it once: PATCH exam-preference
  // (so /api/user/study-plan generates) + stamp onboarding-complete (so
  // the modal does not re-fire). One-shot per browser via a guard flag.
  useEffect(() => {
    if (!user?.id || user.id.startsWith("guest_")) return;
    try {
      if (localStorage.getItem("medpruef_fyp_synced") === "1") return;
      const onbRaw = localStorage.getItem("medpruef_onboarding");
      const onb = onbRaw ? JSON.parse(onbRaw) : null;
      // Only act on a Find-Your-Path payload that carries an exam source.
      const examSource: string | undefined = onb?.examSource;
      if (!examSource) return;
      // If the server already knows the user's exam, nothing to sync.
      const serverActiveExam = (user as { active_exam?: string | null }).active_exam;
      if (serverActiveExam) {
        localStorage.setItem("medpruef_fyp_synced", "1");
        return;
      }
      const isISODate =
        typeof onb?.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(onb.examDate);
      const body: Record<string, string | number> = { activeExam: examSource };
      if (onb?.dailyGoal && onb.dailyGoal > 0) body.dailyGoal = onb.dailyGoal;
      if (isISODate) body.examDate = onb.examDate;

      fetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});

      fetch("/api/user/onboarding-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          examSource,
          examDate: onb?.examDate,
          dailyGoal: onb?.dailyGoal,
          language: onb?.language,
        }),
      }).catch(() => {});

      localStorage.setItem("medpruef_fyp_synced", "1");
    } catch {
      /* never block the home render on a best-effort sync */
    }
  }, [user]);

  // Cmd+K / Ctrl+K to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        // Focus after DOM updates
        setTimeout(() => {
          const searchInput = document.querySelector('input[placeholder*="such"], input[placeholder*="Search"]') as HTMLInputElement;
          if (searchInput) searchInput.focus();
        }, 100);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleExamSelected = useCallback(
    async (id: ExamSourceId) => {
      setExamSource(id);
      setShowExamSelector(false);
      await fetchTopics(id);
    },
    [fetchTopics]
  );

  if (loading && !showExamSelector) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  if (showOnboarding) {
    return <Onboarding lang={lang} onComplete={(data) => {
      setShowOnboarding(false);
      setStoredExamSource(data.examSource as ExamSourceId);
      setExamSource(data.examSource as ExamSourceId);
      // Finish onboarding at the first useful action so the learner can answer
      // immediately instead of returning to a dashboard and having to find a quiz.
      router.push(buildQuizHref({ topic: "random", examSource: encodeURIComponent(data.examSource), practiceMode: "unseen" }));
      // Persist exam_source + exam_date + daily_goal to server so the user's
      // active_exam stays in sync across devices and feeds /api/user/study-plan.
      // Best-effort: don't block onboarding completion if the call fails.
      //
      // ALSO stamp users.onboarding_completed_at via the dedicated
      // endpoint so the next sign-in from a fresh browser doesn't
      // re-fire onboarding (review-2026-04-26-A2). Parallel,
      // fire-and-forget — neither call blocks the UI transition.
      if (user?.id && !user.id.startsWith("guest_")) {
        const isISODate = typeof data.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.examDate);
        const body: Record<string, string | number> = { activeExam: data.examSource };
        if (data.dailyGoal && data.dailyGoal > 0) body.dailyGoal = data.dailyGoal;
        if (isISODate) body.examDate = data.examDate;
        fetch("/api/user/exam-preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).catch(() => {});

        fetch("/api/user/onboarding-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            examSource: data.examSource,
            examDate: data.examDate,
            dailyGoal: data.dailyGoal,
            language: data.language,
          }),
        }).catch(() => {});
      }
    }} />;
  }

  if (showExamSelector) {
    return <ExamSelector lang={lang} onSelect={handleExamSelected} />;
  }

  // FB-08 mobile-PWA hand-off: a phone opened the login link outside the
  // installed app (Telegram's in-app browser or a mobile browser tab).
  // Instead of burning the single-use token in throwaway storage, show
  // the copy-code screen so the user pastes it into the app, where the
  // session mints and persists. "Continue in this browser" is the escape
  // hatch for users who actually study in the mobile browser — it runs
  // the normal exchange right here.
  if (handoffToken && !user) {
    return (
      <TelegramCodeHandoff
        code={handoffToken}
        lang={lang}
        onContinueInBrowser={() => {
          // Fall through to the standard exchange in THIS context.
          setHandoffToken(null);
          setProcessingTgToken(true);
          (async () => {
            try {
              const res = await fetch("/api/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ tokenExchange: handoffToken }), timeoutMs: 15_000, skipAuthRedirect: true,
              });
              if (res.ok) {
                const data = await res.json();
                storeSession({ user: data.user, gamification: data.gamification });
                setSessionToken(data.sessionToken);
                const url = new URL(window.location.href);
                url.searchParams.delete("tg_token");
                window.history.replaceState({}, "", url.toString());
                window.location.replace(await completeAuthEntry(new URLSearchParams(window.location.search)));
              } else {
                const url = new URL(window.location.href);
                url.searchParams.delete("tg_token");
                window.history.replaceState({}, "", url.toString());
                setProcessingTgToken(false);
              }
            } catch {
              setProcessingTgToken(false);
            }
          })();
        }}
      />
    );
  }

  // If we're processing a Telegram bot token, show loader instead of redirecting
  if (processingTgToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)] gap-4">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {t("home_signing_in", lang)}
        </p>
      </div>
    );
  }

  if (!user) {
    return <main className="min-h-screen bg-[var(--mp-surface-sunken)] px-4 py-12">
        <PartialTranslationNote />
      <DataRegion error={!!error} retry={() => void authenticate()} />
      <Link className="mp-btn mp-btn--primary min-h-11" href={buildAuthHref({ intent: 'free', exam: examSource })}>{t("home_sign_in", lang)}</Link>
    </main>;
  }

  const accuracy = gam && gam.total_questions_answered > 0 ? Math.round((gam.total_correct / gam.total_questions_answered) * 100) : 0;

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={uiLang}
          userId={user.id}
          userName={user.first_name}
          totalXp={gam?.total_xp || 0}
          streak={gam?.current_streak || 0}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={uiLang} userId={user.id} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        <PendingPaymentBanner />
        <PartialTranslationNote />

        {/*
          DASHBOARD LAYOUT — redesigned 2026-04-23 (visual-overhaul sprint).

          Design principles:
            • 8-pt spacing grid — section gaps 24/32/48px, card padding 16/24px.
            • Card radius is `var(--mp-r-card)` (16px); buttons/pills smaller.
            • Gamification hero OWNS the eye above the fold. Nothing competes.
            • ONE primary CTA ("Continue"), secondaries are visually quieter.
            • Coach tone replaces alert tone — viridian suggestions, no
              warning-yellow for helpful nudges.
            • All colors route through `var(--mp-*)` tokens. Dark mode is
              a single variable flip, not a class-override matrix.
            • Every interactive element has a visible `:focus-visible` ring.
        */}

        {/* ─── HEADER (mobile) ─────────────────────────────────────────────
           Toolset (theme, language, search, exam switcher) collapsed into
           a compact toolbar row so the greeting has room to breathe. */}
        <div className="lg:hidden px-4 pt-5 pb-2">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
              aria-label={t("suche_oeffnen", lang)}
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
            <ExamSwitcherInline variant="compact" />
            <ThemeToggle />
            <LanguagePicker compact />
            {/* Profile/Settings entry — moved here when Profile left the bottom
               nav (which now carries a symmetric 5 slots). Mirrors the Sidebar
               avatar (viridian, white initial). Keeps Settings reachable on
               mobile, where the Sidebar is hidden below lg. */}
            <Link
              href="/settings"
              aria-label={t("settings", lang)}
              title={t("settings", lang)}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--mp-viridian)] text-white text-xs font-bold ring-2 ring-[var(--mp-accent-teal)]/30 hover:opacity-90 transition-opacity mp-focusable flex-shrink-0"
            >
              {(user.first_name || "M").charAt(0).toUpperCase()}
            </Link>
          </div>
        </div>

        {/* ─── HEADER (desktop) ────────────────────────────────────────────
           Aligned right — the greeting lives in the content block below,
           not in the header, so we don't duplicate the user's name twice. */}
        <div className="hidden lg:flex px-10 pt-6 pb-2 items-center justify-end gap-3">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
            aria-label={t("suche_oeffnen", lang)}
            title="Cmd+K"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
          <ThemeToggle />
          <LanguagePicker />
        </div>

        <div className="px-4 sm:px-6 lg:px-10 pb-8 pt-2 lg:pt-4">
          {/* Telegram bot activation prompt — shown to users who
             registered via Login Widget but never DM'd the bot.
             Auto-hides via /api/user/telegram-activation-state.
             review-2026-04-26-B2. */}
          <TelegramActivationCard />

          {/* ─── HERO PROGRESS BANNER + STAT STRIP ───────────────────────
             Reimplementation v3 (01-home.html, blessed). The hero is the one
             sanctioned gradient: greeting + "Du bist X% näher am Bestehen 🇦🇹"
             + active-exam answered/total bar (spark-glow fill) + two CTAs.
             The XP/rank/streak/accuracy that the old GamificationHero showed
             relocate into the 3-tile stat strip directly below. */}
          {(() => {
            // Both values use the selected exam scope. The numerator is the
            // distinct-question count from topic-progress, never answer attempts.
            const examTotal = topicsExam === examSource ? topics.reduce((sum, tp) => sum + tp.count, 0) : null;
            const trackingAvailable = !user.id.startsWith('guest_');
            const answeredCount = trackingAvailable && progressExam === examSource && progressAccount === user.id
              ? Object.values(topicProgress).reduce((sum, tp) => sum + tp.answered, 0)
              : null;
            // days-left from users.exam_date (mirrored in localStorage profile).
            const target = profileData?.targetDate;
            const daysLeft =
              target && !isNaN(new Date(target).getTime())
                ? Math.ceil((new Date(target).getTime() - Date.now()) / 86400000)
                : null;
            // Study now means new questions across the selected exam. Topic
            // cards provide the topic-scoped version; review modes live in the
            // practice builder below rather than silently changing this CTA.
            const studyHref = buildQuizHref({ topic: "random", examSource: examSource, practiceMode: "unseen" });
            return (
              <div className="mb-5">
                <HomeHero
                  greeting={getGreeting(uiLang)}
                  userName={user.first_name}
                  examLabel={getExamLabel(examSource, uiLang)}
                  answered={answeredCount}
                  total={examTotal}
                  trackingAvailable={trackingAvailable}
                  progressLoading={progressLoading || topicsLoading}
                  progressError={topicProgressError || topicsError}
                  onProgressRetry={() => { setTopicProgressRetry(n => n + 1); void fetchTopics(examSource); }}
                  studyHref={studyHref}
                  planHref="/study-plan"
                  lang={uiLang}
                  daysLeft={daysLeft}
                />
                <HomeDeadlineLine className="mt-3" />
                <div className="mt-2 text-center">
                  <Link
                    href={`/quiz?setup=1&examSource=${encodeURIComponent(examSource)}`}
                    className="text-xs font-semibold text-[var(--mp-viridian)] hover:underline underline-offset-2"
                  >
                    {t("home_other_modes_practice_incorrect_or_saved_questions", lang)}
                  </Link>
                </div>
                <div className="mt-4">
                  {gam && <HomeStatStrip
                    streak={gam?.current_streak || 0}
                    dailyCurrent={gam?.daily_questions_today || 0}
                    dailyGoal={user.daily_goal || 20}
                    accuracy={accuracy}
                    lang={uiLang}
                  />}
                </div>
              </div>
            );
          })()}

          <TrialAnnouncementCard userId={user.id} lang={uiLang} className="mb-6" />

          {/* ─── RESUME SESSION CARD (if any) — "Weitermachen" ──────────── */}
          {!user.id.startsWith("guest_") && (
            <div className="mt-6">
              <h2 className="mp-h3 mb-3" style={{ color: "var(--mp-fg)" }}>
                {t("home_continue", lang)}
              </h2>
              <ResumeSessionCard userId={user.id} lang={uiLang} />
            </div>
          )}

          {/* ─── REFERRAL CODE CARD ─────────────────────────────────────
             Rescue-sprint §4 (2026-04-24): show the code on day 1 so
             users know the program exists. Passive card (not a floater),
             no €-figures on first touch — the dollar numbers live on
             /referrals where users land with intent. The card itself
             self-gates against guests + against the announcement gate's
             `referral_floater` surface; see ReferralCodeCard.tsx for
             the coexistence rules with the gate. */}
          {!user.id.startsWith("guest_") && referralsEnabled && (
            <ReferralCodeCard userId={user.id} lang={lang} />
          )}

          {/* ─── CHECKOUT-STALL FEEDBACK PROMPT ────────────────────────
             2026-07-11: one-tap question for users who recently reached
             Whop checkout and never completed. Self-gates against
             ineligible/anonymous/already-answered users via
             /api/checkout-feedback/eligibility — see CheckoutStallPrompt.tsx. */}
          {!user.id.startsWith("guest_") && <CheckoutStallPrompt />}

          {/* ─── COACH SUGGESTION (calm viridian, replaces yellow warning)
             Rendered only when we have weak-topic signal. Content uses the
             lightbulb icon + viridian accent — feels helpful, not alarming.
             CTA is "Practice 10 questions" (concrete), not "Fix now" (scary).
           */}
          {weakTopics.length > 0 && (() => {
            const wt = weakTopics[0];
            const acc = Math.min(Math.round(wt.accuracy), 100);
            const href = buildQuizHref({ topic: wt.topic, examSource: examSource, practiceMode: "wrong", limit: 10 });
            return (
              <Link
                href={href}
                className="mp-suggestion mp-suggestion--interactive mp-focusable mb-8 group block"
                aria-label={t("coach_practice_10", lang)}
              >
                <div className="flex items-start gap-4">
                  <div className="mp-suggestion__icon" aria-hidden>
                    <Target className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] uppercase font-bold tracking-wider text-[var(--mp-viridian)] mb-1" style={{ letterSpacing: "0.08em" }}>
                      {t("coach_weak_topic_title", lang)}
                    </p>
                    <h3 className="mp-ui font-bold text-[var(--mp-fg)] mb-1">
                      {wt.topic}
                    </h3>
                    <p className="mp-small text-[var(--mp-fg-muted)]">
                      {t("home_coach_body", uiLang).replace("{n}", String(acc))}
                    </p>
                  </div>
                  <span
                    className="hidden sm:inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] flex-shrink-0 group-hover:translate-x-0.5 transition-transform"
                  >
                    {t("coach_practice_10", lang)}
                    <ArrowRight className="w-4 h-4" aria-hidden />
                  </span>
                </div>
              </Link>
            );
          })()}

          {/* Search Modal */}
          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            lang={uiLang}
            examSource={examSource}
            userId={user.id}
          />

          {/* ─── FACHGEBIETE GRID (01-home.html: section head + "Alle ansehen") ── */}
          <div className="mb-8 mt-8">
            <div className="flex items-center justify-between mb-4">
              <h2
                className="mp-h3 flex items-center gap-2"
                style={{ color: "var(--mp-fg)" }}
              >
                <span
                  className="inline-block w-1 h-6 rounded-full"
                  style={{ background: "var(--mp-viridian)" }}
                  aria-hidden
                />
                {t("specialties", lang)}
                <span className="text-sm font-normal text-[var(--mp-fg-subtle)]">
                  ({topicsExam !== examSource ? "..." : topics.length})
                </span>
              </h2>
              <Link
                href="/curriculum"
                className="inline-flex items-center gap-0.5 text-xs font-semibold mp-focusable"
                style={{ color: "var(--mp-cta-blue)" }}
              >
                {t("home_view_all", lang)}
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </div>

            {topicsError && <Alert variant="info" title={t("home_topics_error", uiLang)} className="mb-4">
              <Button variant="secondary" className="mt-2 min-h-11" aria-disabled={topicsLoading} aria-busy={topicsLoading} onClick={() => { if (!topicsLoading) void fetchTopics(examSource); }}>{t("request_retry", uiLang)}</Button>
            </Alert>}
            {topicsLoading && topicsExam !== examSource && <DataRegion loading retry={() => void fetchTopics(examSource)} />}
            {topicsExam === examSource && (examSource === "kenntnispruefung" ? (
              <>
                {/* SIP quick-start */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <Link
                    href={`/exam?examSource=kenntnispruefung&part=sip4`}
                    className="mp-card rounded-2xl p-4 flex items-center justify-between text-sm mp-focusable hover:border-[var(--mp-viridian)]/35 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-warning-dk)]" aria-hidden />
                      <span className="truncate font-semibold">{t("practice_sip4", lang)}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
                  </Link>
                  <Link
                    href={`/exam?examSource=kenntnispruefung&part=sip5`}
                    className="mp-card rounded-2xl p-4 flex items-center justify-between text-sm mp-focusable hover:border-[var(--mp-viridian)]/35 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                      <span className="truncate font-semibold">{t("practice_sip5", lang)}</span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--mp-fg-subtle)]" aria-hidden />
                  </Link>
                </div>

                {/* SIP 4 */}
                <h3
                  className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
                  style={{ color: "var(--mp-warning-dk)", letterSpacing: "0.08em" }}
                >
                  <span
                    className="inline-block w-1 h-4 rounded-full"
                    style={{ background: "var(--mp-warning-dk)" }}
                    aria-hidden
                  />
                  {t("sip4_label", lang)}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 mb-8 stagger">
                  {topics
                    .filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic))
                    .map((tp, i) => (
                      <TopicCard
                        key={tp.topic}
                        topic={tp.topic}
                        count={tp.count}
                        userId={user.id}
                        lang={uiLang}
                        delay={i * 50}
                        examSource={examSource}
                        accuracy={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.accuracy : undefined}
                        answered={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.answered : undefined}
                      />
                    ))}
                </div>

                {/* SIP 5 */}
                <h3
                  className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2"
                  style={{ color: "var(--mp-viridian)", letterSpacing: "0.08em" }}
                >
                  <span
                    className="inline-block w-1 h-4 rounded-full"
                    style={{ background: "var(--mp-viridian)" }}
                    aria-hidden
                  />
                  {t("sip5_label", lang)}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 stagger">
                  {topics
                    .filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic))
                    .map((tp, i) => (
                      <TopicCard
                        key={tp.topic}
                        topic={tp.topic}
                        count={tp.count}
                        userId={user.id}
                        lang={uiLang}
                        delay={i * 50}
                        examSource={examSource}
                        accuracy={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.accuracy : undefined}
                        answered={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.answered : undefined}
                      />
                    ))}
                </div>
              </>
            ) : (
              <><Link href={`/exam?examSource=${examSource}`} className="mp-card mp-focusable flex min-h-11 items-center justify-between p-4 mb-4">
                <span className="flex items-center gap-2"><ClipboardList aria-hidden className="w-4 h-4" />{t("home_simulation", uiLang)}</span>
                <ChevronRight aria-hidden className="w-4 h-4" />
              </Link><div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 stagger">
                {topics.map((tp, i) => (
                  <TopicCard
                    key={tp.topic}
                    topic={tp.topic}
                    count={tp.count}
                    userId={user.id}
                    lang={uiLang}
                    delay={i * 50}
                    examSource={examSource}
                    accuracy={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.accuracy : undefined}
                    answered={progressExam === examSource && progressAccount === user.id ? topicProgress[tp.topic]?.answered : undefined}
                  />
                ))}
              </div></>
            ))}
          </div>

          {/* ─── VIEW FULL PROGRESS LINK ───────────────────────────────── */}
          <Link
            href="/progress"
            className="mp-card rounded-2xl p-4 flex items-center justify-between cursor-pointer mp-focusable hover:border-[var(--mp-viridian)]/35 transition-colors group"
          >
            <span className="text-sm font-semibold text-[var(--mp-viridian)]">
              {t("view_full_progress", lang)}
            </span>
            <ChevronRight className="w-5 h-5 text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-viridian)] group-hover:translate-x-0.5 transition-all" aria-hidden />
          </Link>
        </div>
      </main>


      {/* Weakness toast — floating top-right, auto-dismiss */}
      <WhatsNewModal />
      <OrientationModal />
      <UserSurveyModal />
      <ReferralShareFloater />
      <WeaknessToast weakTopics={weakTopics} lang={lang} />
      {showCohortConfetti && <CohortWelcomeCheck />}

    </AppLayout>
  );
}

/**
 * Cohort welcome check — replaces the old confetti burst (Apr 23).
 * A single viridian checkmark scales in, holds briefly, fades out.
 * MPDS-aligned, no inline hex, respects prefers-reduced-motion via
 * the `.mp-welcome-check` keyframe in globals.css.
 */
function CohortWelcomeCheck() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center"
      aria-hidden
    >
      <div
        className="mp-welcome-check flex items-center justify-center rounded-full"
        style={{
          width: 96,
          height: 96,
          background: "var(--mp-viridian)",
          boxShadow: "var(--mp-shadow-elev), 0 0 0 12px rgba(0, 123, 95, 0.15)",
        }}
      >
        <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} aria-hidden />
      </div>
    </div>
  );
}

/* ============================================
   DEMO HOME — not authenticated / web browser
   ============================================ */
