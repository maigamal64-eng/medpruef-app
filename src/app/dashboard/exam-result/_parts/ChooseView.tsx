"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, Shield, XCircle } from "lucide-react";
import type { Lang } from "@/lib/i18n";
import { puypLocale, tp } from "@/lib/i18n-puyp";
import { Alert, Button } from "@/components/ui";
import { ExamFields } from "./ExamFields";
import { failHelperKey, failPathFor, PUYP_COMPLETION_THRESHOLD_PCT, PUYP_MAX_EXTENSIONS, showsGuaranteePanel, type ExamType, type PuypStatus } from "./rules";

/**
 * The choice: Bestanden (confirmed, idempotent) or Nicht bestanden. The fail
 * button is never dead (pick-ux-exm-46 A): it opens the proof claim when the
 * Kohorte guarantee can pay out, otherwise it records the fail without proof.
 * Every reason sits in visible helper text under the button.
 */
export function ChooseView({
  lang,
  status,
  passPending,
  failPending,
  failError,
  dateError,
  onPass,
  onFail,
  onRetryFail,
  examType,
  setExamType,
  attemptDate,
  setAttemptDate,
}: {
  lang: Lang;
  status: PuypStatus;
  passPending: boolean;
  failPending: boolean;
  failError: boolean;
  dateError?: string;
  onPass: () => void;
  onFail: () => void;
  onRetryFail: () => void;
  examType: ExamType;
  setExamType: (v: ExamType) => void;
  attemptDate: string;
  setAttemptDate: (v: string) => void;
}) {
  const locale = puypLocale(lang);
  const path = failPathFor(status, PUYP_MAX_EXTENSIONS);
  const used = status.subscription?.puyp_extensions_used ?? 0;
  const remaining = Math.max(0, PUYP_MAX_EXTENSIONS - used);
  const pctText = status.qbank_completion_pct.toLocaleString(locale, { maximumFractionDigits: 1 });
  const busy = passPending || failPending;

  return (
    <div className="mp-card p-5 space-y-5">
      {showsGuaranteePanel(status) ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-[var(--mp-viridian)]">
            <Shield size={14} aria-hidden /> <span>{tp("planIncludes", lang)}</span>
          </p>
          {remaining > 0 && (
            <p className="text-sm text-[var(--mp-fg-muted)]">
              {remaining === 1 ? tp("remainingOne", lang) : tp("remainingMany", lang, { n: remaining })}
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg border border-[var(--mp-border)] p-3">
              <dt className="text-[var(--mp-fg-muted)]">{tp("bankProgress", lang)}</dt>
              <dd className="mt-1 font-semibold text-[var(--mp-fg)]">{pctText} %</dd>
              <dd className="text-xs text-[var(--mp-fg-subtle)]">
                {tp("bankAnswered", lang, {
                  answered: status.qbank_answered.toLocaleString(locale),
                  total: status.qbank_total.toLocaleString(locale),
                })}
              </dd>
            </div>
            <div className="rounded-lg border border-[var(--mp-border)] p-3">
              <dt className="text-[var(--mp-fg-muted)]">{tp("extensionsUsed", lang, { used, max: PUYP_MAX_EXTENSIONS })}</dt>
            </div>
          </dl>
        </div>
      ) : (
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {tp("noPlanNote", lang)}{" "}
          <Link href="/pricing" className="inline-flex items-center gap-1 text-[var(--mp-cta-blue)] hover:underline">
            {tp("noPlanLink", lang)} <ArrowRight size={14} aria-hidden />
          </Link>
        </p>
      )}

      <ExamFields
        lang={lang}
        examType={examType}
        setExamType={setExamType}
        attemptDate={attemptDate}
        setAttemptDate={setAttemptDate}
        dateError={dateError}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Button
            type="button"
            variant="primary"
            className="w-full justify-center min-h-[44px]"
            loading={passPending}
            disabled={failPending}
            onClick={onPass}
          >
            <CheckCircle2 size={16} aria-hidden /> {tp("passButton", lang)}
          </Button>
          <p className="mt-2 text-xs text-[var(--mp-fg-subtle)]">{tp("passHelper", lang)}</p>
        </div>
        <div>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-center min-h-[44px]"
            loading={failPending}
            disabled={passPending}
            aria-describedby="puyp-fail-helper"
            onClick={onFail}
          >
            <XCircle size={16} aria-hidden /> {path.mode === "claim" ? tp("failClaimButton", lang) : tp("failRecordButton", lang)}
          </Button>
          <p id="puyp-fail-helper" className="mt-2 text-xs text-[var(--mp-fg-subtle)]">
            {tp(failHelperKey(path), lang, { pct: PUYP_COMPLETION_THRESHOLD_PCT, current: pctText })}
          </p>
        </div>
      </div>

      {failError && !busy && (
        <Alert variant="error" title={tp("failRecordError", lang)}>
          <Button type="button" variant="secondary" className="mt-2 min-h-[44px]" onClick={onRetryFail}>
            {tp("retry", lang)}
          </Button>
        </Alert>
      )}
    </div>
  );
}
