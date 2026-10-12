'use client'

/**
 * ResultCard — one hierarchy for exam results, the quiz round summary and
 * the flashcard or Library session end (UX-GLOBAL-27, closes DD-16).
 *
 * Neutral raised card (no full red, pink or green fill): one hero number with
 * its label, one status chip (icon + word), a save-state chip, one primary
 * action, then the secondary content.
 *
 * Verdict rules (no "Bestehens-" word until [name] confirms the pass rules in
 * the SoT): use resultVerdict() to build the status.
 *   - full Vienna run      'Über 60 %' / 'Unter 60 %' + 'Übungsgrenze dieser Simulation: 60 %'
 *   - part or custom run   neutral 'Übung', no chip
 *   - time-out run         'Zeit abgelaufen'
 * The number is viridian only at or above the threshold of a run that has a
 * verdict, never red. After a fail: one calm line and the next step, no
 * confetti, streak or XP framing.
 */

import { CheckCircle2, CircleDashed, Clock, Info } from 'lucide-react'

export type ResultStatus = 'above' | 'below' | 'practice' | 'timeout'
export type ResultSaveState = 'saved' | 'saving' | 'failed' | 'none'

export interface ResultVerdict {
  status: ResultStatus
  /** Number colour: viridian only for a verdict run at or above the threshold. */
  emphasise: boolean
}

/** Pure verdict rule (unit-tested). */
export function resultVerdict(input: { pct: number; threshold: number; verdictRun: boolean; timedOut: boolean }): ResultVerdict {
  if (input.timedOut) return { status: 'timeout', emphasise: false }
  if (!input.verdictRun) return { status: 'practice', emphasise: false }
  const above = input.pct >= input.threshold
  return { status: above ? 'above' : 'below', emphasise: above }
}

export interface ResultCardProps {
  /** e.g. "66 %" or "14 von 20 richtig". */
  value: string
  /** Label for the hero number, e.g. "Ergebnis". */
  label: string
  status: ResultStatus
  /** Visible status word, e.g. "Über 60 %", "Übung", "Zeit abgelaufen". */
  statusLabel?: string
  emphasise?: boolean
  /** One line under the headline (the practice disclaimer). */
  note?: string
  /** Threshold line for verdict runs. */
  thresholdNote?: string
  saveState?: ResultSaveState
  saveLabel?: string
  /** The one primary action. */
  primary?: React.ReactNode
  /** Counts, breakdown, secondary actions. */
  children?: React.ReactNode
  className?: string
}

const STATUS_ICON: Record<ResultStatus, typeof Info> = {
  above: CheckCircle2,
  below: Info,
  practice: Info,
  timeout: Clock,
}

export function ResultCard({
  value, label, status, statusLabel, emphasise = false, note, thresholdNote,
  saveState = 'none', saveLabel, primary, children, className,
}: ResultCardProps) {
  const Icon = STATUS_ICON[status]
  return (
    <section className={['mp-result-card', className].filter(Boolean).join(' ')} aria-label={label}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mp-result-card__label">{label}</p>
          <p className={`mp-result-card__value ${emphasise ? 'text-[var(--mp-success-text)]' : 'text-[var(--mp-fg)]'}`}>{value}</p>
        </div>
        {saveState !== 'none' && saveLabel && (
          <span className={`mp-result-chip mp-result-chip--save-${saveState}`}>
            {saveState === 'saved' ? <CheckCircle2 className="w-4 h-4" aria-hidden /> : <CircleDashed className="w-4 h-4" aria-hidden />}
            {saveLabel}
          </span>
        )}
      </div>
      {status !== 'practice' && statusLabel && (
        <p className={`mp-result-chip mp-result-chip--${status} mt-3`}>
          <Icon className="w-4 h-4" aria-hidden />
          {statusLabel}
        </p>
      )}
      {status === 'practice' && statusLabel && <p className="mp-result-card__practice mt-3">{statusLabel}</p>}
      {thresholdNote && <p className="mp-result-card__note mt-2">{thresholdNote}</p>}
      {note && <p className="mp-result-card__note mt-1">{note}</p>}
      {primary && <div className="mt-4">{primary}</div>}
      {children && <div className="mt-4">{children}</div>}
    </section>
  )
}
