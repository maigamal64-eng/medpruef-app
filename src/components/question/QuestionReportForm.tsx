"use client";

/**
 * QuestionReportForm — modal wrapper around the flag + edit flows.
 *
 * Extracted from QuestionCard.tsx (DD-15 burndown). The legacy form
 * was an inline expanding panel — this version uses the MPDS `<Dialog>`
 * primitive to get the a11y guarantees for free (focus trap, escape,
 * aria-modal, body scroll lock, return-focus-to-opener).
 *
 * The POST shape is identical to the legacy implementation — the
 * /api/suggestions endpoint does not need to change. `userId` /
 * `guestId` are plumbed through both for explicit body propagation AND
 * because authFetch adds the `x-user-id` header for signed-in users.
 * (The server-side auth-guard trusts the header and ignores the body
 * userId, but we keep it in the body for parity with older rows.)
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Edit3, CheckCircle2, Flag } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { t } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";
import { captureClientContext } from "@/lib/clientContext";
import { Dialog, Textarea } from "@/components/ui";

type Lang = "de" | "en";

interface Props {
  open: boolean;
  questionId: number;
  lang: Lang;
  /** Pre-filled question stem for the edit flow. */
  initialQuestion: string;
  /** Pre-filled explanation for the edit flow. */
  initialExplanation: string;
  /** Pre-filled topic for the edit flow. Used to detect topic edits. */
  initialTopic: string;
  /** Optional authenticated user id — threaded into the payload. */
  userId?: string | null;
  /** Optional anonymous session id — threaded into the payload. */
  guestId?: string | null;
  /** Fired when the dialog should close (either user cancel or after submit). */
  onClose: () => void;
  /** Open straight into a flag with this reason (e.g. the image error's "Bild fehlt"). */
  preset?: { reason: (typeof FLAG_REASONS)[number]["value"] } | null;
  /** Fired once the POST resolves so the parent can flip its submitted state. */
  onSubmitted: () => void;
}

const FLAG_REASONS = [
  { value: "incorrect_answer", de: "Falsche Antwort", en: "Incorrect Answer" },
  { value: "malformed", de: "Fehlerhaft", en: "Malformed" },
  { value: "duplicate", de: "Duplikat", en: "Duplicate" },
  { value: "typo", de: "Tippfehler", en: "Typo" },
  { value: "unclear", de: "Unklar", en: "Unclear" },
  { value: "missing_explanation", de: "Erklärung fehlt", en: "Missing Explanation" },
  { value: "missing_image", de: "Bild fehlt", en: "Image missing" },
  { value: "wrong_topic", de: "Falsches Thema", en: "Wrong Topic" },
  { value: "other", de: "Sonstiges", en: "Other" },
] as const;

