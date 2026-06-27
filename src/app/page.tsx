"use client";

import { useEffect, useState, useCallback } from "react";
import { BrandedLoader } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { getTopicConfig } from "@/lib/topics";
import { t, getLang, setLang } from "@/lib/i18n";
import TopicIcon from "@/components/TopicIcon";
import { Lightbulb, Shuffle, ClipboardList, CheckCircle, User, ChevronRight, Search, Target, ArrowRight } from "lucide-react";
import { isTelegramMiniApp, getMiniAppInitData, getStoredSession, storeSession, setSessionToken } from "@/lib/auth";
import { useUserTier } from "@/lib/hooks/useUserTier";
import {
  getStoredExamSource,
  hasSelectedExam,
  setStoredExamSource,
  VIENNA_EXAM_PARTS,
  type ExamSourceId,
} from "@/lib/topics";
import LanguageToggle from "@/components/LanguageToggle";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import TopicCard from "@/components/TopicCard";
import HomeHero from "@/components/HomeHero";
import HomeStatStrip from "@/components/HomeStatStrip";
import TelegramActivationCard from "@/components/TelegramActivationCard";
import ExamSelector from "@/components/ExamSelector";
import ExamSwitcherInline from "@/components/ExamSwitcherInline";
import Onboarding from "@/components/Onboarding";
import SearchBar from "@/components/SearchBar";
import SearchResults from "@/components/SearchResults";
import SearchModal from "@/components/SearchModal";
import ThemeToggle from "@/components/ThemeToggle";
import { getWeakTopics, type TopicStats } from "@/lib/weakness";
import Link from "next/link";
import WhatsNewModal from "@/components/WhatsNewModal";
import OrientationModal from "@/components/OrientationModal";
import ReferralShareFloater from "@/components/ReferralShareFloater";
import ReferralCodeCard from "@/components/ReferralCodeCard";
import UserSurveyModal from "@/components/UserSurveyModal";
import ResumeSessionCard from "@/components/ResumeSessionCard";
import { useToast } from "@/components/ui";

