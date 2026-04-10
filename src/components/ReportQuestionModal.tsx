"use client";

import { useEffect, useState } from "react";
import { X, Flag, AlertTriangle, Edit3, CheckCircle2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";

type Lang = "de" | "en";

interface Props {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  questionId: number;
  questionText: string;
  explanation: string;
  topic: string;
}

const FLAG_REASONS = [
  { value: "incorrect_answer", de: "Falsche Antwort", en: "Incorrect Answer" },
  { value: "malformed", de: "Fehlerhaft", en: "Malformed" },
  { value: "duplicate", de: "Duplikat", en: "Duplicate" },
  { value: "typo", de: "Tippfehler", en: "Typo" },
  { value: "unclear", de: "Unklar", en: "Unclear" },
  { value: "missing_explanation", de: "Erklärung fehlt", en: "Missing Explanation" },
  { value: "wrong_topic", de: "Falsches Thema", en: "Wrong Topic" },
  { value: "other", de: "Sonstiges", en: "Other" },
];

export default function ReportQuestionModal({
  open,
  onClose,
  lang,
  questionId,
  questionText,
  explanation,
  topic,
}: Props) {
  const [type, setType] = useState<"flag" | "edit" | null>(null);
  const [flagReason, setFlagReason] = useState("");
  const [details, setDetails] = useState("");
  const [editQuestion, setEditQuestion] = useState("");
  const [editExplanation, setEditExplanation] = useState("");
  const [editTopic, setEditTopic] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  // Reset state on open / question change
  useEffect(() => {
    if (open) {
      setType(null);
      setFlagReason("");
      setDetails("");
      setEditQuestion(questionText);
      setEditExplanation(explanation || "");
      setEditTopic(topic);
      setSubmitted(false);
      setLoading(false);
    }
  }, [open, questionId, questionText, explanation, topic]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const submitFlag = async () => {
    if (!flagReason) return;
    setLoading(true);
    try {
      await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          type: "flag",
          reason: flagReason,
          details: details || null,
        }),
      });
      setSubmitted(true);
      trackEvent("feature_use", { feature: "flag_question", reason: flagReason, questionId });
      setTimeout(() => onClose(), 1500);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const submitEdit = async () => {
    const changes: Record<string, string> = {};
    if (editQuestion !== questionText) changes.question = editQuestion;
    if (editExplanation !== (explanation || "")) changes.explanation = editExplanation;
    if (editTopic !== topic) changes.topic = editTopic;
    if (Object.keys(changes).length === 0 && !details) return;
    setLoading(true);
    try {
      await fetch("/api/suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionId,
          type: "edit",
          details: details || null,
          suggestedChanges: Object.keys(changes).length > 0 ? changes : null,
        }),
      });
      setSubmitted(true);
      trackEvent("feature_use", { feature: "suggest_edit", questionId });
      setTimeout(() => onClose(), 1500);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8 bg-[#001B3D]/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-[#1E293B] rounded-2xl shadow-2xl border border-[#E4E9F0] dark:border-[#334155] animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E4E9F0] dark:border-[#334155]">
          <h2 className="text-base font-semibold text-[#1A2B3C] dark:text-[#E2E8F0] flex items-center gap-2">
            <Flag className="w-4 h-4 text-[#D64545]" />
            {lang === "de" ? "Frage melden" : "Report question"}
          </h2>
          <button
            onClick={onClose}
            className="text-[#A0AEC0] hover:text-[#1A2B3C] dark:hover:text-[#E2E8F0] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5">
          {submitted ? (
            <div className="text-center py-8 animate-fade-in">
              <CheckCircle2 className="w-12 h-12 text-[#00A896] mx-auto mb-3" />
              <p className="text-base font-semibold text-[#1A2B3C] dark:text-[#E2E8F0]">
                {lang === "de" ? "Vielen Dank!" : "Thank you!"}
              </p>
              <p className="text-sm text-[#A0AEC0] mt-1">
                {lang === "de" ? "Dein Feedback wurde gesendet." : "Your feedback has been submitted."}
              </p>
            </div>
          ) : !type ? (
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={() => setType("flag")}
                className="flex items-center gap-3 p-4 border border-[#E4E9F0] dark:border-[#334155] rounded-xl hover:border-[#D64545]/40 hover:bg-[#D64545]/5 transition-all text-left"
              >
                <AlertTriangle className="w-6 h-6 text-[#D64545] flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0]">
                    {lang === "de" ? "Problem melden" : "Report a problem"}
                  </p>
                  <p className="text-xs text-[#A0AEC0] mt-0.5">
                    {lang === "de" ? "Fehler, Duplikat, unklar, fehlende Erklärung" : "Error, duplicate, unclear, missing explanation"}
                  </p>
                </div>
              </button>
              <button
                onClick={() => setType("edit")}
                className="flex items-center gap-3 p-4 border border-[#E4E9F0] dark:border-[#334155] rounded-xl hover:border-[#007B5F]/40 hover:bg-[#007B5F]/5 transition-all text-left"
              >
                <Edit3 className="w-6 h-6 text-[#007B5F] flex-shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0]">
                    {lang === "de" ? "Änderung vorschlagen" : "Suggest an edit"}
                  </p>
                  <p className="text-xs text-[#A0AEC0] mt-0.5">
                    {lang === "de" ? "Fragetext oder Erklärung bearbeiten" : "Edit the question or explanation"}
                  </p>
                </div>
              </button>
            </div>
          ) : type === "flag" ? (
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-2 block">
                  {lang === "de" ? "Was ist das Problem?" : "What's wrong?"}
                </label>
                <div className="flex flex-wrap gap-2">
                  {FLAG_REASONS.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => setFlagReason(r.value)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                        flagReason === r.value
                          ? "bg-[#D64545]/10 border-[#D64545]/40 text-[#D64545] font-semibold"
                          : "border-[#E4E9F0] dark:border-[#334155] text-[#4A5568] dark:text-[#A0AEC0] hover:border-[#D64545]/30"
                      }`}
                    >
                      {lang === "de" ? r.de : r.en}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 block">
                  {lang === "de" ? "Details (optional)" : "Details (optional)"}
                </label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={3}
                  className="w-full bg-[#F7F9FC] dark:bg-[#0F172A] border border-[#E4E9F0] dark:border-[#334155] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] dark:text-[#E2E8F0] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#D64545]/30"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={submitFlag}
                  disabled={!flagReason || loading}
                  className="btn-primary text-sm px-5 py-2.5 rounded-xl disabled:opacity-40"
                >
                  {loading ? "..." : lang === "de" ? "Senden" : "Submit"}
                </button>
                <button
                  onClick={() => setType(null)}
                  className="text-sm text-[#A0AEC0] hover:text-[#4A5568] dark:hover:text-[#E2E8F0] px-3 py-2.5"
                >
                  {t("cancel", lang)}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 block">
                  {lang === "de" ? "Fragetext" : "Question text"}
                </label>
                <textarea
                  value={editQuestion}
                  onChange={(e) => setEditQuestion(e.target.value)}
                  rows={3}
                  className="w-full bg-[#F7F9FC] dark:bg-[#0F172A] border border-[#E4E9F0] dark:border-[#334155] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] dark:text-[#E2E8F0] resize-none focus:outline-none focus:border-[#007B5F]/30"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 block">
                  {lang === "de" ? "Erklärung" : "Explanation"}
                </label>
                <textarea
                  value={editExplanation}
                  onChange={(e) => setEditExplanation(e.target.value)}
                  rows={4}
                  placeholder={lang === "de" ? "Erklärung hinzufügen oder bearbeiten…" : "Add or edit explanation…"}
                  className="w-full bg-[#F7F9FC] dark:bg-[#0F172A] border border-[#E4E9F0] dark:border-[#334155] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] dark:text-[#E2E8F0] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/30"
                />
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 block">
                  {lang === "de" ? "Was hast du geändert? (optional)" : "What did you change? (optional)"}
                </label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={2}
                  className="w-full bg-[#F7F9FC] dark:bg-[#0F172A] border border-[#E4E9F0] dark:border-[#334155] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] dark:text-[#E2E8F0] placeholder-[#A0AEC0] resize-none focus:outline-none focus:border-[#007B5F]/30"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={submitEdit}
                  disabled={loading}
                  className="btn-primary text-sm px-5 py-2.5 rounded-xl disabled:opacity-40"
                >
                  {loading ? "..." : lang === "de" ? "Vorschlag senden" : "Submit suggestion"}
                </button>
                <button
                  onClick={() => setType(null)}
                  className="text-sm text-[#A0AEC0] hover:text-[#4A5568] dark:hover:text-[#E2E8F0] px-3 py-2.5"
                >
                  {t("cancel", lang)}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