export default function QuestionReportForm({
  open,
  questionId,
  lang,
  initialQuestion,
  initialExplanation,
  initialTopic,
  userId,
  guestId,
  onClose,
  onSubmitted,
  preset,
}: Props) {
  const [type, setType] = useState<"flag" | "edit" | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [details, setDetails] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reset on open / question change
  useEffect(() => {
    if (!open) return;
    setType(preset ? "flag" : null);
    setFlagReason(preset?.reason ?? "");
    setDetails("");
    setEditQuestion(initialQuestion);
    setEditExplanation(initialExplanation || "");
    setEditTopic(initialTopic);
    setSubmitted(false);
    setLoading(false);
  }, [open, questionId, initialQuestion, initialExplanation, initialTopic, preset]);

  const submitFlag = async () => {
    if (!flagReason) return;
    setLoading(true);
    try {
      const ctx = captureClientContext({ question_id: questionId });
      // Prefer the explicit userId prop over whatever captureClientContext
      // infers — the parent has authoritative data.
      const resolvedUserId = userId ?? ctx.session_user_id;
      await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          userId: resolvedUserId,
          guestId: guestId ?? null,
          type: "flag",
          reason: flagReason,
          details: details || null,
          context: ctx,
        }),
      });
      setSubmitted(true);
      trackEvent("feature_use", {
        feature: "flag_question",
        reason: flagReason,
        questionId,
      });
      onSubmitted();
      setTimeout(() => onClose(), 1500);
    } catch {
      /* silent — the form still surfaces the "thanks" state so users don't spam retries */
    } finally {
      setLoading(false);
    }
  };

  const submitEdit = async () => {
    const changes: Record<string, string> = {};
    if (editQuestion !== initialQuestion) changes.question = editQuestion;
    if (editExplanation !== (initialExplanation || "")) changes.explanation = editExplanation;
    if (editTopic !== initialTopic) changes.topic = editTopic;
    if (Object.keys(changes).length === 0 && !details) return;
    setLoading(true);
    try {
      const ctx = captureClientContext({ question_id: questionId });
      const resolvedUserId = userId ?? ctx.session_user_id;
      await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          userId: resolvedUserId,
          guestId: guestId ?? null,
          type: "edit",
          details: details || null,
          suggestedChanges: Object.keys(changes).length > 0 ? changes : null,
          context: ctx,
        }),
      });
      setSubmitted(true);
      trackEvent("feature_use", { feature: "suggest_edit", questionId });
      onSubmitted();
      setTimeout(() => onClose(), 1500);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const dialogTitle = lang === "de" ? "Problem melden" : "Report Issue";

  let footer: React.ReactNode = null;
  if (!submitted && type === "flag") {
    footer = (
      <>
        <button
          type="button"
          className="mp-btn mp-btn--secondary"
          onClick={() => setType(null)}
        >
          {t("cancel", lang)}
        </button>
        <button
          type="button"
          className="mp-btn mp-btn--primary"
          onClick={submitFlag}
          disabled={!flagReason || loading}
        >
          {loading ? "..." : lang === "de" ? "Senden" : "Submit"}
        </button>
      </>
    );
  } else if (!submitted && type === "edit") {
    footer = (
      <>
        <button
          type="button"
          className="mp-btn mp-btn--secondary"
          onClick={() => setType(null)}
        >
          {t("cancel", lang)}
        </button>
        <button
          type="button"
          className="mp-btn mp-btn--primary"
          onClick={submitEdit}
          disabled={loading}
        >
          {loading ? "..." : lang === "de" ? "Vorschlag senden" : "Submit Suggestion"}
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
      maxWidth="560px"
      footer={footer}
    >
      {submitted ? (
        <div className="text-center py-8 animate-fade-in">
          <CheckCircle2
            className="w-12 h-12 text-[var(--mp-viridian)] mx-auto mb-3"
            aria-hidden
          />
          <p className="text-base font-semibold text-[var(--mp-fg)]">
            {lang === "de" ? "Vielen Dank!" : "Thank you!"}
          </p>
          <p className="text-sm text-[var(--mp-fg-subtle)] mt-1">
            {lang === "de"
              ? "Dein Feedback wurde gesendet."
              : "Your feedback has been submitted."}
          </p>
        </div>
      ) : !type ? (
        <div className="grid grid-cols-1 gap-3">
          <p className="text-xs text-[var(--mp-fg-muted)] flex items-center gap-1.5">
            <Flag className="w-3.5 h-3.5 text-[var(--mp-error)]" />
            {lang === "de"
              ? "Was möchtest du melden?"
              : "What would you like to report?"}
          </p>
          <button
            type="button"
            onClick={() => setType("flag")}
            className="flex items-center gap-3 p-4 border border-[var(--mp-border)] rounded-xl hover:border-[var(--mp-error)]/40 hover:bg-[var(--mp-error)]/5 transition-all text-left"
          >
            <AlertTriangle
              className="w-6 h-6 text-[var(--mp-error)] flex-shrink-0"
              aria-hidden
            />
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
            type="button"
            onClick={() => setType("edit")}
            className="flex items-center gap-3 p-4 border border-[var(--mp-border)] rounded-xl hover:border-[var(--mp-viridian)]/40 hover:bg-[var(--mp-viridian)]/5 transition-all text-left"
          >
            <Edit3
              className="w-6 h-6 text-[var(--mp-viridian)] flex-shrink-0"
              aria-hidden
            />
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
            <label className="text-[11px] uppercase tracking-wider text-[var(--mp-fg-subtle)] font-semibold mb-2 block">
              {lang === "de" ? "Was ist das Problem?" : "What's wrong?"}
            </label>
            <div className="flex flex-wrap gap-2">
              {FLAG_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setFlagReason(r.value)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                    flagReason === r.value
                      ? "bg-[var(--mp-error)]/10 border-[var(--mp-error)]/40 text-[var(--mp-error)] font-semibold"
                      : "border-[var(--mp-border)] text-[var(--mp-fg-muted)] hover:border-[var(--mp-error)]/30"
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
            placeholder={
              lang === "de"
                ? "Weitere Details (optional)…"
                : "Additional details (optional)…"
            }
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
