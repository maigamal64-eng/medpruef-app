"use client";

/**
 * /tg-welcome (a-tg-miniapp-welcome): the page an exam button of the bot
 * welcome opens as a Telegram Mini App.
 *
 *  1. Sign in through the existing initData path of /api/auth (no token in
 *     the URL, no new auth path). Outside Telegram the page only links to
 *     the normal sign-in.
 *  2. The bank from the button is saved, then the official sitting is asked
 *     first (ExamSittingPicker: official sittings only, no custom date, both
 *     Stichprobentest publishers, "noch offen"). The choice is saved through the in-app picker
 *     path (PATCH /api/user/exam-preference, source tg_welcome).
 *  3. The activation starter set (while ACTIVATION_48H_ENABLED is on) and the
 *     reverse-trial line (only while a trial runs) follow.
 * Copy: src/lib/tg-welcome (Lektor gate). German in Sie, no em dashes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { getSessionToken, getStoredSession, setSessionToken, storeSession } from "@/lib/auth";
import { captureAttributionFromUrl, getStoredAttribution } from "@/lib/attribution";
import { setStoredExamSource, type ExamSourceId } from "@/lib/topics";
import { OFFICIAL_KEYS_BY_BANK, getUpcomingOfficialFor, groupOfficialByDate, type PuypExamType } from "@/lib/exam-dates";
import { initTracker, trackEvent } from "@/lib/tracker";
import { safeSessionStorage } from "@/lib/safe-storage";
import { markTelegramWebApp } from "@/lib/checkout-context-client";
import { t } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { useActivation } from "@/lib/activation/useActivation";
import { activationSegment } from "@/lib/activation/rules";
import { translatedLine } from "@/lib/activation/copy";
import { getExamLabel, type ExamLabelKey } from "@/lib/master-locale/exam-label";
import { TG_WELCOME_SOURCE, initDataTelegramId, tw, type TgWelcomeLang } from "@/lib/tg-welcome";
import ExamSittingPicker from "@/components/ExamSittingPicker";
import ReverseTrialBanner from "@/components/ReverseTrialBanner";
import { AppLayout } from "@/components/ui";

type Phase = "auth" | "no_telegram" | "auth_failed" | "sitting" | "start";

type TelegramWebApp = { initData?: string; ready?: () => void; expand?: () => void };

/** How long to wait for the Telegram SDK before treating the page as outside Telegram. */
const SDK_WAIT_MS = 4_000;
const NEW_ACCOUNT_MS = 10 * 60 * 1000;

function webApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp ?? null;
}

/** Only an upcoming official sitting of the bank is preselected (the picker offers no custom date here). */
function isUpcomingSitting(bank: ExamSourceId, date: string): boolean {
  const key = (Object.keys(OFFICIAL_KEYS_BY_BANK) as PuypExamType[]).find((k) => k === bank);
  if (!key) return false;
  return groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[key] })).some((g) => g.date === date);
}

/**
 * Telegram puts the signed initData into the launch URL's fragment; the SDK
 * (telegram.org) only reads it from there. Reading it directly means a slow
 * SDK download never strands the learner (the server verifies it either way).
 */
function initDataFromHash(): string {
  if (typeof window === "undefined" || !window.location.hash.includes("tgWebAppData")) return "";
  try {
    return new URLSearchParams(window.location.hash.slice(1)).get("tgWebAppData") ?? "";
  } catch {
    return "";
  }
}

function waitForInitData(): Promise<string> {
  const now = webApp()?.initData || initDataFromHash();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      window.removeEventListener("medpruef:telegram-ready", onReady);
      clearTimeout(timer);
      resolve(webApp()?.initData || initDataFromHash());
    };
    const onReady = () => done();
    const timer = setTimeout(done, SDK_WAIT_MS);
    window.addEventListener("medpruef:telegram-ready", onReady);
  });
}

