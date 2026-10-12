"use client";

/**
 * /dashboard/exam-result: the learner records the result of the REAL exam
 * (Pass-Until-You-Pass). Not the simulation result.
 *
 * a24 (UX-EXM-44/46/47/48/55):
 *   - Title is the task, "Wie lief Ihre echte Prüfung?", with the programme
 *     name as a small neutral eyebrow chip; standard AppLayout shell.
 *   - Bestanden: confirm step, then POST /api/puyp/result (one pass per
 *     account and exam; a repeat returns the first record).
 *   - Nicht bestanden (pick-ux-exm-46 A): never a dead button. A learner whose
 *     Prüfungs-Kohorte guarantee can still pay out uploads proof through
 *     POST /api/puyp/submit (admin review queue). Everyone else records the
 *     fail without proof via POST /api/puyp/result result='fail'; that writes
 *     a user_events row, never an exam_attempts row, so it stays out of the
 *     admin queue. Outcomes are internal calibration, never a pass rate.
 *   - A status load failure shows an error with "Erneut laden", never the
 *     no-guarantee branch.
 *   - Proof upload on phones: photo prepared on selection, 120 s timeout,
 *     indeterminate progress, file and form kept after any failure, retry
 *     with the same client action UUID.
 *   - After a fail: one calm line and one link to the Lernplan.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PASS_RECEIPT_KEY, passReceiptFromResponse } from "@/lib/study-p0";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { t, useLang } from "@/lib/i18n";
import { tp, type PuypKey } from "@/lib/i18n-puyp";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { Alert, AppLayout, BrandedLoader, Button, ConfirmAction, useToast } from "@/components/ui";
import { ChooseView } from "./_parts/ChooseView";
import { ProofForm } from "./_parts/ProofForm";
import { FailDone } from "./_parts/FailDone";
import {
  failPathFor,
  parseStatus,
  proofSignature,
  UPLOAD_TIMEOUT_MS,
  uploadErrorKey,
  type ExamType,
  type PuypStatus,
} from "./_parts/rules";

type View = "choose" | "proof" | "submitted" | "recorded";

export default function ExamResultPage() {
  const router = useRouter();
  const toast = useToast();
  const lang = useLang();

  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<PuypStatus | null>(null);
  const [view, setView] = useState<View>("choose");
  const [attemptDate, setAttemptDate] = useState("");
  const [examType, setExamType] = useState<ExamType>("kenntnispruefung");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [dateError, setDateError] = useState<string | undefined>();

  // One in-flight action at a time; keys survive retries (EXM-55).
  const seeded = useRef(false);
  const actionBusy = useRef(false);
  const uploadKey = useRef({ signature: "", key: "" });
  const failKey = useRef({ signature: "", key: "" });
  const [passPending, setPassPending] = useState(false);
  const [failPending, setFailPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failError, setFailError] = useState(false);
  const [uploadError, setUploadError] = useState<PuypKey | null>(null);
  const [confirmPass, setConfirmPass] = useState(false);
  const [confirmFail, setConfirmFail] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await authFetch("/api/puyp/status");
      const parsed = res.ok ? parseStatus(await res.json().catch(() => null)) : null;
      if (!parsed) { setLoadError(true); return; }
      setStatus(parsed);
      // Defaults only from a good read, once; a reload never overwrites the learner's choice.
      if (!seeded.current) {
        seeded.current = true;
        if (parsed.exam_type) setExamType(parsed.exam_type);
        if (parsed.exam_date) setAttemptDate((prev) => prev || (parsed.exam_date as string));
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const session = getStoredSession();
    if (!session?.user?.id) {
      router.replace("/login?next=/dashboard/exam-result");
      return;
    }
    setUserId(session.user.id);
    void loadStatus();
  }, [router, loadStatus]);

  useEffect(() => { if (attemptDate) setDateError(undefined); }, [attemptDate]);

  async function submitPass(): Promise<boolean> {
    if (actionBusy.current) return false;
    actionBusy.current = true; setPassPending(true);
    try {
      const res = await authFetch("/api/puyp/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: "pass", exam_type: examType, attempt_date: attemptDate || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error("pass_not_saved");
      const receipt = passReceiptFromResponse(res, data, userId);
      if (receipt) { try { sessionStorage.setItem(PASS_RECEIPT_KEY, JSON.stringify(receipt)); } catch { /* A receipt is optional; never claim a write from the URL. */ } }
      toast.success(tp("passSaved", lang), tp("passSavedBody", lang));
      router.push("/stats?examPassed=1");
      // Stay busy while /stats loads so the open confirm cannot post again.
      return true;
    } catch {
      toast.error(tp("passError", lang));
      actionBusy.current = false; setPassPending(false);
      return false;
    }
  }

  function startFail() {
    if (!status) return;
    setFailError(false);
    if (failPathFor(status).mode === "claim") { setUploadError(null); setView("proof"); return; }
    if (!attemptDate) { setDateError(tp("attemptDateMissing", lang)); return; }
    setConfirmFail(true);
  }

  async function recordFail(): Promise<boolean> {
    if (actionBusy.current) return false;
    const signature = `${userId}:${examType}:${attemptDate}`;
    if (failKey.current.signature !== signature) failKey.current = { signature, key: crypto.randomUUID() };
    actionBusy.current = true; setFailPending(true); setFailError(false);
    try {
      const res = await authFetch("/api/puyp/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result: "fail", exam_type: examType, attempt_date: attemptDate, idempotency_key: failKey.current.key }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || data.result !== "fail") throw new Error("fail_not_saved");
      setView("recorded");
      return true;
    } catch {
      setFailError(true);
      return false;
    } finally {
      actionBusy.current = false; setFailPending(false);
    }
  }

  async function submitProof() {
    if (actionBusy.current || !proofFile || !attemptDate) return;
    const signature = proofSignature(userId, examType, attemptDate, proofFile);
    if (uploadKey.current.signature !== signature) uploadKey.current = { signature, key: crypto.randomUUID() };
    const form = new FormData();
    form.append("idempotency_key", uploadKey.current.key);
    form.append("proof", proofFile);
    form.append("exam_type", examType);
    form.append("attempt_date", attemptDate);

    actionBusy.current = true; setUploading(true); setUploadError(null);
    try {
      const res = await authFetch("/api/puyp/submit", { method: "POST", body: form, timeoutMs: UPLOAD_TIMEOUT_MS });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setUploadError(uploadErrorKey({ status: res.status })); return; }
      setView("submitted");
    } catch (err) {
      setUploadError(uploadErrorKey({ error: err }));
    } finally {
      actionBusy.current = false; setUploading(false);
    }
  }

  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <ConfirmAction
        open={confirmPass}
        onOpenChange={setConfirmPass}
        title={t("a12_pass_confirm_title", lang)}
        consequence={attemptDate ? t("a12_pass_confirm_body_date", lang).replace("{date}", attemptDate) : t("a12_pass_confirm_body", lang)}
        confirmLabel={t("a12_pass_confirm_action", lang)}
        pendingLabel={tp("saving", lang)}
        cancelLabel={tp("cancel", lang)}
        pending={passPending}
        // On success the page navigates; closing the dialog then would pop that navigation.
        onConfirm={() => { void submitPass().then((saved) => { if (!saved) setConfirmPass(false); }); }}
      />
      <ConfirmAction
        open={confirmFail}
        onOpenChange={setConfirmFail}
        title={tp("failConfirmTitle", lang)}
        consequence={attemptDate ? tp("failConfirmBodyDate", lang, { date: attemptDate }) : tp("failConfirmBody", lang)}
        confirmLabel={tp("failConfirmAction", lang)}
        pendingLabel={tp("saving", lang)}
        cancelLabel={tp("cancel", lang)}
        pending={failPending}
        onConfirm={() => { void recordFail().then(() => setConfirmFail(false)); }}
      />
      <main id="main" className="main-content flex-1 min-w-0 pb-24 md:pb-6 bg-[var(--mp-surface-sunken)]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
          <header className="space-y-2">
            <span className="inline-flex items-center rounded-full border border-[var(--mp-border)] bg-[var(--mp-surface)] px-2.5 py-0.5 text-xs font-medium text-[var(--mp-fg-muted)]">
              {tp("eyebrow", lang)}
            </span>
            <h1 className="mp-h2 text-balance">{tp("title", lang)}</h1>
            <p className="text-sm text-[var(--mp-fg-muted)]">{tp("intro", lang)}</p>
          </header>

          {loading && (
            <div className="flex justify-center py-16">
              <BrandedLoader label={tp("loading", lang)} />
            </div>
          )}

          {!loading && loadError && (
            <Alert variant="error" title={tp("loadErrorTitle", lang)}>
              <p>{tp("loadErrorBody", lang)}</p>
              <Button type="button" variant="secondary" className="mt-2 min-h-[44px]" onClick={() => void loadStatus()}>
                {tp("reload", lang)}
              </Button>
            </Alert>
          )}

          {!loading && !loadError && status && view === "choose" && (
            <ChooseView
              lang={lang}
              status={status}
              passPending={passPending}
              failPending={failPending}
              failError={failError}
              dateError={dateError}
              onPass={() => setConfirmPass(true)}
              onFail={startFail}
              onRetryFail={() => void recordFail()}
              examType={examType}
              setExamType={setExamType}
              attemptDate={attemptDate}
              setAttemptDate={setAttemptDate}
            />
          )}

          {!loading && !loadError && status && view === "proof" && (
            <ProofForm
              lang={lang}
              status={status}
              examType={examType}
              setExamType={setExamType}
              attemptDate={attemptDate}
              setAttemptDate={setAttemptDate}
              proofFile={proofFile}
              setProofFile={setProofFile}
              submitting={uploading}
              uploadError={uploadError}
              onSubmit={() => void submitProof()}
              onCancel={() => setView("choose")}
            />
          )}

          {view === "submitted" && <FailDone lang={lang} withProof />}
          {view === "recorded" && <FailDone lang={lang} withProof={false} />}
        </div>
      </main>
    </AppLayout>
  );
}
