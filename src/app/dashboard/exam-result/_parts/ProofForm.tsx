"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Camera, FileText, Upload, X } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { puypLang, puypLocale, tp, type PuypKey } from "@/lib/i18n-puyp";
import { puypConditions } from "@/lib/puyp-copy";
import { Alert, Button } from "@/components/ui";
import { ExamFields } from "./ExamFields";
import {
  downscaleProof,
  formatFileSize,
  proofProblem,
  PUYP_COMPLETION_THRESHOLD_PCT,
  type ExamType,
  type PuypStatus,
} from "./rules";

/**
 * Proof claim for the Kohorte guarantee (EXM-47). The photo is prepared once
 * on selection (EXIF upright, at most 2000 px, JPEG 0.8, original kept when
 * decoding fails) and checked against 10 MB before it is accepted. The file
 * and the form survive any failure; a retry reuses the same action key.
 */
export function ProofForm({
  lang,
  status,
  examType,
  setExamType,
  attemptDate,
  setAttemptDate,
  proofFile,
  setProofFile,
  submitting,
  uploadError,
  onSubmit,
  onCancel,
}: {
  lang: Lang;
  status: PuypStatus;
  examType: ExamType;
  setExamType: (v: ExamType) => void;
  attemptDate: string;
  setAttemptDate: (v: string) => void;
  proofFile: File | null;
  setProofFile: (f: File | null) => void;
  submitting: boolean;
  uploadError: PuypKey | null;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const locale = puypLocale(lang);
  const [preparing, setPreparing] = useState(false);
  const [selectError, setSelectError] = useState<PuypKey | null>(null);
  const [fieldError, setFieldError] = useState<PuypKey | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compressed, setCompressed] = useState(false);
  const preparingRef = useRef(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // One object URL per image proof; revoked on change and on unmount.
  useEffect(() => {
    if (!proofFile || !proofFile.type.startsWith("image/")) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(proofFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  async function onSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const picked = input.files?.[0] ?? null;
    input.value = ""; // the same file can be picked again after a remove
    if (!picked || preparingRef.current) return;
    preparingRef.current = true; // one photo decoded at a time
    setPreparing(true); setSelectError(null); setFieldError(null);
    try {
      const prepared = await downscaleProof(picked);
      const problem = proofProblem(prepared);
      if (problem) { setSelectError(problem); return; }
      setCompressed(prepared !== picked);
      setProofFile(prepared);
    } finally {
      preparingRef.current = false;
      setPreparing(false);
    }
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submitting || preparing) return;
    if (!attemptDate) { setFieldError("attemptDateMissing"); return; }
    if (!proofFile) { setFieldError("proofMissing"); return; }
    setFieldError(null);
    onSubmit();
  }

  const pct = status.qbank_completion_pct.toLocaleString(locale, { maximumFractionDigits: 1 });
  const proofReview = puypConditions(puypLang(lang))[1]?.value;
  const fileLineError = selectError ?? (fieldError === "proofMissing" ? fieldError : null);

  return (
    <form onSubmit={submit} noValidate className="mp-card p-5 space-y-4" aria-labelledby="puyp-proof-title" aria-busy={submitting || undefined}>
      <h2 id="puyp-proof-title" className="mp-h3">{tp("proofTitle", lang)}</h2>
      <p className="text-sm text-[var(--mp-fg-muted)]">
        {tp("proofIntro", lang)} {proofReview}
      </p>

      <Alert variant="info" title={tp("proofWhatCountsTitle", lang)}>
        {tp("proofWhatCounts", lang)}
      </Alert>

      <ExamFields
        lang={lang}
        required
        examType={examType}
        setExamType={setExamType}
        attemptDate={attemptDate}
        setAttemptDate={setAttemptDate}
        dateError={fieldError === "attemptDateMissing" ? tp("attemptDateMissing", lang) : undefined}
      />

      <div className="mp-field">
        <span id="puyp-proof-label" className="mp-field__label mp-field__label--required">{tp("proofFile", lang)}</span>
        {proofFile ? (
          <div className="mp-card p-3 flex items-center gap-3" aria-labelledby="puyp-proof-label">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={previewUrl} alt="" className="w-11 h-11 rounded-md object-cover flex-shrink-0" />
            ) : (
              <span className="w-11 h-11 rounded-md bg-[var(--mp-cta-blue)]/10 flex items-center justify-center flex-shrink-0">
                <FileText size={18} className="text-[var(--mp-cta-blue)]" aria-hidden />
              </span>
            )}
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-medium text-[var(--mp-fg)] truncate">{proofFile.name}</p>
              <p className="text-xs text-[var(--mp-fg-subtle)]">
                {formatFileSize(proofFile.size, locale)}
                {compressed ? `, ${tp("proofCompressed", lang)}` : ""}
              </p>
            </div>
            <button
              type="button"
              className="mp-btn mp-btn--ghost min-h-[44px] min-w-[44px] justify-center"
              aria-label={tp("proofRemove", lang)}
              disabled={submitting}
              onClick={() => { setProofFile(null); setCompressed(false); }}
            >
              <X size={18} aria-hidden />
            </button>
          </div>
        ) : (
          <p className="text-sm text-[var(--mp-fg-subtle)]">{tp("proofNone", lang)}</p>
        )}

        <div className="flex flex-col sm:flex-row gap-2 mt-2">
          <Button type="button" variant="secondary" className="min-h-[44px] justify-center" loading={preparing} disabled={submitting} onClick={() => photoInput.current?.click()}>
            <Camera size={16} aria-hidden /> {tp("proofTakePhoto", lang)}
          </Button>
          <Button type="button" variant="secondary" className="min-h-[44px] justify-center" disabled={submitting || preparing} onClick={() => fileInput.current?.click()}>
            <Upload size={16} aria-hidden /> {proofFile ? tp("proofReplace", lang) : tp("proofChooseFile", lang)}
          </Button>
        </div>
        <input ref={photoInput} type="file" accept="image/*" capture="environment" onChange={onSelect} className="sr-only" tabIndex={-1} aria-hidden />
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf" onChange={onSelect} className="sr-only" tabIndex={-1} aria-hidden />
        {preparing && <p className="mp-field__helper" role="status">{tp("proofPreparing", lang)}</p>}
        {fileLineError ? (
          <p className="mp-field__helper mp-field__helper--error" role="alert">{tp(fileLineError, lang)}</p>
        ) : (
          <p className="mp-field__helper">{tp("proofPrivate", lang)}</p>
        )}
      </div>

      <p className="text-xs text-[var(--mp-fg-subtle)] border-t border-[var(--mp-border)] pt-3">
        {tp("proofSnapshot", lang, { pct })}
      </p>

      {submitting && (
        <div role="status" className="space-y-2">
          <div
            role="progressbar"
            aria-label={tp("proofUploading", lang)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--mp-border)]"
          >
            <div className="h-full w-full rounded-full bg-[var(--mp-viridian)] animate-pulse" />
          </div>
          <p className="text-xs text-[var(--mp-fg-muted)]">{tp("proofUploadingHint", lang)}</p>
        </div>
      )}

      {uploadError && !submitting && (
        <Alert variant="error" title={tp("uploadErrorTitle", lang)}>
          <p>{tp(uploadError, lang, { pct: PUYP_COMPLETION_THRESHOLD_PCT })}</p>
          <Button type="button" variant="secondary" className="mt-2 min-h-[44px]" onClick={() => submit()}>
            {tp("retry", lang)}
          </Button>
        </Alert>
      )}

      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button type="submit" variant="primary" className="flex-1 justify-center min-h-[44px]" loading={submitting} loadingLabel={tp("proofUploading", lang)} disabled={preparing}>
          {submitting ? tp("proofUploading", lang) : tp("proofSubmit", lang)} {!submitting && <ArrowRight size={14} aria-hidden />}
        </Button>
        <Button type="button" variant="ghost" className="min-h-[44px] justify-center" onClick={onCancel} disabled={submitting}>
          {tp("back", lang)}
        </Button>
      </div>
    </form>
  );
}