export default function TgWelcomeClient({ exam, lang }: { exam: ExamLabelKey | null; lang: TgWelcomeLang }) {
  const [phase, setPhase] = useState<Phase>("auth");
  const [bank, setBank] = useState<ExamSourceId>(exam ?? "kenntnispruefung");
  const [value, setValue] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saved, setSaved] = useState<"date" | "later" | null>(null);
  const started = useRef(false);
  const saveInFlight = useRef(false);
  const hadDate = useRef(false);
  const { refresh } = useUserTier();

  const signIn = useCallback(async () => {
    setPhase("auth");
    const tg = webApp();
    try { tg?.ready?.(); tg?.expand?.(); } catch { /* older clients */ }
    const initData = await waitForInitData();
    if (!initData) { setPhase("no_telegram"); return; }
    // a-tg-checkout-context: this tab is a Mini App (checkout context and the openLink hand-off).
    markTelegramWebApp();
    try {
      webApp()?.ready?.();
      captureAttributionFromUrl();
      const res = await authFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, attribution: getStoredAttribution() ?? undefined, firstTouch: "tg_welcome" }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      const data = (await res.json().catch(() => null)) as
        | { user?: { id: string; created_at?: string | null; active_exam?: string | null }; gamification?: unknown; sessionToken?: string; code?: string }
        | null;
      let userId: string | null = null;
      let account: "new" | "existing" = "existing";
      let serverBank: string | null = null;
      if (res.ok && data?.user?.id && data.sessionToken) {
        setSessionToken(data.sessionToken);
        storeSession({ user: data.user, gamification: data.gamification } as Parameters<typeof storeSession>[0]);
        userId = data.user.id;
        serverBank = data.user.active_exam ?? null;
        const created = data.user.created_at ? Date.parse(data.user.created_at) : NaN;
        if (Number.isFinite(created) && Date.now() - created < NEW_ACCOUNT_MS) account = "new";
      } else if (res.status === 401 && data?.code === "INITDATA_STALE" && getSessionToken()) {
        // A Mini App reopened from an old view keeps its signed session, only
        // when that session belongs to this Telegram user (two accounts on one phone).
        const stored = getStoredSession()?.user;
        const tgId = initDataTelegramId(initData);
        if (stored?.id && tgId !== null && Number(stored.telegram_id) === tgId) {
          userId = stored.id;
          serverBank = stored.active_exam ?? null;
        }
      }
      if (!userId) { setPhase("auth_failed"); return; }
      // The signed initData has done its job; keep it out of the address (and error reports).
      if (window.location.hash.includes("tgWebAppData")) {
        try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* keep it */ }
      }
      initTracker(userId);
      refresh();
      const chosen = (exam ?? (serverBank as ExamSourceId | null) ?? "kenntnispruefung") as ExamSourceId;
      setBank(chosen);
      // The bank from the button is saved with the learner's Continue, never on
      // open: a URL exam does not silently replace an account's bank (a03).
      trackEvent("tg_welcome_open", { exam: chosen, lang, account });
      // A saved date of the same bank is preselected (a reopened welcome is one tap).
      try {
        const pref = await authFetch("/api/user/exam-preference", { timeoutMs: 8_000, skipAuthRedirect: true });
        const body = pref.ok ? ((await pref.json()) as { activeExam?: string; examDate?: string | null }) : null;
        hadDate.current = body ? Boolean(body.examDate) : true;
        if (body?.examDate && (!exam || body.activeExam === exam) && isUpcomingSitting(chosen, body.examDate)) setValue(body.examDate);
      } catch {
        // Unknown state: "noch offen" must not clear a date we could not read.
        hadDate.current = true;
      }
      setPhase("sitting");
    } catch {
      setPhase("auth_failed");
    }
  }, [exam, lang, refresh]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void signIn();
  }, [signIn]);

  const save = async () => {
    if (value === null || saveInFlight.current) return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      const res = await authFetch("/api/user/exam-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // "Noch offen" never clears a date the account already has.
        body: JSON.stringify(value || !hadDate.current
          ? { activeExam: bank, examDate: value || null, source: TG_WELCOME_SOURCE }
          : { activeExam: bank }),
        timeoutMs: 15_000,
        skipAuthRedirect: true,
      });
      if (!res.ok) throw new Error("not saved");
      setStoredExamSource(bank);
      if (value) {
        // Exam and date are known, so Home and the first round do not ask again. Best effort.
        void authFetch("/api/user/onboarding-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ examSource: bank, examDate: value }),
          skipAuthRedirect: true,
        }).catch(() => undefined);
      }
      setSaved(value ? "date" : "later");
      setPhase("start");
    } catch {
      setSaveFailed(true);
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <AppLayout mode="focus">
      <main id="main" className="main-content mx-auto w-full max-w-xl px-4 py-6" lang={lang} data-tg-welcome={phase}>
        {phase === "auth" && (
          <p role="status" className="text-sm text-[var(--mp-fg-muted)]">{tw("signing_in", lang)}</p>
        )}

        {phase === "no_telegram" && (
          <div className="mp-card p-4 space-y-3">
            <p className="m-0 text-sm text-[var(--mp-fg)]">{tw("not_in_telegram", lang)}</p>
            <Link
              href={`/login?${new URLSearchParams({ mode: "register", next: "/", intent: "free", ...(exam ? { exam } : {}) })}`}
              className="mp-btn mp-btn--primary min-h-11"
            >
              {tw("not_in_telegram_button", lang)}
            </Link>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11 ml-2" onClick={() => void signIn()}>
              {tw("retry", lang)}
            </button>
          </div>
        )}

        {phase === "auth_failed" && (
          <div className="mp-card p-4 space-y-3" role="alert">
            <p className="m-0 text-sm text-[var(--mp-fg)]">{tw("sign_in_failed", lang)}</p>
            <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => void signIn()}>
              {tw("retry", lang)}
            </button>
          </div>
        )}

        {phase === "sitting" && (
          <section aria-labelledby="tg-welcome-sitting" className="space-y-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--mp-fg-muted)]">{getExamLabel(bank, "full", lang)}</p>
              <h1 id="tg-welcome-sitting" className="font-display text-xl font-bold text-[var(--mp-fg)] mt-1">{tw("sitting_title", lang)}</h1>
              <p id="tg-welcome-sitting-body" className="text-sm text-[var(--mp-fg-muted)] mt-1">{tw("sitting_body", lang)}</p>
            </div>
            <ExamSittingPicker examType={bank} value={value} onChange={setValue} lang={lang} density="modal" describedBy="tg-welcome-sitting-body" allowCustom={false} />
            {/* Sticky so the choice is saved without scrolling past every sitting (Mini App viewport). */}
            <div className="sticky bottom-0 -mx-4 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-[var(--mp-bg)] border-t border-[var(--mp-border)]">
              {saveFailed && <p role="alert" className="mb-2 text-sm text-[var(--mp-error-text)]">{tw("save_failed", lang)}</p>}
              <button
                type="button"
                className="mp-btn mp-btn--primary min-h-11 w-full"
                aria-disabled={value === null || saving}
                aria-busy={saving}
                onClick={() => void save()}
              >
                {saving ? tw("saving", lang) : tw("continue", lang)}
              </button>
            </div>
          </section>
        )}

        {phase === "start" && <StartStep bank={bank} lang={lang} saved={saved} />}
      </main>
    </AppLayout>
  );
}

