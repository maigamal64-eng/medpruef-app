"use client";

/**
 * Offline pack card (LX-16, ACC-50, LX-14) on Settings > Offline lernen.
 *
 * The learner picks the whole bank or one subject of the active exam, sees
 * the question count and an approximate size before downloading, optionally
 * includes images, and downloads in chunks of 100 with progress, Cancel and
 * Resume. The whole bank is for paying plans: when the summary says
 * wholeBank false the card starts on the subject choice, disables the bank
 * option and links /pricing (the server refuses the download too). Each
 * failure names its cause. Below: the storage-protection answer
 * the browser gave (navigator.storage.persist, asked after the first stored
 * chunk) and what to do when data is missing. Copy: src/lib/i18n-offline.ts.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { CloudDownload, Database, Trash2, X } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { countQuestions, getLastSync } from "@/lib/offlineDb";
import {
  clearOfflinePack,
  downloadPack,
  ensureOfflineOwner,
  fetchPackSummary,
  readPackCursor,
  type PackFailure,
  type PackProgress,
  type PackScope,
  type PackSummary,
} from "@/lib/offline-pack";
import {
  OFFLINE_MAX_IMAGES_PER_PACK,
  estimatePackImageBytes,
  formatMegabytes,
} from "@/lib/offline-pack-rules";
import { OFFLINE_PERSIST_KEY, type OfflinePersistenceResult } from "@/lib/offline-persist";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { safeStorage } from "@/lib/safe-storage";
import { syncStamp, to, type OfflineKey } from "@/lib/i18n-offline";
import { trackEvent } from "@/lib/tracker";
import { Dialog, DialogFooter } from "@/components/ui";

interface Props {
  lang: string;
  examType: string;
  /** Signed-in account id; null for guests (the card explains sign-in instead). */
  userId: string | null;
  /** Called after a download or clear so the page can refresh its own counts. */
  onChanged?: () => void;
}

const FAILURE_KEY: Record<Exclude<PackFailure, "aborted">, OfflineKey> = {
  offline: "err_offline",
  auth: "err_auth",
  plan: "err_plan",
  quota: "err_quota",
  rate: "err_rate",
  server: "err_server",
};