type Lang = "de" | "en";

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
function WeaknessToast({ weakTopics, lang }: { weakTopics: TopicStats[]; lang: string }) {
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
              {lang === "de" ? `Fokus: ${wt.topic}` : `Focus: ${wt.topic}`}
            </p>
            <p className="text-xs text-[var(--mp-fg-subtle)]">
              {lang === "de" ? `${acc}% Genauigkeit — 10 Fragen gezielt üben?` : `${acc}% accuracy — practice 10 focused questions?`}
            </p>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0 mp-focusable"
            aria-label={lang === "de" ? "Schließen" : "Close"}
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
function getGreeting(lang: "de" | "en"): string {
  const h = new Date().getHours();
  if (h < 12) return lang === "de" ? "Guten Morgen" : "Good morning";
  if (h < 18) return lang === "de" ? "Guten Tag" : "Good afternoon";
  return lang === "de" ? "Guten Abend" : "Good evening";
}

/** Human label for the active exam — used in the cohort chip next to the
 *  greeting. Matches the ExamSwitcherInline naming. */
function getExamLabel(examSource: string, lang: "de" | "en"): string {
  if (examSource === "kenntnispruefung") return lang === "de" ? "Kenntnisprüfung Wien" : "Kenntnisprüfung Vienna";
  if (examSource === "kmp_innsbruck") return lang === "de" ? "Stichprobentest (Innsbruck)" : "Stichprobentest (Innsbruck)";
  if (examSource === "pharma") return lang === "de" ? "Pharmakologie" : "Pharmakologie";
  return examSource;
}

export default function Home() {
  // Live tier read: refreshes from /api/auth/me on mount so a just-paid
  // buyer who lands here via the success page doesn't see a stale-free
  // screen. referralsEnabled gates the referral card (invite-only).
  const { referralsEnabled } = useUserTier();

  const [user, setUser] = useState<User | null>(null);
  const [gam, setGam] = useState<Gamification | null>(null);
  const [topics, setTopics] = useState<TopicCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lang, setLangState] = useState<Lang>("de");
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
  const [processingTgToken, setProcessingTgToken] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return new URLSearchParams(window.location.search).has("tg_token");
    } catch {
      return false;
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
      const lng = getLang();
      toast.success(
        lng === "de"
          ? "Willkommen in der Prüfungs-Kohorte."
          : "Welcome to the Exam Cohort.",
        lng === "de"
          ? "Dein Vollzugang ist 6 Monate lang aktiv, inkl. Pass-Until-You-Pass. Viel Erfolg bei der Prüfung."
          : "Your full access is active for 6 months, with Pass-Until-You-Pass. Good luck with the exam."
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
    setLangState(getLang());
    const src = getStoredExamSource();
    setExamSource(src);
    // Onboarding only shows AFTER login, not before (non-logged-in users go to /landing)
    // Checked after authenticate() resolves — see below
  }, []);

  // Bot deep-link login: if URL carries ?tg_token=..., exchange it for a session.
  // This runs BEFORE the redirect-to-landing check so we don't lose the token.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const tgToken = url.searchParams.get("tg_token");
    if (!tgToken) return;
    setProcessingTgToken(true);
    (async () => {
      try {
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenExchange: tgToken }),
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
          window.location.reload();
        } else {
          // Clear the bad token from the URL and fall through to normal flow
          url.searchParams.delete("tg_token");
          window.history.replaceState({}, "", url.toString());
          setProcessingTgToken(false);
        }
      } catch {
        setProcessingTgToken(false);
      }
    })();
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const fetchTopics = useCallback(async (src: ExamSourceId) => {
    const res = await fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "topics", examSource: src }),
    });
    const data = await res.json();
    setTopics(data);
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
      await fetchTopics(src);

      if (isMiniApp) {
        const initData = getMiniAppInitData();
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (!res.ok) {
          setError("demo");
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
                  } else {
                    setShowOnboarding(true);
                  }
                })
                .catch(() => {
                  // Network failure — fall back to the localStorage
                  // outcome (i.e. show the modal). Better to re-show
                  // than to lose users to "no onboarding ever ran."
                  setShowOnboarding(true);
                });
            }
          } catch {}
        } else {
          setError("demo");
        }
      }
    } catch (e) {
      console.error(e);
      setError("demo");
    } finally {
      setLoading(false);
    }
  }, [fetchTopics]);

  useEffect(() => {
    authenticate();
  }, [authenticate]);

  // Refresh gamification data when returning from a quiz (page becomes visible again)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && user?.id && !user.id.startsWith('guest_')) {
        fetch(`/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emailLogin: { email: '', password: '' } }), // dummy — we just need to re-fetch
        }).catch(() => {}); // non-critical
        // Simpler: just re-read the stored session (which the answer API updates)
        const stored = getStoredSession();
        if (stored?.gamification) setGam(stored.gamification);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [user?.id]);

  // Fetch server-side per-topic progress once user and examSource are known
  const [topicProgress, setTopicProgress] = useState<Record<string, { answered: number; correct: number; wrong: number; accuracy: number }>>({});
  useEffect(() => {
    if (!user?.id || user.id.startsWith('guest_')) {
      // For guests, fall back to localStorage weakness detection
      setWeakTopics(getWeakTopics());
      return;
    }
    fetch(`/api/user/topic-progress?userId=${user.id}&examType=${examSource}`)
      .then(r => r.json())
      .then((data: Array<{ topic: string; answered: number; correct: number; wrong: number; accuracy: number }>) => {
        const map: typeof topicProgress = {};
        const weak: TopicStats[] = [];
        for (const tp of data) {
          map[tp.topic] = { answered: tp.answered, correct: tp.correct, wrong: tp.wrong, accuracy: tp.accuracy };
          if (tp.answered > 0) {
            weak.push({ topic: tp.topic, correct: tp.correct, total: tp.answered, accuracy: tp.accuracy });
          }
        }
        setTopicProgress(map);
        setWeakTopics(weak.filter(w => w.accuracy < 80).sort((a, b) => a.accuracy - b.accuracy));
      })
      .catch(() => {
        setWeakTopics(getWeakTopics());
      });
  }, [user?.id, examSource]);

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
      setLoading(true);
      await fetchTopics(id);
      setLoading(false);
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
    return <Onboarding lang={lang} onLangChange={switchLang} onComplete={(data) => {
      setShowOnboarding(false);
      if (data.language && data.language !== lang) {
        switchLang(data.language as Lang);
      }
      setStoredExamSource(data.examSource as ExamSourceId);
      setExamSource(data.examSource as ExamSourceId);
      fetchTopics(data.examSource as ExamSourceId);
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

  // If we're processing a Telegram bot token, show loader instead of redirecting
  if (processingTgToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)] gap-4">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {lang === "de" ? "Anmeldung läuft..." : "Signing in..."}
        </p>
      </div>
    );
  }

  // Non-logged-in users → always redirect to /landing (no demo home)
  if ((error === "demo" || !user) && typeof window !== "undefined") {
    // Don't redirect if there's still a tg_token in the URL (race condition protection)
    const hasToken = new URLSearchParams(window.location.search).get("tg_token");
    if (!isTelegramMiniApp() && !hasToken) {
      window.location.href = "/landing";
      return (
        <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
          <BrandedLoader />
        </div>
      );
    }
  }

  // Fallback for Telegram Mini App without auth
  if (error === "demo" || !user) {
    return (
      <DemoHome
        topics={topics}
        lang={lang}
        examSource={examSource}
        onLangChange={switchLang}
        onChangeExam={() => setShowExamSelector(true)}
      />
    );
  }

  // Overall accuracy — displayed inside GamificationHero + the mobile
  // mini-stats row. Rank/level are resolved inside GamificationHero itself
  // (via its own getLevelFromXP call), so we don't need it at this layer.
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  return (
    <AppLayout
      sidebar={
        <Sidebar
          lang={lang}
          userId={user.id}
          userName={user.first_name}
          totalXp={gam?.total_xp || 0}
          streak={gam?.current_streak || 0}
          accuracy={accuracy}
        />
      }
      bottomNav={<BottomNav lang={lang} userId={user.id} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
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
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setSearchOpen(true)}
              className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
              aria-label={t("suche_oeffnen", lang)}
            >
              <Search className="w-[18px] h-[18px]" />
            </button>
            <ExamSwitcherInline variant="compact" />
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
            {/* Profile/Settings entry — moved here when Profile left the bottom
               nav (which now carries a symmetric 5 slots). Mirrors the Sidebar
               avatar (viridian, white initial). Keeps Settings reachable on
               mobile, where the Sidebar is hidden below lg. */}
            <Link
              href="/settings"
              aria-label={t("settings", lang)}
              title={t("settings", lang)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-[var(--mp-viridian)] text-white text-xs font-bold ring-2 ring-[var(--mp-accent-teal)]/30 hover:opacity-90 transition-opacity mp-focusable flex-shrink-0"
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
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
            aria-label={t("suche_oeffnen", lang)}
            title="Cmd+K"
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
          <ThemeToggle />
          <LanguageToggle lang={lang} onChange={switchLang} />
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
            // active-exam total = sum of topic counts for the loaded exam.
            // answered = gamification snapshot (questions answered overall).
            const examTotal = topics.reduce((sum, tp) => sum + (tp.count || 0), 0);
            const answeredCount = gam?.total_questions_answered || 0;
            // days-left from users.exam_date (mirrored in localStorage profile).
            const target = profileData?.targetDate;
            const daysLeft =
              target && !isNaN(new Date(target).getTime())
                ? Math.ceil((new Date(target).getTime() - Date.now()) / 86400000)
                : null;
            // resume-or-start: weakest topic first, else first topic, else random.
            const studyHref =
              weakTopics.length > 0
                ? `/quiz?topic=${encodeURIComponent(weakTopics[0]?.topic || "random")}&userId=${user.id}&examSource=${examSource}&autoStart=1`
                : topics.length > 0
                ? `/quiz?topic=${encodeURIComponent(topics[0].topic)}&userId=${user.id}&examSource=${examSource}&autoStart=1`
                : `/quiz?topic=random&userId=${user.id}&examSource=${examSource}`;
            return (
              <div className="mb-5">
                <HomeHero
                  greeting={getGreeting(lang)}
                  userName={user.first_name}
                  examLabel={getExamLabel(examSource, lang)}
                  answered={answeredCount}
                  total={examTotal}
                  studyHref={studyHref}
                  planHref="/study-plan"
                  lang={lang}
                  daysLeft={daysLeft}
                />
                <div className="mt-4">
                  <HomeStatStrip
                    streak={gam?.current_streak || 0}
                    dailyCurrent={gam?.daily_questions_today || 0}
                    dailyGoal={user.daily_goal || 20}
                    accuracy={accuracy}
                    lang={lang}
                  />
                </div>
              </div>
            );
          })()}

          {/* ─── RESUME SESSION CARD (if any) — "Weitermachen" ──────────── */}
          {!user.id.startsWith("guest_") && (
            <div className="mt-6">
              <h2 className="mp-h3 mb-3" style={{ color: "var(--mp-fg)" }}>
                {lang === "de" ? "Weitermachen" : "Continue"}
              </h2>
              <ResumeSessionCard userId={user.id} lang={lang} />
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

          {/* ─── COACH SUGGESTION (calm viridian, replaces yellow warning)
             Rendered only when we have weak-topic signal. Content uses the
             lightbulb icon + viridian accent — feels helpful, not alarming.
             CTA is "Practice 10 questions" (concrete), not "Fix now" (scary).
           */}
          {weakTopics.length > 0 && (() => {
            const wt = weakTopics[0];
            const acc = Math.min(Math.round(wt.accuracy), 100);
            const href = `/quiz?topic=${encodeURIComponent(wt.topic)}&userId=${user.id}&examSource=${examSource}&practiceMode=wrong&limit=10&autoStart=1`;
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
                      {lang === "de"
                        ? `${acc}% Genauigkeit · 10 gezielte Fragen können dich sichtbar voranbringen.`
                        : `${acc}% accuracy · 10 focused questions can move the needle.`}
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
            lang={lang}
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
                  ({topics.length})
                </span>
              </h2>
              <Link
                href="/curriculum"
                className="inline-flex items-center gap-0.5 text-xs font-semibold mp-focusable"
                style={{ color: "var(--mp-cta-blue)" }}
              >
                {lang === "de" ? "Alle ansehen" : "View all"}
                <ChevronRight className="w-3.5 h-3.5" aria-hidden />
              </Link>
            </div>

            {examSource === "kenntnispruefung" ? (
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
                        lang={lang}
                        delay={i * 50}
                        examSource={examSource}
                        accuracy={topicProgress[tp.topic]?.accuracy}
                        answered={topicProgress[tp.topic]?.answered}
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
                        lang={lang}
                        delay={i * 50}
                        examSource={examSource}
                        accuracy={topicProgress[tp.topic]?.accuracy}
                        answered={topicProgress[tp.topic]?.answered}
                      />
                    ))}
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4 stagger">
                {topics.map((tp, i) => (
                  <TopicCard
                    key={tp.topic}
                    topic={tp.topic}
                    count={tp.count}
                    userId={user.id}
                    lang={lang}
                    delay={i * 50}
                    examSource={examSource}
                    accuracy={weakTopics.find(w => w.topic === tp.topic)?.accuracy}
                    answered={weakTopics.find(w => w.topic === tp.topic)?.total}
                  />
                ))}
              </div>
            )}
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
function DemoHome({
  topics,
  lang,
  examSource,
  onLangChange,
  onChangeExam,
}: {
  topics: TopicCount[];
  lang: Lang;
  examSource: ExamSourceId;
  onLangChange: (l: Lang) => void;
  onChangeExam: () => void;
}) {
  const totalQuestions = topics.reduce((sum, tp) => sum + tp.count, 0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const handleDemoSearch = useCallback(
    async (query: string) => {
      setSearchQuery(query);
      if (!query) { setSearchResults([]); return; }
      setSearchLoading(true);
      try {
        const params = new URLSearchParams({ search: query, examSource, limit: "20" });
        const res = await fetch(`/api/questions?${params}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch { setSearchResults([]); }
      finally { setSearchLoading(false); }
    },
    [examSource]
  );

  // Widget-based Telegram login was removed Apr 10 (only bot deep-
  // link remains). Dead code removed 2026-04-15.

  const handleGuestContinue = () => {
    const guestId = `guest_${Date.now()}`;
    const session = {
      user: {
        id: guestId,
        telegram_id: 0,
        first_name: lang === "de" ? "Gast" : "Guest",
        xp_total: 0,
        streak_count: 0,
        daily_goal: 20,
      },
      gamification: {
        total_xp: 0,
        current_streak: 0,
        total_questions_answered: 0,
        total_correct: 0,
        daily_questions_today: 0,
      },
    };
    storeSession(session);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom">
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--mp-viridian)]/[0.03] to-transparent pointer-events-none" />
        <div className="relative px-4 pt-8 pb-6 text-center max-w-2xl mx-auto">
          <div className="flex justify-end mb-6 gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={onLangChange} />
          </div>

          <div className="w-16 h-16 rounded border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            <img src="/brand/logomark.svg" alt="MedPrüf" className="w-12 h-12" />
          </div>
          <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-10 mx-auto" />
          <p className="text-[var(--mp-fg-muted)] text-base mb-1">{t("exam_prep", lang)}</p>
          <p className="text-[var(--mp-fg-subtle)] text-sm">{t("demo_description", lang)}</p>

          {/* Stats bar */}
          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--mp-viridian)] font-mono">
                {totalQuestions > 0 ? totalQuestions.toLocaleString("de-DE") : "7.042"}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">{t("questions", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[var(--mp-border)]" />
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--mp-status-warning)] font-mono">{topics.length || "10"}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">{t("topics", lang)}</p>
            </div>
            <div className="w-px h-8 bg-[var(--mp-border)]" />
            {/* Exam badge — clickable to change */}
            <button onClick={onChangeExam} className="text-center group">
              <p className="text-lg font-bold text-[var(--mp-status-warning)] font-mono group-hover:text-[#FFD080] transition-colors">
                {examSource}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-fg-muted)] transition-colors">
                {lang === "de" ? "Prüfung" : "Exam"}
              </p>
            </button>
          </div>

          {/* Primary CTA */}
          <div className="mt-6">
            <Link
              href={`/quiz?topic=random&examSource=${examSource}`}
              className="btn-primary inline-flex items-center gap-3 px-7 py-3.5 text-base shadow-md hover:shadow-lg transition-shadow active:scale-[0.98]"
            >
              <Shuffle className="w-5 h-5" />
              {lang === "de" ? "Übung starten" : "Start Practice"}
            </Link>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-6 pb-6 max-w-4xl mx-auto">
        <SearchBar lang={lang} onSearch={handleDemoSearch} />
        {searchQuery && (
          <SearchResults
            results={searchResults as unknown as Parameters<typeof SearchResults>[0]["results"]}
            query={searchQuery}
            loading={searchLoading}
            lang={lang}
            examSource={examSource}
          />
        )}
      </div>

      {/* Topics — hidden while searching */}
      {topics.length > 0 && !searchQuery && (
        <div className="px-6 pb-10 max-w-4xl mx-auto">
          <h2 className="text-lg font-bold mb-4 text-[var(--mp-fg)] border-l-[3px] border-l-[var(--mp-viridian)] pl-3">{t("practice_topics", lang)}</h2>

          {examSource === "kenntnispruefung" ? (
            <>
              {/* SIP quick-start buttons */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <Link
                  href={`/exam?examSource=kenntnispruefung&part=sip4`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-status-warning)]" />
                  <span className="truncate">{t("practice_sip4", lang)}</span>
                </Link>
                <Link
                  href={`/exam?examSource=kenntnispruefung&part=sip5`}
                  className="btn-secondary flex items-center gap-2 rounded-xl px-4 py-3 text-sm transition-all hover:shadow-md"
                >
                  <ClipboardList className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)]" />
                  <span className="truncate">{t("practice_sip5", lang)}</span>
                </Link>
              </div>

              {/* SIP 4 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-status-warning)] mb-3 border-l-[3px] border-l-[var(--mp-status-warning)] pl-3">
                {t("sip4_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-10 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>

              {/* SIP 5 group */}
              <h3 className="text-sm font-bold uppercase tracking-wider text-[var(--mp-viridian)] mb-3 border-l-[3px] border-l-[var(--mp-viridian)] pl-3">
                {t("sip5_label", lang)}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger">
                {topics.filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic)).map((tp, i) => {
                  const config = getTopicConfig(tp.topic);
                  return (
                    <Link
                      key={tp.topic}
                      href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                      className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                      <div className="text-[15px] font-semibold leading-snug mb-1 text-[var(--mp-fg)] line-clamp-2 min-h-[2.5rem]" title={tp.topic}>{tp.topic}</div>
                      <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count.toLocaleString("de-DE")} {t("questions", lang)}</div>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 stagger">
              {topics.map((tp, i) => {
                const config = getTopicConfig(tp.topic);
                return (
                  <Link
                    key={tp.topic}
                    href={`/quiz?topic=${encodeURIComponent(tp.topic)}&examSource=${examSource}`}
                    className="card-interactive rounded-2xl p-6 active:scale-[0.98] group"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <TopicIcon name={config.icon} className="w-7 h-7 mb-3 transition-transform duration-200 group-hover:scale-110" style={{ color: config.color }} />
                    <div className="text-sm font-semibold mb-1 text-[var(--mp-fg)]">{tp.topic}</div>
                    <div className="text-xs text-[var(--mp-fg-subtle)] font-mono">{tp.count} {t("questions", lang)}</div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Login + Guest prompt */}
      <div className="px-4 pb-10 max-w-4xl mx-auto">
        <div className="card p-5">
          <div className="text-center mb-4">
            <img src="/brand/wordmark-twotone.png" alt="MedPrüf" className="h-8 mx-auto" />
          </div>
          <p className="text-sm text-[var(--mp-fg-muted)] font-medium mb-1 text-center">
            {lang === "de"
              ? "Fortschritt speichern & Statistiken verfolgen"
              : "Save progress & track your stats"}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mb-5 text-center">
            {lang === "de"
              ? "Melde dich mit Telegram an oder fahre als Gast fort"
              : "Sign in with Telegram or continue as guest"}
          </p>

          <div className="flex flex-col sm:flex-row gap-3">
            {/* Telegram login — lang-suffixed so bot replies in the user's UI language (F10 fix) */}
            <a
              href={`https://t.me/MedPruefBot?start=web_login_${lang}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[var(--mp-fg)] px-5 py-3 rounded font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest continue */}
            <button
              onClick={handleGuestContinue}
              className="flex-1 flex items-center justify-center gap-2 bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] hover:border-[var(--mp-viridian)]/40 text-[var(--mp-fg-muted)] px-5 py-3 rounded font-medium text-sm transition-all active:scale-[0.98]"
            >
              <User className="w-4 h-4 flex-shrink-0" />
              {lang === "de" ? "Als Gast fortfahren" : "Continue as guest"}
            </button>
          </div>

          <p className="text-center text-[10px] text-[var(--mp-fg-subtle)]/60 mt-3">
            {lang === "de"
              ? "Gastmodus speichert Fortschritt lokal – kein Konto nötig"
              : "Guest mode saves progress locally — no account needed"}
          </p>
        </div>
      </div>
    </div>
  );
}
