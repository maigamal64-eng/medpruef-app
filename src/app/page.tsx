"use client";
import PendingPaymentBanner from "@/components/PendingPaymentBanner";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { buildQuizHref } from "@/lib/quiz-links";

import { loadHomeTopics, miniAppAuthFailure, type HomeTopic } from "@/lib/home-topics-request";
import { Alert, Button } from "@/components/ui";
import { startTopicProgressRequest, type TopicProgressRow } from "@/lib/topic-progress-request";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BrandedLoader, LogoWordmark } from "@/components/Logo";
import { authFetch as fetch } from "@/lib/authFetch";
import { DataRegion } from "@/components/ui/DataRegion";
import { trackEvent } from "@/lib/tracker";
import { DataResponseError, checkedJson, createRequestSequence } from "@/lib/async-data";
import { completeAuthEntry } from "@/lib/auth-entry-completion";
import { readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import { t, getUiLang, useLang, renderLang, type Lang } from "@/lib/i18n";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { CheckCircle, ChevronRight, Search, Target, ArrowRight } from "lucide-react";
import { isTelegramMiniApp, getMiniAppInitData, getStoredSession, getSessionToken, storeSession, setSessionToken, clearSession } from "@/lib/auth";
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
import { OPEN_MORE_EVENT } from "@/components/nav/MoreSheet";
import { AppLayout } from "@/components/ui";
import TopicCard from "@/components/TopicCard";
import HomeHero, { type HeroReadiness, type HeroAction } from "@/components/HomeHero";
import HomeStatStrip from "@/components/HomeStatStrip";
import HomeJourney from "@/components/journey/HomeJourney";
import HomeCramCard from "@/components/HomeCramCard";
import CodeEntry from "@/components/code-entry/CodeEntry";
import ReverseTrialBanner from "@/components/ReverseTrialBanner";
import EmailConfirmLine from "@/components/email-confirm/EmailConfirmLine";
import { MentorEntryLink } from "@/components/mentor/entries/MentorEntryLink";
import { entryT } from "@/components/mentor/entries/entry-copy";
import HomeDueRow from "@/components/HomeDueRow";
import HomeOnboardingSync from "@/components/HomeOnboardingSync";
import EmailValidationModal from "@/components/EmailValidationModal";
import HomeIosInstallCard from "@/components/HomeIosInstallCard";
import OfflinePackEntry from "@/components/OfflinePackEntry";
import { HomeOtherModes, HomeSimulationEntry, type PracticeSlot } from "@/components/HomePracticeRow";
import TelegramActivationCard from "@/components/TelegramActivationCard";
import TrialAnnouncementCard from "@/components/TrialAnnouncementCard";
import TrialClaimCard from "@/components/TrialClaimCard";
import TrialEndHomeCard from "@/components/trial-end/TrialEndHomeCard";
import ReferralHomeCard from "@/components/referrals/ReferralHomeCard";
import HomeWinbackNote from "@/components/HomeWinbackNote";
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
import CheckoutResumeCard from "@/components/CheckoutResumeCard";
import RenewalRecoveryCard from "@/components/RenewalRecoveryCard";
import UserSurveyModal from "@/components/UserSurveyModal";
import ResumeSessionCard, { type LastSession } from "@/components/ResumeSessionCard";
import { useToast } from "@/components/ui";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { weakTopicHref, resolveNextStep } from "@/lib/next-step";
import { topicStatus, type TopicStatus } from "@/lib/learning-metrics";
import { canUse } from "@/lib/entitlements";
import { useHomeStudy } from "@/lib/hooks/useHomeStudy";
import { asExamSourceId } from "@/lib/active-exam";
import { EXAM_CHANGED_EVENT, announceServerExam, type ExamChangedDetail } from "@/lib/exam-switch";
import { announce } from "@/lib/announce";
import { trackHomeCta, type HomeCtaSlot } from "@/lib/home-events";
import { isReadinessResponse } from "@/components/ReadinessSignal";
import { FREE_TIER } from "@/lib/content-truth";
import { exchangeTelegramToken } from "@/lib/telegram-token-exchange";
import { captureAttributionFromUrl, getStoredAttribution } from "@/lib/attribution";
import { initDataTelegramId } from "@/lib/tg-welcome";
import { isHomeNextStepEnabled, examFormatHref, rankTopicsForPhone, PHONE_TOPIC_COUNT } from "@/lib/home-layout";
import { readHomeTopicsCache, writeHomeTopicsCache } from "@/lib/home-topics-cache";
import { isHomeLastGoodEnabled, lastGoodTime, readLastGoodProgress, readLastGoodReadiness, writeLastGoodProgress, writeLastGoodReadiness } from "@/lib/home-last-good";
import type { StudySnapshot } from "@/lib/home-study-core";
import { useActivation } from "@/lib/activation/useActivation";
import { translatedLine } from "@/lib/activation/copy";
import ActivationHomeCard from "@/components/activation/ActivationHomeCard";

interface User {
  id: string;
  telegram_id?: number;
  first_name: string;
  last_name?: string;
  xp_total: number;
  streak_count: number;
  daily_goal: number;
  email?: string | null;
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

/** Time-of-day-aware greeting. */
function getGreeting(lang: Lang): string {
  const h = new Date().getHours();
  if (h < 12) return t("home_good_morning", lang);
  if (h < 18) return t("home_good_afternoon", lang);
  return t("home_good_evening", lang);
}

/** Phones (< 640 px) get the compact topic list (pick-ux-home-28 B). */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setPhone(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return phone;
}

type TopicProgressMap = Record<string, { answered: number; correct: number; wrong: number; accuracy: number; lastCorrectPct: number | null; status: TopicStatus; openMistakes: number | null; freeLeft?: number }>;

export default function Home() {
  const router = useRouter();
  const { referralsEnabled, audience } = useUserTier();
  // a-activation-48h: the first-48-hours step (no request while the flag is off).
  const activation = useActivation({ fresh: true });

  const [user, setUser] = useState<User | null>(null);
  const [topicsError, setTopicsError] = useState(false);
  const [topicsLoading, setTopicsLoading] = useState(true);
  const [topicsExam, setTopicsExam] = useState<ExamSourceId | null>(null);
  const [topics, setTopics] = useState<HomeTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const topicRequest = useRef(createRequestSequence());
  const uiLang = useLang();
  const lang = renderLang(uiLang);
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const examSourceRef = useRef(examSource);
  examSourceRef.current = examSource;
  const [showExamSelector, setShowExamSelector] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [weakTopics, setWeakTopics] = useState<TopicStats[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileData, setProfileData] = useState<{ targetDate?: string } | null>(null);
  const [readiness, setReadiness] = useState<HeroReadiness>({ state: "loading" });
  const [lastSession, setLastSession] = useState<LastSession | null>(null);
  const [stallVisible, setStallVisible] = useState(false);
  const [resumeVisible, setResumeVisible] = useState(false);
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const isPhone = useIsPhone();
  const serverExamApplied = useRef(false);

  // Telegram deep link (?tg_token=). Initialised synchronously so the
  // signed-out branch never wins before the exchange claims the token.
  // FB-08: auto-exchange only where the session sticks (installed PWA or a
  // desktop browser); a phone outside the app gets the hand-off screen.
  const [processingTgToken, setProcessingTgToken] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const hasToken = new URLSearchParams(window.location.search).has("tg_token");
      if (!hasToken) return false;
      return isStandalonePWA() || !isTouchFirstDevice();
    } catch {
      return false;
    }
  });
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
  const [handoffBusy, setHandoffBusy] = useState(false);
  // UX-ONB-22: a network failure keeps the token and offers a retry; it is never called expired.
  const [tgNetworkError, setTgNetworkError] = useState(false);
  const exchangeInFlight = useRef(false);
  const [showCohortConfetti, setShowCohortConfetti] = useState(false);
  const toast = useToast();

  // Juni-26-Kohorte post-checkout greeting (/?welcome=cohort or the legacy founder alias).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const welcome = url.searchParams.get("welcome");
    if (welcome !== "cohort" && welcome !== "founder") return;
    const timer = setTimeout(() => {
      const lng = getUiLang();
      toast.success(
        t("home_welcome_to_the_exam_cohort", lng),
        t("home_your_full_access_is_active_for_6_months_with_pass_until_you_pass_good_", lng)
      );
      setShowCohortConfetti(true);
      url.searchParams.delete("welcome");
      window.history.replaceState({}, "", url.pathname + url.search);
      setTimeout(() => setShowCohortConfetti(false), 3000);
    }, 200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    setExamSource(getStoredExamSource());
  }, []);

  /**
   * One Telegram exchange at a time (UX-ONB-22). ok: store the session and
   * continue. rejected: scrub the token and open /login with the code field
   * and a persistent explanation. network: keep the token, offer a retry, and
   * retry once more when the browser comes back online.
   */
  const runTelegramExchange = useCallback(async (token: string, mode: "auto" | "handoff") => {
    if (exchangeInFlight.current) return;
    exchangeInFlight.current = true;
    setTgNetworkError(false);
    if (mode === "handoff") setHandoffBusy(true); else setProcessingTgToken(true);
    try {
      const result = await exchangeTelegramToken(token, fetch);
      const url = new URL(window.location.href);
      if (result.kind === "ok") {
        const data = result.data as { user: User; gamification: unknown; sessionToken: string };
        storeSession({ user: data.user, gamification: data.gamification } as Parameters<typeof storeSession>[0]);
        setSessionToken(data.sessionToken);
        url.searchParams.delete("tg_token");
        window.history.replaceState({}, "", url.toString());
        window.location.replace(await completeAuthEntry(new URLSearchParams(window.location.search)));
        return;
      }
      if (result.kind === "rejected") {
        trackEvent("tg_token_failed", { reason: result.reason });
        url.searchParams.delete("tg_token");
        window.history.replaceState({}, "", url.toString());
        // A used token on a device that already holds a session just goes home.
        if (getStoredSession()?.user?.id) { window.location.replace("/"); return; }
        window.location.replace(buildAuthHref(readAuthEntry(), "telegram_expired"));
        return;
      }
      trackEvent("tg_token_failed", { reason: "network" });
      setTgNetworkError(true);
      setHandoffBusy(false);
      if (mode === "handoff") setHandoffToken(token);
      else { setProcessingTgToken(false); setHandoffToken(token); }
    } finally {
      exchangeInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tgToken = new URL(window.location.href).searchParams.get("tg_token");
    if (!tgToken) return;
    // Hand-off context: keep the token for the learner's choice.
    if (!isStandalonePWA() && isTouchFirstDevice()) return;
    void runTelegramExchange(tgToken, "auto");
  }, [runTelegramExchange]);

  // Retry a kept token when the connection returns.
  useEffect(() => {
    if (!tgNetworkError || !handoffToken) return;
    const onOnline = () => void runTelegramExchange(handoffToken, "handoff");
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [tgNetworkError, handoffToken, runTelegramExchange]);

  const fetchTopics = useCallback(async (src: ExamSourceId, ownerId?: string | null) => {
    const request = topicRequest.current.begin();
    setTopicsLoading(true);
    // UX-HOME-07: paint the last topic list for this account and bank at once.
    const owner = ownerId ?? getStoredSession()?.user?.id ?? null;
    const cached = owner ? readHomeTopicsCache(owner, src) : null;
    if (cached && request.current()) { setTopics(cached); setTopicsExam(src); }
    try {
      const data = await loadHomeTopics(src, fetch, request.signal);
      if (request.current()) {
        setTopics(data); setTopicsExam(src); setTopicsError(false);
        if (owner) writeHomeTopicsCache(owner, src, data);
      }
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
      if (cached?.user) { setUser(cached.user as User); setLoading(false); }
      // Topics must never decide whether the learner has a session.
      void fetchTopics(src, cached?.user?.id).catch(() => setError("data"));

      if (isMiniApp) {
        const initData = getMiniAppInitData();
        // a-first-touch: a Mini App signup keeps the stored campaign too.
        captureAttributionFromUrl();
        const res = await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, attribution: getStoredAttribution() ?? undefined }),
        });
        if (!res.ok) {
          // A Mini App left open past the initData lifetime keeps its signed
          // session (a-tg-miniapp-welcome); a reopen from the chat signs fresh.
          const stale = res.status === 401 && !!cached?.user && !!getSessionToken()
            && Number(cached.user.telegram_id) === initDataTelegramId(initData)
            && ((await res.json().catch(() => null)) as { code?: string } | null)?.code === "INITDATA_STALE";
          if (stale) { setLoading(false); return; }
          if (miniAppAuthFailure(res.status, !!cached?.user) === "auth") { setError("auth"); setUser(null); if (res.status === 401 || res.status === 403) clearSession(); }
          setLoading(false);
          return;
        }
        const data = await res.json();
        setUser(data.user);
        setSessionToken(data.sessionToken);
        // Other pages read the stored session (a-tg-miniapp-welcome), as after a token exchange.
        storeSession({ user: data.user, gamification: data.gamification } as Parameters<typeof storeSession>[0]);
        if (!hasSelectedExam()) {
          setStoredExamSource("kenntnispruefung");
          setExamSource("kenntnispruefung");
        }
      } else {
        const stored = getStoredSession();
        if (stored) {
          setUser(stored.user as User);
          // Onboarding shows only for signed-in learners the server confirms
          // have not completed or skipped it (review-2026-04-26-A2).
          try {
            const onboardingData = safeStorage.getItem("medpruef_onboarding");
            const parsed = onboardingData ? JSON.parse(onboardingData) : null;
            if (!parsed?.completedAt) {
              fetch("/api/user/onboarding-state")
                .then((r) => (r.ok ? r.json() : null))
                .then((s) => {
                  if (s?.completed_at || s?.skipped_at) {
                    try {
                      safeStorage.setItem("medpruef_onboarding", JSON.stringify({ completedAt: s.completed_at ?? s.skipped_at, ...(s.data ?? {}) }));
                    } catch {}
                  } else if (s && s.completed_at === null) {
                    setShowOnboarding(true);
                  }
                })
                .catch(() => setError("data"));
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

  // UX-HOME-09 / UX-HOME-12: the server study snapshot (streak, today, hit rate,
  // active exam, exam date). A server exam that differs from this browser's
  // mirror wins once per load and is announced politely.
  const onSnapshot = useCallback((s: StudySnapshot) => {
    if (s.examDate) setProfileData({ targetDate: s.examDate });
    const serverExam = asExamSourceId(s.activeExam);
    if (serverExam && serverExam !== examSourceRef.current && !serverExamApplied.current) {
      serverExamApplied.current = true;
      setStoredExamSource(serverExam);
      setExamSource(serverExam);
      void fetchTopics(serverExam);
      announceServerExam(serverExam);
      announce(t("a22_exam_set", getUiLang()).replace("{exam}", getExamLabel(serverExam, "full", getUiLang())));
    } else if (serverExam) {
      serverExamApplied.current = true;
    }
  }, [fetchTopics]);
  const study = useHomeStudy(user?.id, onSnapshot);
  const refreshStudy = study.refresh;

  // UX-HOME-12: an exam switch refreshes Home in place (no reload).
  useEffect(() => {
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<ExamChangedDetail>).detail;
      const next = asExamSourceId(detail?.examSource);
      if (!next) return;
      e.preventDefault();
      if (detail?.source === "server") return; // Home applied it itself

      setExamSource(next);
      setShowAllTopics(false);
      void fetchTopics(next);
      refreshStudy(true);
      announce(t("a22_exam_switched", getUiLang()).replace("{exam}", getExamLabel(next, "full", getUiLang())));
    };
    window.addEventListener(EXAM_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(EXAM_CHANGED_EVENT, onChanged);
  }, [fetchTopics, refreshStudy]);

  // Online/offline measurement (UX-HOME-53) and a topic refresh on reconnect.
  useEffect(() => {
    const onOnline = () => { trackEvent("offline_state", { state: "online" }); void fetchTopics(examSourceRef.current); };
    const onOffline = () => trackEvent("offline_state", { state: "offline" });
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, [fetchTopics]);

  // Per-topic server progress for the active exam.
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressAccount, setProgressAccount] = useState<string | null>(null);
  const [progressExam, setProgressExam] = useState<ExamSourceId | null>(null);
  const [topicProgressError, setTopicProgressError] = useState(false);
  const [weakMeasure, setWeakMeasure] = useState<'last_correct' | 'hit_rate'>('last_correct');
  const [topicProgressRetry, setTopicProgressRetry] = useState(0);
  const [topicProgress, setTopicProgress] = useState<TopicProgressMap>({});
  // a-fo-08 (HOME_LAST_GOOD): time of the saved copy shown instead of a failed read.
  const [progressAsOf, setProgressAsOf] = useState<number | null>(null);
  const [readinessAsOf, setReadinessAsOf] = useState<number | null>(null);
  const [readinessRetry, setReadinessRetry] = useState(0);
  useEffect(() => {
    setWeakTopics([]);
    setProgressLoading(true);
    if (!user?.id || user.id.startsWith('guest_')) {
      setWeakTopics(getWeakTopics());
      setProgressLoading(false);
      return;
    }
    const lastGood = isHomeLastGoodEnabled();
    setProgressAsOf(null);
    const apply = (data: TopicProgressRow[]) => {
      const map: TopicProgressMap = {};
      const weak: TopicStats[] = [];
      let coachMeasure: 'last_correct' | 'hit_rate' = 'last_correct';
      for (const tp of data) {
        const status = tp.status ?? topicStatus(tp.answered, tp.lastCorrectPct ?? null);
        map[tp.topic] = { answered: tp.answered, correct: tp.correct, wrong: tp.wrong, accuracy: tp.accuracy, lastCorrectPct: tp.lastCorrectPct ?? null, status, openMistakes: typeof tp.openMistakes === "number" ? tp.openMistakes : null, freeLeft: typeof tp.freeLeft === "number" ? tp.freeLeft : undefined };
        if (status === 'practice_more' && tp.lastCorrectPct != null) weak.push({ topic: tp.topic, correct: tp.correct, total: tp.answered, accuracy: tp.lastCorrectPct });
        else if (tp.lastCorrectPct == null && topicStatus(tp.answered, tp.accuracy) === 'practice_more') { weak.push({ topic: tp.topic, correct: tp.correct, total: tp.answered, accuracy: tp.accuracy }); coachMeasure = 'hit_rate'; }
      }
      setTopicProgressError(false);
      setTopicProgress(map);
      setProgressExam(examSource);
      setProgressAccount(user.id);
      setProgressLoading(false);
      setWeakTopics(weak.sort((a, b) => a.accuracy - b.accuracy || b.total - a.total));
      setWeakMeasure(coachMeasure);
    };
    const request = startTopicProgressRequest(examSource, fetch, data => {
      apply(data);
      setProgressAsOf(null);
      if (lastGood) writeLastGoodProgress(user.id, examSource, data);
    }, () => {
      const saved = lastGood ? readLastGoodProgress(user.id, examSource) : null;
      // A saved free allowance may be out of date: the copy never claims one.
      if (saved) { apply(saved.rows.map((row) => ({ ...row, freeLeft: undefined }))); setProgressAsOf(saved.at); return; }
      setTopicProgressError(true); setProgressLoading(false);
    });
    return request.cancel;
  }, [user?.id, examSource, topicProgressRetry]);

  // UX-HOME-59: returning to Home (Back from a quiz, tab switch) refreshes the
  // topic progress at most once a minute; cached values stay on screen.
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      setTopicProgressRetry((n) => n + 1);
    };
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { last = 0; refresh(); } };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("pageshow", onPageShow);
    return () => { document.removeEventListener("visibilitychange", refresh); window.removeEventListener("pageshow", onPageShow); };
  }, []);

  // UX-HOME-18 B: banded readiness for the headline, after first paint, never blocking it.
  const phase = study.snapshot?.phase ?? null;
  useEffect(() => {
    if (!user?.id || user.id.startsWith("guest_") || phase === "new") return;
    const controller = new AbortController();
    const userId = user.id;
    const lastGood = isHomeLastGoodEnabled();
    setReadiness({ state: "loading" });
    setReadinessAsOf(null);
    fetch("/api/user/readiness", { signal: controller.signal, timeoutMs: 8_000 })
      .then((r) => checkedJson(r, isReadinessResponse))
      .then((d) => {
        if (controller.signal.aborted) return;
        setReadiness({ state: "ready", band: d.band, trend: d.trend, lowestFactor: d.lowestFactor });
        if (lastGood) writeLastGoodReadiness(userId, examSource, { band: d.band, trend: d.trend, lowestFactor: d.lowestFactor });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        const saved = lastGood ? readLastGoodReadiness(userId, examSource) : null;
        if (saved) { setReadiness({ state: "ready", ...saved.value }); setReadinessAsOf(saved.at); return; }
        setReadiness({ state: "unavailable" });
      });
    return () => controller.abort();
  }, [user?.id, examSource, phase, readinessRetry]);

  // Fallback exam date from this browser until the server snapshot answers.
  useEffect(() => {
    try {
      const profileRaw = safeStorage.getItem("medpruef_profile");
      const onbRaw = safeStorage.getItem("medpruef_onboarding");
      const profileDate = profileRaw ? JSON.parse(profileRaw)?.targetDate : undefined;
      const onbDate = onbRaw ? JSON.parse(onbRaw)?.examDate : undefined;
      const targetDate = profileDate || onbDate;
      if (targetDate) setProfileData((prev) => prev ?? { targetDate });
    } catch {}
  }, []);

  // Post-auth sync for the public Find-Your-Path flow (one-shot per browser).
  useEffect(() => {
    if (!user?.id || user.id.startsWith("guest_")) return;
    try {
      if (safeStorage.getItem("medpruef_fyp_synced") === "1") return;
      const onbRaw = safeStorage.getItem("medpruef_onboarding");
      const onb = onbRaw ? JSON.parse(onbRaw) : null;
      const fypExam: string | undefined = onb?.examSource;
      if (!fypExam) return;
      const serverActiveExam = (user as { active_exam?: string | null }).active_exam;
      if (serverActiveExam) {
        safeStorage.setItem("medpruef_fyp_synced", "1");
        return;
      }
      const isISODate = typeof onb?.examDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(onb.examDate);
      const body: Record<string, string | number> = { activeExam: fypExam };
      if (onb?.dailyGoal && onb.dailyGoal > 0) body.dailyGoal = onb.dailyGoal;
      if (isISODate) body.examDate = onb.examDate;
      fetch("/api/user/exam-preference", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
      fetch("/api/user/onboarding-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examSource: fypExam, examDate: onb?.examDate, dailyGoal: onb?.dailyGoal }),
      }).catch(() => {});
      safeStorage.setItem("medpruef_fyp_synced", "1");
    } catch {
      /* never block the home render on a best-effort sync */
    }
  }, [user]);

  // Cmd/Ctrl+K and "/" open search (UX-HOME-51); "/" is ignored while typing.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); return; }
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !document.querySelector("[role=dialog]")) {
        e.preventDefault();
        setSearchOpen(true);
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

  const track = useCallback((slot: HomeCtaSlot, kind?: string) => trackHomeCta(slot, { exam: examSourceRef.current, kind }), []);
  // a-activation-48h: the starter set on the hero, counted once per browser session.
  const starterOnHero = activation?.stage === "starter" && Boolean(activation.starter);
  useEffect(() => {
    if (!starterOnHero) return;
    try {
      if (safeSessionStorage.getItem("medpruef_activation_starter_shown")) return;
      safeSessionStorage.setItem("medpruef_activation_starter_shown", "1");
    } catch { /* count it anyway */ }
    trackEvent("activation_step", { step: "starter_shown", exam: activation?.segment ?? "unknown", lang: uiLang });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [starterOnHero]);
  const onPracticeSlot = useCallback((slot: PracticeSlot) => track(slot), [track]);
  const onStallVisible = useCallback((v: boolean) => setStallVisible(v), []);
  const onResumeVisible = useCallback((v: boolean) => setResumeVisible(v), []);
  const onRecoveryVisible = useCallback((v: boolean) => setRecoveryVisible(v), []);

  const progressReady = !!user && progressExam === examSource && progressAccount === user.id;
  const openMistakesTotal = useMemo(() => {
    if (!progressReady) return null;
    const values = Object.values(topicProgress).map((p) => p.openMistakes);
    if (values.length === 0 || values.some((v) => v === null)) return null;
    return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  }, [progressReady, topicProgress]);

  if (loading && !showExamSelector) {
    return (
      <div className="flex items-center justify-center min-h-dvh bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  if (showOnboarding) {
    return <Onboarding lang={lang} userId={user?.id ?? null} onComplete={async (data) => {
      setShowOnboarding(false);
      setStoredExamSource(data.examSource as ExamSourceId);
      setExamSource(data.examSource as ExamSourceId);
      // Finish at the first useful action: the account exam is already saved
      // when it was chosen (UX-ONB-25); the quiz practises that exam.
      router.push(buildQuizHref({ topic: "random", examSource: data.examSource, practiceMode: "unseen" }));
    }} />;
  }

  if (showExamSelector) {
    return <ExamSelector lang={lang} onSelect={handleExamSelected} />;
  }

  // FB-08 / UX-ONB-21: a phone opened the login link outside the installed app.
  if (handoffToken && !user) {
    return (
      <TelegramCodeHandoff
        code={handoffToken}
        lang={uiLang}
        continuing={handoffBusy}
        networkError={tgNetworkError}
        onContinueInBrowser={() => void runTelegramExchange(handoffToken, "handoff")}
      />
    );
  }

  if (processingTgToken) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-[var(--mp-surface-sunken)] gap-4" role="status">
        <BrandedLoader size="lg" />
        <p className="text-sm text-[var(--mp-fg-muted)]">{t("home_signing_in", lang)}</p>
      </div>
    );
  }

  if (!user) {
    return <main className="min-h-dvh bg-[var(--mp-surface-sunken)] px-4 py-12">
      <PartialTranslationNote />
      <DataRegion error={!!error} retry={() => void authenticate()} />
      <Link className="mp-btn mp-btn--primary min-h-11" href={buildAuthHref({ intent: 'free', exam: examSource })}>{t("home_sign_in", lang)}</Link>
    </main>;
  }

  const snap = study.snapshot;
  const trackingAvailable = !user.id.startsWith('guest_');
  // a-fo-08: the older of the saved copies on screen (progress, readiness).
  const lastGoodAt = progressAsOf !== null && readinessAsOf !== null ? Math.min(progressAsOf, readinessAsOf) : progressAsOf ?? readinessAsOf;
  const examTotal = topicsExam === examSource ? topics.reduce((sum, tp) => sum + tp.count, 0) : null;
  const answeredCount = trackingAvailable && progressReady
    ? Object.values(topicProgress).reduce((sum, tp) => sum + tp.answered, 0)
    : null;
  const target = profileData?.targetDate;
  const daysLeft = target && !isNaN(new Date(target).getTime()) ? Math.ceil((new Date(target).getTime() - Date.now()) / 86400000) : null;
  const isNew = trackingAvailable && phase === "new";
  const dailyGoal = snap?.dailyGoal ?? (user.daily_goal || 20);

  // Hero primary (UX-HOME-15 phase A behind NEXT_PUBLIC_HOME_NEXT_STEP, default off).
  let primary: HeroAction;
  let primaryKind = "new_questions";
  if (isNew && activation?.stage === "starter" && activation.starter && activation.exam === examSource) {
    // a-activation-48h: the first ten are the starter set (curated opening first, then
    // questions with a cached translation in the reading language, across subjects).
    primary = {
      href: activation.starter.href,
      label: t("a22_new_cta", uiLang),
      why: translatedLine(activation.starter.translated ?? 0, activation.starter.lang, uiLang),
    };
    primaryKind = "starter";
  } else if (isNew) {
    primary = { href: buildQuizHref({ examSource, practiceMode: "unseen", limit: 10 }), label: t("a22_new_cta", uiLang) };
    primaryKind = "first_ten";
  } else if (phase === "lapsed") {
    primary = {
      href: lastSession?.topic ? buildQuizHref({ examSource, topic: lastSession.topic, limit: 10 }) : buildQuizHref({ examSource, practiceMode: "unseen", limit: 10 }),
      label: t("a22_lapsed_cta", uiLang),
      why: lastSession?.topic ? t("a22_lapsed_why", uiLang).replace("{topic}", lastSession.topic) : null,
    };
    primaryKind = "warm_up";
  } else if (isHomeNextStepEnabled()) {
    const step = resolveNextStep({
      audience, exam: examSource, now: new Date(), dailyGoal, answeredToday: study.staleDay ? null : snap?.answersToday ?? null,
      lastSession: lastSession ? { topic: lastSession.topic, lastActiveAt: lastSession.lastActiveAt } : null,
      topics: progressReady ? Object.entries(topicProgress).map(([topic, p]) => ({ topic, answeredDistinct: p.answered, lastCorrectPct: p.lastCorrectPct })) : null,
    });
    primary = { href: step.kind === "goal_done" && step.more ? step.more.href : step.href, label: step.kind === "goal_done" && step.more ? step.more.label[lang] : step.label[lang], why: step.why[lang] };
    primaryKind = step.kind;
  } else {
    primary = { href: buildQuizHref({ topic: "random", examSource, practiceMode: "unseen" }), label: t("a22_study_new", uiLang) };
  }
  const secondary: HeroAction = { href: "/study-plan", label: t("home_study_plan", uiLang) };

  // Fachgebiete: the compact phone list shows the weakest five first (pick-ux-home-28 B).
  const progressFor = (topic: string) => progressReady ? topicProgress[topic] : undefined;
  const proMistakes = canUse("mistake_review", audience);
  const renderTopic = (tp: HomeTopic, i: number) => {
    const p = progressFor(tp.topic);
    return (
      <TopicCard
        key={tp.topic}
        topic={tp.topic}
        count={tp.count}
        lang={uiLang}
        delay={i * 50}
        examSource={examSource}
        lastCorrectPct={p?.lastCorrectPct ?? undefined}
        status={p?.status}
        answered={p?.answered}
        openMistakes={p?.openMistakes ?? null}
        showMistakes={proMistakes}
        freeLeft={proMistakes ? undefined : p?.freeLeft}
        onOpen={() => track("topic")}
      />
    );
  };
  const topicGrid = "grid grid-cols-2 gap-3 sm:gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,150px),1fr))] sm:[grid-template-columns:repeat(auto-fill,minmax(240px,1fr))] mb-8 stagger";
  const compactTopics = isPhone && !showAllTopics && topics.length > PHONE_TOPIC_COUNT;

  return (
    <AppLayout
      sidebar={<Sidebar lang={uiLang} userId={user.id} userName={user.first_name} />}
      bottomNav={<BottomNav lang={uiLang} userId={user.id} />}
    >
      <main tabIndex={-1} className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)] outline-none">
        <PendingPaymentBanner />
        <PartialTranslationNote />

        {/* Phone toolbar (UX-HOME-40): wordmark, search, exam chip, language, account.
            Theme lives in the Mehr sheet that the account button opens. */}
        <div className="lg:hidden px-4 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <Link href="/" aria-label="MedPrüf" className="mr-auto hidden min-[360px]:inline-flex items-center min-h-11 mp-focusable">
              <LogoWordmark className="h-6" />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
                aria-label={t("suche_oeffnen", uiLang)}
              >
                <Search className="w-[18px] h-[18px]" aria-hidden />
              </button>
              <ExamSwitcherInline variant="compact" />
              <LanguagePicker compact />
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_MORE_EVENT))}
                aria-haspopup="dialog"
                aria-label={t("a22_account_menu", uiLang)}
                title={t("a22_account_menu", uiLang)}
                className="w-11 h-11 flex items-center justify-center rounded-full bg-[var(--mp-viridian)] text-[var(--mp-fg-on-viridian)] text-xs font-bold ring-2 ring-[var(--mp-accent-teal)]/30 hover:opacity-90 transition-opacity mp-focusable flex-shrink-0"
              >
                <span aria-hidden>{(user.first_name || "M").charAt(0).toUpperCase()}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Desktop header */}
        <div className="hidden lg:flex px-10 pt-6 pb-2 items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setSearchOpen(!searchOpen)}
            className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-[var(--mp-surface-raised)] text-[var(--mp-fg-subtle)] transition-colors mp-focusable"
            aria-label={t("suche_oeffnen", uiLang)}
            aria-keyshortcuts="Control+K Meta+K /"
          >
            <Search className="w-[18px] h-[18px]" aria-hidden />
          </button>
          <ThemeToggle />
          <LanguagePicker />
        </div>

        <div className="px-4 sm:px-6 lg:px-10 pb-8 pt-2 lg:pt-4 mx-auto w-full max-w-[1200px]">
          <HomeOnboardingSync userId={user.id} lang={uiLang} />
          <TelegramActivationCard />

          <div className="mb-5">
            <HomeHero
              greeting={getGreeting(uiLang)}
              userName={user.first_name}
              examLabel={getExamLabel(examSource, "full", lang)}
              answered={answeredCount}
              total={examTotal}
              trackingAvailable={trackingAvailable}
              progressLoading={progressLoading || topicsLoading}
              progressError={topicProgressError || topicsError}
              onProgressRetry={() => { setTopicProgressRetry(n => n + 1); if (isHomeLastGoodEnabled()) setReadinessRetry(n => n + 1); void fetchTopics(examSource); }}
              readiness={readiness}
              asOf={lastGoodAt === null ? null : lastGoodTime(lastGoodAt, lang)}
              phase={trackingAvailable ? phase : null}
              daysSinceStudy={snap?.daysSinceStudy ?? null}
              primary={primary}
              secondary={secondary}
              primaryOutline={stallVisible || resumeVisible || recoveryVisible}
              freeAllowance={isNew && !canUse("full_bank", audience) ? t("a22_free_allowance", uiLang).replace("{n}", String(FREE_TIER.questions_per_exam_type)) : null}
              formatHref={isNew ? examFormatHref(examSource) : null}
              lang={uiLang}
              daysLeft={daysLeft}
              onPrimaryClick={() => {
                track("hero_study", primaryKind);
                if (primaryKind === "starter") trackEvent("activation_step", { step: "starter_started", exam: activation?.segment ?? "unknown", lang: uiLang });
              }}
              onSecondaryClick={() => track("hero_plan")}
            />
            <HomeJourney className="mt-3" userId={user.id} lang={uiLang} canMock={canUse("mock_exam", audience)} />
            <HomeCramCard
              userId={user.id}
              lang={uiLang}
              bank={snap?.activeExam ?? null}
              examDate={snap?.examDate ?? null}
              canMock={canUse("mock_exam", audience)}
              onSittingSet={() => refreshStudy(true)}
              className="mt-3"
            />
            <CodeEntry surface="home" className="mt-1" />
            <ReverseTrialBanner className="mt-3" />
            <EmailConfirmLine userId={user.id} lang={lang} className="mt-3" />
            <TrialEndHomeCard userId={user.id} lang={uiLang} className="mt-3" />
            <ActivationHomeCard view={activation} lang={uiLang} examSource={examSource} className="mt-3" />
            <MentorEntryLink surface="home_deadline" from="exam_dates" mode="facts" draft={entryT("deadline_draft", uiLang)} label={entryT("deadline", uiLang)} className="mt-1" />

            {/* UX-HOME-44: a stalled checkout's recovery sits above the strip and owns the filled primary. */}
            {!user.id.startsWith("guest_") && (
              <div className="mt-4 empty:hidden">
                <RenewalRecoveryCard onVisibleChange={onRecoveryVisible} />
                <CheckoutResumeCard onVisibleChange={onResumeVisible} />
                <CheckoutStallPrompt onVisibleChange={onStallVisible} />
              </div>
            )}

            {!isNew && (
              <div className="mt-4">
                <HomeStatStrip
                  streak={snap ? snap.streak : null}
                  activeDays7={snap ? snap.activeDays7 : null}
                  answersToday={snap && !study.staleDay ? snap.answersToday : null}
                  dailyGoal={dailyGoal}
                  hitRate={snap ? snap.hitRate : null}
                  todayHref={primary.href}
                  lang={uiLang}
                  onTileClick={(tile) => track(tile === "today" ? "stat_today" : "stat_accuracy")}
                />
              </div>
            )}

            {!isNew && trackingAvailable && (
              <div className="mt-4">
                <HomeDueRow examSource={examSource} lang={uiLang} entitled={canUse("spaced_repetition", audience)} onStart={() => track("due_review")} />
              </div>
            )}

            {!isNew && <HomeOtherModes examSource={examSource} audience={audience} openMistakes={openMistakesTotal} lang={uiLang} onSlot={onPracticeSlot} />}
          </div>

          {/* Single inline card slot below the strip (UX-HOME-42/70, UX-ONB-37). */}
          <EmailValidationModal />
          <HomeIosInstallCard lang={uiLang} totalAnswered={snap ? snap.totalAnswered : null} />
          <TrialAnnouncementCard userId={user.id} lang={uiLang} className="mb-6" />
          <TrialClaimCard userId={user.id} className="mb-6" />
          <ReferralHomeCard userId={user.id} lang={uiLang} className="mb-6" />
          <HomeWinbackNote userId={user.id} lang={uiLang} className="mb-6" />

          {/* "Weitermachen": the heading exists only together with the card (UX-HOME-20). */}
          {!user.id.startsWith("guest_") && (
            <ResumeSessionCard userId={user.id} lang={uiLang} heading={t("home_continue", uiLang)} onResolved={setLastSession} onOpen={() => track("resume")} />
          )}

          {!user.id.startsWith("guest_") && referralsEnabled && (
            <ReferralCodeCard userId={user.id} lang={lang} />
          )}

          {/* Fokus-Empfehlung (UX-HOME-24): the whole card is one named link with a visible action. */}
          {!isNew && weakTopics.length > 0 && (() => {
            const wt = weakTopics[0];
            const acc = Math.min(Math.round(wt.accuracy), 100);
            const href = weakTopicHref(wt.topic, examSource, audience);
            const action = t("coach_practice_10", uiLang);
            return (<>
              <Link
                href={href}
                onClick={() => track("coach")}
                className="mp-suggestion mp-suggestion--interactive mp-focusable mb-8 group block min-h-12"
                aria-label={`${t("coach_weak_topic_title", uiLang)}: ${wt.topic}. ${action}`}
                data-testid="home-focus-card"
              >
                <div className="flex items-start gap-4">
                  <div className="mp-suggestion__icon" aria-hidden>
                    <Target className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-bold text-[var(--mp-viridian)] mb-1">
                      {t("coach_weak_topic_title", uiLang)}
                    </p>
                    <p className="mp-ui font-bold text-[var(--mp-fg)] mb-1" lang="de" dir="ltr" style={{ overflowWrap: "anywhere" }}>
                      {wt.topic}
                    </p>
                    <p className="mp-small text-[var(--mp-fg-muted)]">
                      {t(weakMeasure === 'hit_rate' ? "a12_coach_body_hit_rate" : "home_coach_body", uiLang).replace("{n}", String(acc))}
                    </p>
                    <span className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] group-hover:translate-x-0.5 transition-transform">
                      {action}
                      <ArrowRight className="w-4 h-4 rtl:rotate-180" aria-hidden />
                    </span>
                  </div>
                </div>
              </Link>
              <MentorEntryLink surface="home_plan" from="home" mode="study" draft={entryT("home_plan_draft", uiLang, { topic: wt.topic })} label={entryT("home_plan", uiLang)} className="-mt-6 mb-8" />
            </>);
          })()}

          <SearchModal
            open={searchOpen}
            onClose={() => setSearchOpen(false)}
            lang={uiLang}
            examSource={examSource}
            userId={user.id}
          />

          {/* Fachgebiete (UX-HOME-28 B, UX-HOME-32): one section header style, real headings,
              neutral part labels (colour never carries the SIP part). */}
          <section aria-labelledby="home-topics-title" className="mb-8 mt-8">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 id="home-topics-title" className="mp-h3" style={{ color: "var(--mp-fg)" }}>
                {t("specialties", uiLang)}{" "}
                <span className="text-sm font-normal text-[var(--mp-fg-subtle)]">
                  ({topicsExam !== examSource ? "…" : topics.length})
                </span>
              </h2>
              <Link href="/curriculum" className="inline-flex min-h-11 items-center gap-0.5 text-[13px] font-semibold mp-focusable" style={{ color: "var(--mp-cta-blue)" }}>
                {t("home_view_all", uiLang)}
                <ChevronRight className="w-3.5 h-3.5 rtl:rotate-180" aria-hidden />
              </Link>
            </div>

            {topicsError && <Alert variant="info" title={t("home_topics_error", uiLang)} className="mb-4">
              {/* Issue 5 (2026-10-12): a failed topic list never dead-ends Home; the mixed start needs no topic list. */}
              <p>{t("home_topics_error_start", uiLang)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={buildQuizHref({ topic: "random", examSource, practiceMode: "unseen" })} data-testid="home-topics-error-start" className="mp-btn mp-btn--secondary min-h-11 mp-focusable" onClick={() => track("topics_error_start")}>{t("home_topics_error_start_cta", uiLang)}</Link>
                <Button variant="secondary" className="min-h-11" aria-disabled={topicsLoading} aria-busy={topicsLoading} onClick={() => { if (!topicsLoading) void fetchTopics(examSource); }}>{t("request_retry", uiLang)}</Button>
              </div>
            </Alert>}
            {topicsLoading && topicsExam !== examSource && <DataRegion loading retry={() => void fetchTopics(examSource)} />}
            {topicsExam === examSource && (compactTopics ? (
              <>
                <p className="mb-3 text-[13px] text-[var(--mp-fg-muted)]">{t("a22_topics_weakest_first", uiLang)}</p>
                <div className={topicGrid}>
                  {rankTopicsForPhone(topics, (topic) => progressFor(topic) ?? null).slice(0, PHONE_TOPIC_COUNT).map(renderTopic)}
                </div>
                <button type="button" onClick={() => setShowAllTopics(true)} className="mp-btn mp-btn--secondary w-full min-h-11 -mt-4 mb-2" aria-controls="home-topics-title">
                  {t("a22_topics_show_all", uiLang).replace("{n}", String(topics.length))}
                </button>
              </>
            ) : examSource === "kenntnispruefung" ? (
              <>
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--mp-fg-muted)]">
                  {t("sip4_label", uiLang)}
                  <span aria-hidden className="h-px flex-1 bg-[var(--mp-border)]" />
                </h3>
                <div className={topicGrid}>
                  {topics.filter((tp) => VIENNA_EXAM_PARTS.sip4.includes(tp.topic)).map(renderTopic)}
                </div>
                <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[var(--mp-fg-muted)]">
                  {t("sip5_label", uiLang)}
                  <span aria-hidden className="h-px flex-1 bg-[var(--mp-border)]" />
                </h3>
                <div className={topicGrid}>
                  {topics.filter((tp) => VIENNA_EXAM_PARTS.sip5.includes(tp.topic)).map(renderTopic)}
                </div>
              </>
            ) : (
              <div className={topicGrid}>{topics.map(renderTopic)}</div>
            ))}
          </section>

          {/* Timed mocks below the topics (UX-HOME-29): never promoted into the hero. */}
          {!isNew && <HomeSimulationEntry examSource={examSource} audience={audience} lang={uiLang} onSlot={onPracticeSlot} />}

          {/* LX-16: one tap to the offline pack, with what this device holds. */}
          {!isNew && <div className="mt-4"><OfflinePackEntry lang={uiLang} examType={examSource} userId={user?.id ?? null} /></div>}

          <Link
            href="/progress"
            className="mt-6 mp-card rounded-2xl p-4 flex items-center justify-between cursor-pointer mp-focusable hover:border-[var(--mp-viridian)]/35 transition-colors group"
          >
            <span className="text-sm font-semibold text-[var(--mp-viridian)]">{t("view_full_progress", uiLang)}</span>
            <ChevronRight className="w-5 h-5 text-[var(--mp-fg-subtle)] group-hover:text-[var(--mp-viridian)] group-hover:translate-x-0.5 transition-all rtl:rotate-180" aria-hidden />
          </Link>
        </div>
      </main>

      <WhatsNewModal />
      <OrientationModal />
      <UserSurveyModal />
      <ReferralShareFloater />
      {showCohortConfetti && <CohortWelcomeCheck />}
    </AppLayout>
  );
}

/**
 * Cohort welcome check: a single viridian checkmark scales in, holds briefly,
 * fades out. Respects prefers-reduced-motion via `.mp-welcome-check`.
 */
function CohortWelcomeCheck() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[95] flex items-center justify-center" aria-hidden>
      <div
        className="mp-welcome-check flex items-center justify-center rounded-full"
        style={{ width: 96, height: 96, background: "var(--mp-viridian)", boxShadow: "var(--mp-shadow-elev), 0 0 0 12px rgba(0, 123, 95, 0.15)" }}
      >
        <CheckCircle className="w-12 h-12 text-white" strokeWidth={2.5} aria-hidden />
      </div>
    </div>
  );
}
