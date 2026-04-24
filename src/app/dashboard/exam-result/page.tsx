"use client";

/**
 * /dashboard/exam-result — "How did your exam go?" Pass-Until-You-Pass
 * gate for users on PUYP-eligible tiers (June 26 Cohort + 12-month).
 *
 * Flow (April 23 2026 lock #1):
 *   1. User's exam_date ≤ today → dashboard surface nudges here.
 *   2. Two big buttons: "I passed" / "I failed".
 *   3. Pass → POST /api/puyp/result — server records, no extension,
 *      redirect to /stats. The referrer's €75 payout becomes
 *      claimable on the 30-day hold measured from the referee's
 *      original subscription_started_at (handled server-side).
 *   4. Fail → form with attempt_date, exam_type, proof upload. POST
 *      /api/puyp/submit (multipart). Server enforces:
 *         • active subscription on a PUYP-eligible tier
 *         • puyp_extensions_used < 2
 *         • Qbank completion ≥ 70%
 *         • file ≤ 10MB, image/pdf MIME
 *      Response: "Submitted — admin reviews within 72 hours."
 *
 * If the user is NOT on a PUYP-eligible tier or has no active sub,
 * the page shows an "upgrade to claim" card explaining the offer
 * but steers them to /pricing rather than starting a submission
 * that will just 403.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  Shield,
  Upload,
  XCircle,
} from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { getStoredSession } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import {
  Alert,
  BrandedLoader,
  EmptyState,
  Select,
  TextField,
  useToast,
} from "@/components/ui";

type ExamType = "kenntnispruefung" | "kmp_innsbruck" | "pharma";

interface PuypStatus {
  eligible: boolean;
  reason?: string;
  subscription?: {
    tier: string;
    expires_at: string | null;
    puyp_extensions_used: number;
  };
  exam_type: ExamType | null;
  exam_date: string | null;
  qbank_completion_pct: number;
  qbank_answered: number;
  qbank_total: number;
  meets_completion_gate: boolean;
}

export default function ExamResultPage() {
  const router = useRouter();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<PuypStatus | null>(null);
  const [lang, setLangState] = useState<"de" | "en">("de");
  const [userId, setUserId] = useState<string>("");
  const [view, setView] = useState<"choose" | "fail-form" | "submitted">(
    "choose"
  );
  const [attemptDate, setAttemptDate] = useState("");
  const [examType, setExamType] = useState<ExamType>("kenntnispruefung");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate from session + (later) server
  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (!session?.user?.id) {
      router.replace("/login?next=/dashboard/exam-result");
      return;
    }
    setUserId(session.user.id);
    void loadStatus();
  }, [router]);

  async function loadStatus() {
    setLoading(true);
    try {
      const res = await authFetch("/api/puyp/status");
      if (!res.ok) {
        // Fall back to session defaults so the UI can still render
        // something useful rather than a blank page.
        const session = getStoredSession();
        setStatus({
          eligible: false,
          reason:
            "We couldn't load your Pass-Until-You-Pass status. Please reload the page.",
          exam_type:
            ((session?.user as { active_exam?: ExamType } | undefined)
              ?.active_exam as ExamType) || "kenntnispruefung",
          exam_date: null,
          qbank_completion_pct: 0,
          qbank_answered: 0,
          qbank_total: 0,
          meets_completion_gate: false,
        });
        return;
      }
      const data = (await res.json()) as PuypStatus;
      setStatus(data);
      if (data.exam_type) setExamType(data.exam_type);
      if (data.exam_date) setAttemptDate(data.exam_date);
    } catch {
      // same fallback as above
      setStatus({
        eligible: false,
        reason: "Could not reach the server — check your connection and reload.",
        exam_type: "kenntnispruefung",
        exam_date: null,
        qbank_completion_pct: 0,
        qbank_answered: 0,
        qbank_total: 0,
        meets_completion_gate: false,
      });
    } finally {
      setLoading(false);
    }
  }

  async function submitPass() {
    try {
      const res = await authFetch("/api/puyp/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: "pass",
          exam_type: examType,
          attempt_date: attemptDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || (lang === "de" ? "Konnte Bestehen nicht speichern" : "Failed to record pass"));
      toast.success(
        lang === "de" ? "Herzlichen Glückwunsch!" : "Congratulations!",
        lang === "de" ? "Dein Bestehen ist gespeichert." : "We've recorded your pass."
      );
      router.push("/stats?examPassed=1");
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  async function submitFail(e: React.FormEvent) {
    e.preventDefault();
    if (!proofFile) {
      toast.error(lang === "de" ? "Bitte zuerst einen Nachweis hochladen." : "Please upload a proof file first.");
      return;
    }
    if (proofFile.size > 10 * 1024 * 1024) {
      toast.error(
        lang === "de" ? "Datei zu groß" : "File too large",
        lang === "de" ? "Maximal 10 MB." : "Maximum 10MB."
      );
      return;
    }

    const form = new FormData();
    form.append("proof", proofFile);
    form.append("exam_type", examType);
    if (attemptDate) form.append("attempt_date", attemptDate);

    setSubmitting(true);
    try {
      const res = await authFetch("/api/puyp/submit", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || (lang === "de" ? "Einreichung fehlgeschlagen" : "Submission failed"));
      }
      setView("submitted");
      toast.success(
        lang === "de" ? "Eingereicht!" : "Submitted!",
        lang === "de" ? "Admin prüft innerhalb von 72 Stunden." : "Admin will review within 72 hours."
      );
    } catch (err) {
      toast.error((err as Error).message || (lang === "de" ? "Konnte nicht einreichen — bitte erneut versuchen" : "Could not submit — try again"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex">
      <Sidebar lang={lang} userId={userId} />
      <main className="flex-1 min-w-0 pb-24 md:pb-6 md:ml-64">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-viridian)] mb-4"
          >
            <ArrowLeft size={14} /> Back to dashboard
          </Link>

          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-lg bg-[var(--mp-viridian)]/10 flex items-center justify-center">
              <GraduationCap size={20} className="text-[var(--mp-viridian)]" />
            </div>
            <div>
              <h1 className="mp-h1">Pass-Until-You-Pass</h1>
              <p className="text-sm text-[var(--mp-fg-muted)]">
                Tell us how your exam went.
              </p>
            </div>
          </div>

          {loading && (
            <div className="flex justify-center py-16">
              <BrandedLoader label="Loading your status…" />
            </div>
          )}

          {!loading && status && view === "choose" && (
            <ChooseView
              status={status}
              onPass={submitPass}
              onFail={() => setView("fail-form")}
              examType={examType}
              setExamType={setExamType}
              attemptDate={attemptDate}
              setAttemptDate={setAttemptDate}
            />
          )}

          {!loading && status && view === "fail-form" && (
            <FailForm
              status={status}
              examType={examType}
              setExamType={setExamType}
              attemptDate={attemptDate}
              setAttemptDate={setAttemptDate}
              proofFile={proofFile}
              setProofFile={setProofFile}
              submitting={submitting}
              onSubmit={submitFail}
              onCancel={() => setView("choose")}
            />
          )}

          {!loading && view === "submitted" && <SubmittedView />}
        </div>
      </main>
      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}

// ═══ Views ══════════════════════════════════════════════════════════

function ChooseView({
  status,
  onPass,
  onFail,
  examType,
  setExamType,
  attemptDate,
  setAttemptDate,
}: {
  status: PuypStatus;
  onPass: () => void;
  onFail: () => void;
  examType: ExamType;
  setExamType: (v: ExamType) => void;
  attemptDate: string;
  setAttemptDate: (v: string) => void;
}) {
  // Non-eligible branch — steer to /pricing.
  if (!status.eligible) {
    return (
      <div className="space-y-6">
        <Alert variant="info" title="Pass-Until-You-Pass is a premium feature">
          The guarantee applies to the <strong>June 26 Cohort</strong> and{" "}
          <strong>12-month</strong> plans. You can still record your result
          below, but there&apos;s no subscription extension on your current tier.
        </Alert>

        <div className="mp-card p-5 space-y-4">
          <h2 className="mp-h2">How did your exam go?</h2>

          <Select
            label="Exam type"
            value={examType}
            onChange={(e) => setExamType(e.target.value as ExamType)}
            options={[
              { value: "kenntnispruefung", label: "Kenntnisprüfung Wien" },
              { value: "kmp_innsbruck", label: "KMP Innsbruck" },
              { value: "pharma", label: "Pharmakologie" },
            ]}
          />

          <TextField
            label="Attempt date"
            type="date"
            value={attemptDate}
            onChange={(e) => setAttemptDate(e.target.value)}
            helper="The date of your real exam."
          />

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              className="mp-btn mp-btn--primary flex-1 justify-center"
              onClick={onPass}
            >
              <CheckCircle2 size={16} /> I passed
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--secondary flex-1 justify-center"
              onClick={onFail}
              disabled
              title="Upgrade to an eligible plan to submit a PUYP claim"
            >
              <XCircle size={16} /> I failed
            </button>
          </div>

          <Link
            href="/pricing"
            className="block text-center text-sm text-[var(--mp-cta-blue)] hover:underline pt-2"
          >
            See the plans with Pass-Until-You-Pass
            <ArrowRight size={14} className="inline ml-1" />
          </Link>
        </div>
      </div>
    );
  }

  const used = status.subscription?.puyp_extensions_used ?? 0;
  const remaining = Math.max(0, 2 - used);
  const atCap = used >= 2;

  return (
    <div className="space-y-6">
      <div className="mp-card p-5 space-y-3">
        <div className="flex items-center gap-2 text-sm text-[var(--mp-viridian)]">
          <Shield size={14} /> <span>Your plan includes Pass-Until-You-Pass</span>
        </div>
        <h2 className="mp-h2">How did your exam go?</h2>
        <p className="text-sm text-[var(--mp-fg-muted)]">
          If you failed on your first real attempt and have answered ≥70% of
          the question bank, we&apos;ll extend your access through the next cycle
          at no cost. {remaining > 0
            ? `You have ${remaining} extension${remaining === 1 ? "" : "s"} remaining.`
            : "You’ve already used the full 2 extensions on this subscription."}
        </p>

        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          <div className="mp-card p-3 text-xs">
            <div className="flex items-center justify-between text-[var(--mp-fg-muted)]">
              <span>Qbank completion</span>
              <span
                className={
                  status.meets_completion_gate
                    ? "text-[var(--mp-viridian)] font-semibold"
                    : "text-[var(--mp-status-warning)] font-semibold"
                }
              >
                {status.qbank_completion_pct.toFixed(1)}%
              </span>
            </div>
            <div className="text-[var(--mp-fg-subtle)] text-[11px] mt-1">
              {status.qbank_answered.toLocaleString()} of{" "}
              {status.qbank_total.toLocaleString()} questions answered
              {!status.meets_completion_gate && " · need ≥70% to claim"}
            </div>
          </div>
          <div className="mp-card p-3 text-xs">
            <div className="flex items-center justify-between text-[var(--mp-fg-muted)]">
              <span>Subscription</span>
              <span className="text-[var(--mp-fg)] font-semibold capitalize">
                {status.subscription?.tier.replace(/_/g, " ")}
              </span>
            </div>
            <div className="text-[var(--mp-fg-subtle)] text-[11px] mt-1">
              Extensions used: {used}/2
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <TextField
            label="Attempt date"
            type="date"
            value={attemptDate}
            onChange={(e) => setAttemptDate(e.target.value)}
            helper="The date of your real exam."
          />
          <Select
            label="Exam type"
            value={examType}
            onChange={(e) => setExamType(e.target.value as ExamType)}
            options={[
              { value: "kenntnispruefung", label: "Kenntnisprüfung Wien" },
              { value: "kmp_innsbruck", label: "KMP Innsbruck" },
              { value: "pharma", label: "Pharmakologie" },
            ]}
          />
        </div>

        <div className="flex flex-col sm:flex-row gap-3 pt-2">
          <button
            type="button"
            className="mp-btn mp-btn--primary flex-1 justify-center"
            onClick={onPass}
          >
            <CheckCircle2 size={16} /> I passed
          </button>
          <button
            type="button"
            className="mp-btn mp-btn--secondary flex-1 justify-center"
            onClick={onFail}
            disabled={atCap || !status.meets_completion_gate}
            title={
              atCap
                ? "You've used all 2 extensions on this subscription"
                : !status.meets_completion_gate
                  ? "You need ≥70% Qbank completion to submit"
                  : undefined
            }
          >
            <XCircle size={16} /> I failed — claim extension
          </button>
        </div>

        {(atCap || !status.meets_completion_gate) && (
          <p className="text-xs text-[var(--mp-fg-subtle)] pt-1">
            {atCap
              ? "Extension cap reached. You can still record a fail — it won't trigger an extension."
              : "Keep answering questions to reach the 70% completion threshold."}
          </p>
        )}
      </div>
    </div>
  );
}

function FailForm({
  status,
  examType,
  setExamType,
  attemptDate,
  setAttemptDate,
  proofFile,
  setProofFile,
  submitting,
  onSubmit,
  onCancel,
}: {
  status: PuypStatus;
  examType: ExamType;
  setExamType: (v: ExamType) => void;
  attemptDate: string;
  setAttemptDate: (v: string) => void;
  proofFile: File | null;
  setProofFile: (f: File | null) => void;
  submitting: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mp-card p-5 space-y-4"
      aria-labelledby="puyp-fail-title"
    >
      <h2 id="puyp-fail-title" className="mp-h2">
        Submit proof of failed attempt
      </h2>
      <p className="text-sm text-[var(--mp-fg-muted)]">
        Upload your official exam result (PDF or photo). An admin will verify
        within 72 hours and extend your subscription to cover the next
        available cycle.
      </p>

      <Alert variant="info" title="What counts as proof?">
        Any official document showing your name, exam type, attempt date, and
        the failing result. Screenshots of an exam-board portal are fine.
      </Alert>

      <TextField
        label="Attempt date"
        type="date"
        required
        value={attemptDate}
        onChange={(e) => setAttemptDate(e.target.value)}
      />

      <Select
        label="Exam type"
        required
        value={examType}
        onChange={(e) => setExamType(e.target.value as ExamType)}
        options={[
          { value: "kenntnispruefung", label: "Kenntnisprüfung Wien" },
          { value: "kmp_innsbruck", label: "KMP Innsbruck" },
          { value: "pharma", label: "Pharmakologie" },
        ]}
      />

      <div className="mp-field">
        <label htmlFor="puyp-proof" className="mp-field__label mp-field__label--required">
          Proof file
        </label>
        <div className="mp-card p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-[var(--mp-cta-blue)]/10 flex items-center justify-center flex-shrink-0">
            <Upload size={16} className="text-[var(--mp-cta-blue)]" />
          </div>
          <div className="flex-1 min-w-0 text-xs">
            {proofFile ? (
              <>
                <div className="font-medium text-[var(--mp-fg)] truncate">
                  {proofFile.name}
                </div>
                <div className="text-[var(--mp-fg-subtle)]">
                  {(proofFile.size / 1024 / 1024).toFixed(2)} MB · {proofFile.type || "—"}
                </div>
              </>
            ) : (
              <div className="text-[var(--mp-fg-subtle)]">
                No file selected · max 10MB · PDF, JPG, PNG, WebP
              </div>
            )}
          </div>
          <label
            htmlFor="puyp-proof"
            className="mp-btn mp-btn--secondary mp-btn--sm cursor-pointer"
          >
            {proofFile ? "Change" : "Choose file"}
          </label>
          <input
            id="puyp-proof"
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf"
            onChange={(e) => setProofFile(e.target.files?.[0] || null)}
            className="sr-only"
          />
        </div>
        <p className="mp-field__helper">
          Files are stored privately. Only admins can review them via a
          short-lived signed URL.
        </p>
      </div>

      <div className="text-xs text-[var(--mp-fg-subtle)] border-t border-[var(--mp-border)] pt-3">
        Submitting attaches a snapshot of your Qbank completion
        ({status.qbank_completion_pct.toFixed(1)}%) to the claim.
      </div>

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <button
          type="submit"
          className="mp-btn mp-btn--primary flex-1 justify-center"
          disabled={submitting || !proofFile || !attemptDate}
        >
          {submitting ? (
            <>Submitting…</>
          ) : (
            <>
              Submit for review <ArrowRight size={14} />
            </>
          )}
        </button>
        <button
          type="button"
          className="mp-btn mp-btn--secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmittedView() {
  return (
    <EmptyState
      tone="success"
      icon={<Clock className="w-10 h-10" aria-hidden />}
      title="Submitted — admin is reviewing."
      body="We'll email you within 72 hours. If approved, your subscription will extend automatically to cover the next exam cycle. You can close this page."
      action={
        <Link href="/" className="mp-btn mp-btn--primary mt-4">
          <FileText size={14} /> Back to dashboard
        </Link>
      }
    />
  );
}