function StartStep({ bank, lang, saved }: { bank: ExamSourceId; lang: TgWelcomeLang; saved: "date" | "later" | null }) {
  const activation = useActivation({ fresh: true });
  const starter = activation?.stage === "starter" && activation.starter ? activation.starter : null;
  const href = starter?.href ?? `/quiz?${new URLSearchParams({ examSource: bank })}`;
  const segment = activation?.segment ?? activationSegment(null, bank);
  const line = starter ? translatedLine(starter.translated ?? 0, starter.lang, lang) : null;

  useEffect(() => {
    if (!starter) return;
    try {
      if (safeSessionStorage.getItem("medpruef_activation_starter_shown")) return;
      safeSessionStorage.setItem("medpruef_activation_starter_shown", "1");
    } catch { /* count it anyway */ }
    trackEvent("activation_step", { step: "starter_shown", exam: segment, lang });
  }, [starter, segment, lang]);

  return (
    <section aria-labelledby="tg-welcome-start" className="space-y-4">
      <p id="tg-welcome-start" role="status" className="flex items-start gap-2 text-base font-semibold text-[var(--mp-fg)]">
        <CalendarCheck className="w-5 h-5 mt-0.5 flex-shrink-0 text-[var(--mp-viridian)]" aria-hidden />
        {saved === "date" ? tw("saved_title", lang) : tw("later_title", lang)}
      </p>
      <Link
        href={href}
        className="mp-btn mp-btn--primary min-h-11 w-full"
        onClick={() => { if (starter) trackEvent("activation_step", { step: "starter_started", exam: segment, lang }); }}
      >
        {t("a22_new_title", lang)}
      </Link>
      {line && <p className="text-xs text-[var(--mp-fg-muted)]">{line}</p>}
      <ReverseTrialBanner />
      <Link href="/" className="mp-btn mp-btn--secondary min-h-11 w-full">{tw("home", lang)}</Link>
    </section>
  );
}
