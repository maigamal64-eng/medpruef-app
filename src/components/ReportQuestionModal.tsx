"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Edit3, CheckCircle2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { reportsCopy } from "@/lib/i18n-reports";
import { getSessionToken } from "@/lib/auth";
import { trackEvent } from "@/lib/tracker";
// Auth-aware fetch so the x-user-id header is set on the
// /api/suggestions POST. Before 2026-04-15 this modal's POST dropped
// userId entirely — all 45 existing flag rows had user_id = NULL.
// The alias pattern means the existing fetch() call sites below
// automatically pick up the header.
import { authFetch as fetch } from "@/lib/authFetch";
import { captureClientContext } from "@/lib/clientContext";
import { Alert, Dialog, Textarea } from "@/components/ui";
import { REPORT_REASONS as FLAG_REASONS, type ReportReason } from "@/components/question/report-reasons";

type Lang = "de" | "en";

interface Props {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  questionId: number;
  questionText: string;
  explanation: string;
  topic: string;
  /** Open straight into a flag with this reason (e.g. the image error's "Bild fehlt"). */
  preset?: { reason: ReportReason } | null;
  /** Fired once a report is stored (2xx), never on a failed send. */
  onSubmitted?: () => void;
}


export default function ReportQuestionModal({
  open,
  onClose,
  lang,
  questionId,
  questionText,
  explanation,
  topic,
  preset = null,
  onSubmitted,
}: Props) {
  const [type, setType] = useState<"flag" | "edit" | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [details, setDetails] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const copy = reportsCopy(lang);

  // Reset state on open / question change
  useEffect(() => {
    if (open) {
      setType(preset ? "flag" : null);
      setFlagReason(preset?.reason ?? "");
      setDetails("");
      setEditQuestion(questionText);
      setEditExplanation(explanation || "");
      setEditTopic(topic);
      setSubmitted(false);
      setLoading(false);
      setSendError(null);
      setSignedIn(!!getSessionToken());
    }
  }, [open, questionId, questionText, explanation, topic, preset]);

  // QLT-03: only a stored report is acknowledged; a failed POST says so.
  // UX-PRA-35: offline keeps the dialog and the typed text; reports never
  // enter the answer outbox. A failed send keeps everything for a retry.
  const postReport = async (body: Record<string, unknown>): Promise<boolean> => {
    setSendError(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setSendError(copy.offline);
      return false;
    }
    let res: Response;
    try {
      res = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      setSendError(typeof navigator !== "undefined" && navigator.onLine === false ? copy.offline : copy.sendError);
      return false;
    }
    if (res.ok) return true;
    setSendError(res.status === 429 ? copy.rateLimited : copy.sendError);
    return false;
  };
  // Back online: clear the offline line so "Senden" reads as available again.
  useEffect(() => {
    if (!open) return;
    const onOnline = () => setSendError((current) => (current === copy.offline ? null : current));
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [open, copy.offline]);

  const submitFlag = async () => {
    if (!flagReason || loading) return;
    setLoading(true);
    try {
      const context = captureClientContext({ question_id: questionId });
      const ok = await postReport({
        questionId,
        type: "flag",
        reason: flagReason,
        details: details || null,
        context,
      });
      if (!ok) return;
      setSubmitted(true);
      onSubmitted?.();
      trackEvent("feature_use", { feature: "flag_question", reason: flagReason, questionId });
    } catch {
      setSendError(copy.sendError);
    } finally {
      setLoading(false);
    }
  };

  const submitEdit = async () => {
    const changes: Record<string, string> = {};
    if (editQuestion !== questionText) changes.question = editQuestion;
    if (editExplanation !== (explanation || "")) changes.explanation = editExplanation;
    if (editTopic !== topic) changes.topic = editTopic;
    if ((Object.keys(changes).length === 0 && !details) || loading) return;
    setLoading(true);
    try {
      const context = captureClientContext({ question_id: questionId });
      const ok = await postReport({
        questionId,
        type: "edit",
        details: details || null,
        suggestedChanges: Object.keys(changes).length > 0 ? changes : null,
        context,
      });
      if (!ok) return;
      setSubmitted(true);
      onSubmitted?.();
      trackEvent("feature_use", { feature: "suggest_edit", questionId });
    } catch {
      setSendError(copy.sendError);
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle = lang === "de" ? "Frage melden" : "Report question";

  let footer: React.ReactNode = null;
  if (submitted) {
    footer = (
      <button type="button" className="mp-btn mp-btn--primary" onClick={onClose}>
        {copy.close}
      </button>
    );
  } else if (type === "flag") {
    footer = (
      <>
        <button
          className="mp-btn mp-btn--secondary"
          onClick={() => setType(null)}
        >
          {t("cancel", lang)}
        </button>
        <button
          className="mp-btn mp-btn--primary"
          onClick={submitFlag}
          disabled={!flagReason || loading}
        >
          {loading ? "..." : lang === "de" ? "Senden" : "Submit"}
        </button>
      </>
    );
  } else if (type === "edit") {
    footer = (
      <>
        <button
          className="mp-btn mp-btn--secondary"
          onClick={() => setType(null)}
        >
          {t("cancel", lang)}
        </button>
        <button
          className="mp-btn mp-btn--primary"
          onClick={submitEdit}
          disabled={loading}
        >
          {loading ? "..." : lang === "de" ? "Vorschlag senden" : "Submit suggestion"}
        </button>
      </>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={dialogTitle}
      maxWidth="520px"
      footer={footer}
    >
      {sendError && !submitted && (
        <Alert variant="error" className="mb-3">{sendError}</Alert>
      )}
      {submitted ? (
        <div className="text-center py-6 animate-fade-in" role="status" data-testid="report-ack">
          <CheckCircle2 className="w-12 h-12 text-[var(--mp-viridian)] mx-auto mb-3" aria-hidden />
          <p className="text-base font-semibold text-[var(--mp-fg)]">{copy.ackTitle}</p>
          <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{copy.ackBody}</p>
          {signedIn && (
            <Link
              href="/settings#meine-meldungen"
              onClick={onClose}
              className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
            >
              {copy.ackLink}
            </Link>
          )}
        </div>
      ) : !type ? (
        <div className="grid grid-cols-1 gap-3">
          <button
            onClick={() => setType("flag")}
            className="flex items-center gap-3 p-4 border border-[var(--mp-border)] rounded-xl hover:border-[var(--mp-error)]/40 hover:bg-[var(--mp-error)]/5 transition-all text-left"
          >
            <AlertTriangle className="w-6 h-6 text-[var(--mp-error)] flex-shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Problem melden" : "Report a problem"}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                {lang === "de"
                  ? "Fehler, Duplikat, unklar, fehlende Erklärung"
                  : "Error, duplicate, unclear, missing explanation"}
              </p>
            </div>
          </button>
          <button
            onClick={() => setType("edit")}
            className="flex items-center gap-3 p-4 border border-[var(--mp-border)] rounded-xl hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-viridian)]/5 transition-all text-left"
          >
            <Edit3 className="w-6 h-6 text-[var(--mp-viridian)] flex-shrink-0" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Änderung vorschlagen" : "Suggest an edit"}
              </p>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-0.5">
                {lang === "de"
                  ? "Fragetext oder Erklärung bearbeiten"
                  : "Edit the question or explanation"}
              </p>
            </div>
          </button>
        </div>
      ) : type === "flag" ? (
        <div className="space-y-4">
          <div>
            <p id="report-reason-label" className="text-[12px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2 block">
              {lang === "de" ? "Was ist das Problem?" : "What's wrong?"}
            </p>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="report-reason-label">
              {FLAG_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={flagReason === r.value}
                  onClick={() => setFlagReason(r.value)}
                  className={`min-h-11 text-[13px] px-3 py-1.5 rounded-full border transition-all ${
                    flagReason === r.value
                      ? "bg-[var(--mp-error)]/10 border-[var(--mp-error)]/40 text-[var(--mp-error-text)] font-semibold"
                      : "border-[var(--mp-border-control)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-error)]/30"
                  }`}
                >
                  {lang === "de" ? r.de : r.en}
                </button>
              ))}
            </div>
          </div>
          <Textarea
            label={lang === "de" ? "Details (optional)" : "Details (optional)"}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={3}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <Textarea
            label={lang === "de" ? "Fragetext" : "Question text"}
            value={editQuestion}
            onChange={(e) => setEditQuestion(e.target.value)}
            rows={3}
          />
          <Textarea
            label={lang === "de" ? "Erklärung" : "Explanation"}
            value={editExplanation}
            onChange={(e) => setEditExplanation(e.target.value)}
            rows={4}
            placeholder={
              lang === "de"
                ? "Erklärung hinzufügen oder bearbeiten…"
                : "Add or edit explanation…"
            }
          />
          <Textarea
            label={
              lang === "de"
                ? "Was hast du geändert? (optional)"
                : "What did you change? (optional)"
            }
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            rows={2}
          />
        </div>
      )}
    </Dialog>
  );
}