function readPersistence(): OfflinePersistenceResult["status"] | null {
  try {
    const raw = safeStorage.getItem(OFFLINE_PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OfflinePersistenceResult>;
    return parsed.status === "granted" || parsed.status === "denied" || parsed.status === "unsupported" || parsed.status === "error"
      ? parsed.status
      : null;
  } catch {
    return null;
  }
}

export default function OfflinePackCard({ lang, examType, userId, onChanged }: Props) {
  const radioName = useId();
  const topicId = useId();
  const imagesId = useId();
  const [kind, setKind] = useState<"bank" | "topic">("bank");
  const [topic, setTopic] = useState<string>("");
  const [bankSummary, setBankSummary] = useState<PackSummary | "loading" | PackFailure>("loading");
  const [scopeSummary, setScopeSummary] = useState<PackSummary | "loading" | PackFailure | null>(null);
  const [includeImages, setIncludeImages] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(null);
  const [stored, setStored] = useState<number | null>(null);
  /** Across every exam: "Offline-Daten löschen" clears all of them. */
  const [storedAll, setStoredAll] = useState<number>(0);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [persist, setPersist] = useState<OfflinePersistenceResult["status"] | null>(null);
  const [resumable, setResumable] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const scope: PackScope = { examType, topic: kind === "topic" && topic ? topic : null };
  /** False only when the server said the whole bank needs a paid plan. */
  const bankOpen = !(typeof bankSummary === "object" && bankSummary.wholeBank === false);
  const scopeReady = kind === "bank" ? bankOpen : !!topic;
  const noPaymentPro = typeof bankSummary === "object" && bankSummary.wholeBankReason === "no_payment";
  const examLabel = getExamLabel(examType, "full", lang);

  const refreshLocal = useCallback(async () => {
    setStored(await countQuestions(examType).catch(() => null));
    setStoredAll(await countQuestions().catch(() => 0));
    setLastSync(getLastSync(examType));
    setPersist(readPersistence());
  }, [examType]);

  useEffect(() => {
    void (async () => {
      // Content downloaded by another account on this device is cleared first.
      if (userId) await ensureOfflineOwner(userId).catch(() => false);
      await refreshLocal();
    })();
  }, [userId, refreshLocal]);

  // Bank summary (count, images, topic list) for the active exam.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setBankSummary("loading");
    setTopic("");
    setKind("bank");
    fetchPackSummary(authFetch, { examType, topic: null }).then((s) => {
      if (cancelled) return;
      setBankSummary(s);
      // The server decides who may take the whole bank (paying plans only);
      // everyone else starts on the subject choice.
      if (typeof s === "object" && s.wholeBank === false) setKind("topic");
    });
    return () => { cancelled = true; };
  }, [examType, userId]);

  // Topic summary when a subject is chosen.
  useEffect(() => {
    if (!userId || kind !== "topic" || !topic) { setScopeSummary(null); return; }
    let cancelled = false;
    setScopeSummary("loading");
    fetchPackSummary(authFetch, { examType, topic }).then((s) => { if (!cancelled) setScopeSummary(s); });
    return () => { cancelled = true; };
  }, [examType, kind, topic, userId]);

  const summary = kind === "bank" ? bankSummary : scopeSummary;
  const summaryData = summary && typeof summary === "object" ? summary : null;

  // Topic packs include images by default; the whole bank does not (size).
  useEffect(() => { setIncludeImages(kind === "topic"); }, [kind]);
  // Leaving the page stops a running download (Resume continues it later).
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    setResumable(scopeReady && readPackCursor({ examType, topic: kind === "topic" && topic ? topic : null }) !== null);
  }, [examType, kind, topic, scopeReady, running]);

  const start = async (resume: boolean) => {
    if (!userId || !scopeReady || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setMessage(null);
    // A resumed pack counts only what this run stores, so it shows no bar.
    const total = resume ? null : summaryData?.total ?? null;
    setProgress({ stored: 0, total, textBytes: 0, imagesCached: 0, imageBytes: 0 });
    trackEvent("offline_download_started", { size: scope.topic ? "topic" : "bank", exam: examType });
    // Images only when the learner saw their size (summary loaded, images present).
    const withImages = includeImages && !!summaryData && summaryData.images > 0;
    let result: Awaited<ReturnType<typeof downloadPack>> | null = null;
    try {
      result = await downloadPack({
        fetchFn: authFetch,
        scope,
        userId,
        includeImages: withImages,
        total,
        resume,
        signal: controller.signal,
        onProgress: setProgress,
      });
    } catch {
      result = null;
    } finally {
      abortRef.current = null;
      setRunning(false);
    }
    await refreshLocal().catch(() => undefined);
    onChanged?.();
    if (!result) {
      setMessage({ tone: "error", text: to("err_server", lang) });
      return;
    }
    if (result.ok) {
      if (result.progress.stored === 0) {
        setMessage({ tone: "info", text: to("empty_pack", lang) });
        return;
      }
      const mb = formatMegabytes(result.progress.textBytes + result.progress.imageBytes, lang);
      const missed = result.imagesFailed + result.imagesSkipped;
      const text = to("done", lang, { n: result.progress.stored, mb })
        + (result.progress.imagesCached > 0 ? ` ${to("done_images", lang, { n: result.progress.imagesCached })}` : "")
        + (withImages && missed > 0 ? ` ${to("images_missed", lang, { n: missed })}` : "");
      setMessage({ tone: "ok", text });
      return;
    }
    const text = result.reason === "aborted" ? to("aborted", lang) : to(FAILURE_KEY[result.reason], lang);
    setMessage({ tone: result.reason === "aborted" ? "info" : "error", text });
  };

  const clear = async () => {
    try {
      await clearOfflinePack();
      setClearOpen(false);
      setMessage(null);
      setProgress(null);
      await refreshLocal();
      onChanged?.();
    } catch {
      setClearOpen(false);
      setMessage({ tone: "error", text: to("err_server", lang) });
    }
  };

  const lastSyncText = syncStamp(lastSync, lang);
  const persistKey: OfflineKey = persist === "granted" ? "persist_granted"
    : persist === "denied" ? "persist_denied"
    : persist === null ? "persist_pending"
    : "persist_unknown";
  const imageCount = summaryData?.images ?? 0;

  return (
    <div className="bg-[var(--mp-surface)] border border-[var(--mp-border-soft)] rounded-[var(--mp-r-card)] shadow-[var(--mp-shadow-card)] p-[18px]" data-testid="offline-pack-card">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-[34px] h-[34px] rounded-[9px] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] flex items-center justify-center flex-shrink-0"><CloudDownload className="w-[18px] h-[18px]" aria-hidden /></div>
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-[var(--mp-fg)]">{to("title", lang, { exam: examLabel })}</h3>
          <p className="text-[13px] text-[var(--mp-fg-muted)] mt-1">{to("intro", lang)}</p>
        </div>
      </div>

      {/* Stored count and last sync for this exam */}
      <div className="flex items-center gap-3 p-4 rounded-[var(--mp-r-input)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] mb-4">
        <Database className="w-5 h-5 text-[var(--mp-fg-muted)] flex-shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-base font-bold text-[var(--mp-fg)]" data-testid="offline-stored">
            {stored === null ? "--" : to("stored", lang, { n: stored })}
          </p>
          <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
            {lastSyncText ? to("last_sync", lang, { date: lastSyncText }) : to("never_synced", lang)}
          </p>
        </div>
      </div>

      {userId && (
        <>
          <fieldset className="mb-3" disabled={running}>
            <legend className="text-sm font-semibold text-[var(--mp-fg)] mb-2">{to("scope_label", lang)}</legend>
            <div className="flex flex-col gap-2">
              {(["bank", "topic"] as const).map((value) => (
                <label key={value} className={`flex items-center gap-2 min-h-11 text-sm ${value === "bank" && !bankOpen ? "text-[var(--mp-fg-subtle)] cursor-not-allowed" : "text-[var(--mp-fg)] cursor-pointer"}`}>
                  <input
                    type="radio"
                    name={radioName}
                    value={value}
                    checked={kind === value}
                    disabled={value === "bank" && !bankOpen}
                    onChange={() => setKind(value)}
                    className="h-4 w-4 accent-[var(--mp-viridian)]"
                  />
                  {value === "bank" ? to("scope_bank", lang) : to("scope_topic", lang)}
                </label>
              ))}
            </div>
            {!bankOpen && (
              <p className="text-xs text-[var(--mp-fg-muted)] mt-1" data-testid="offline-bank-paid-only">
                {noPaymentPro ? (
                  // Pro without a payment (referral reward, comped): checkout
                  // would refuse an account with access, so no plans link.
                  to("bank_paid_only_access", lang)
                ) : (
                  <>
                    {to("bank_paid_only", lang)}{" "}
                    <Link href="/pricing" prefetch={false} className="underline text-[var(--mp-fg)]">{to("bank_paid_link", lang)}</Link>
                  </>
                )}
              </p>
            )}
            {kind === "topic" && (
              <div className="mt-2">
                <label htmlFor={topicId} className="block text-xs font-semibold text-[var(--mp-fg-muted)] mb-1">{to("topic_label", lang)}</label>
                <select
                  id={topicId}
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  className="mp-field w-full min-h-11"
                >
                  <option value="">{to("topic_placeholder", lang)}</option>
                  {(typeof bankSummary === "object" ? bankSummary.topics : []).map((row) => (
                    <option key={row.topic} value={row.topic}>{row.topic}</option>
                  ))}
                </select>
              </div>
            )}
          </fieldset>

          {scopeReady && (
            <p className="text-sm text-[var(--mp-fg-muted)] mb-2" aria-live="polite" data-testid="offline-summary">
              {summary === "loading"
                ? to("summary_loading", lang)
                : summaryData
                  ? to("summary", lang, { n: summaryData.total, mb: formatMegabytes(summaryData.estimatedTextBytes, lang) })
                  : to("summary_failed", lang)}
            </p>
          )}
          {summaryData?.limited && <p className="text-xs text-[var(--mp-fg-muted)] mb-2">{to("limited", lang)}</p>}

          {scopeReady && imageCount > 0 && (
            <div className="mb-3">
              <label htmlFor={imagesId} className="flex items-start gap-2 min-h-11 text-sm text-[var(--mp-fg)] cursor-pointer">
                <input
                  id={imagesId}
                  type="checkbox"
                  checked={includeImages}
                  disabled={running}
                  onChange={(event) => setIncludeImages(event.target.checked)}
                  className="mt-1 h-4 w-4 accent-[var(--mp-viridian)]"
                />
                <span>{to("images_toggle", lang, { n: imageCount, mb: formatMegabytes(estimatePackImageBytes(imageCount), lang) })}</span>
              </label>
              <p className="text-xs text-[var(--mp-fg-subtle)] ms-6">{to("images_note", lang, { max: OFFLINE_MAX_IMAGES_PER_PACK })}</p>
            </div>
          )}

          {running && progress && (
            <div className="mb-3" data-testid="offline-progress">
              <p className="text-sm text-[var(--mp-fg)] mb-1">
                {progress.total ? to("progress", lang, { done: progress.stored, total: progress.total }) : to("progress_open", lang, { done: progress.stored })}
              </p>
              {progress.total ? (
                <progress
                  className="w-full h-2"
                  max={progress.total}
                  value={Math.min(progress.stored, progress.total)}
                  aria-label={to("downloading", lang)}
                />
              ) : null}
            </div>
          )}

          {message && (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              className={`text-sm mb-3 ${message.tone === "error" ? "text-[var(--mp-error-text)]" : "text-[var(--mp-fg)]"}`}
              data-testid="offline-message"
            >
              {message.text}
            </p>
          )}

          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
            {running ? (
              <button type="button" className="mp-btn mp-btn--secondary w-full sm:w-auto min-h-11" onClick={() => abortRef.current?.abort()}>
                <X className="w-4 h-4" aria-hidden />
                {to("cancel", lang)}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="mp-btn mp-btn--primary w-full sm:w-auto min-h-11"
                  onClick={() => void start(false)}
                  aria-disabled={!scopeReady || undefined}
                  disabled={!scopeReady}
                >
                  <CloudDownload className="w-4 h-4" aria-hidden />
                  {to("download", lang)}
                </button>
                {resumable && (
                  <button type="button" className="mp-btn mp-btn--secondary w-full sm:w-auto min-h-11" onClick={() => void start(true)}>
                    {to("resume", lang)}
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={() => setClearOpen(true)}
              disabled={running || storedAll === 0}
              className="mp-btn mp-btn--ghost w-full sm:w-auto min-h-11 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-4 h-4" aria-hidden />
              {to("clear", lang)}
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--mp-border-soft)] text-sm" data-testid="offline-persist">
            <p className="text-[var(--mp-fg)]">
              <span className="font-semibold">{to("persist_label", lang)}:</span> {to(persistKey, lang)}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[var(--mp-fg-muted)] min-h-11 inline-flex items-center">{to("missing_title", lang)}</summary>
              <p className="mt-1 text-[var(--mp-fg-muted)]">{to("missing_body", lang)}</p>
            </details>
          </div>
        </>
      )}

      <Dialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={to("clear_title", lang)}
        description={to("clear_body", lang)}
        kind="confirm"
        footer={
          <DialogFooter>
            <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary min-h-11" onClick={() => setClearOpen(false)}>
              {to("cancel", lang)}
            </button>
            <button type="button" className="mp-btn mp-btn--destructive min-h-11" onClick={() => void clear()}>
              <Trash2 className="w-4 h-4" aria-hidden />
              {to("clear_confirm", lang)}
            </button>
          </DialogFooter>
        }
      />
    </div>
  );
}
