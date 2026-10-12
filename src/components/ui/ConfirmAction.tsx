'use client'

/**
 * ConfirmAction (UX-GLOBAL-18): the one confirm for irreversible, money or
 * access actions. States the consequence in plain words with the resulting
 * values, focuses the safe action, keeps the confirm button pending on itself
 * while the write runs, and in admin can require a one-line reason.
 * Reversible actions do not use this: they run at once with a 10 s undo toast.
 */
import { useEffect, useState } from 'react'
import { Dialog, DialogFooter } from './Dialog'
import { Button } from './Button'

export interface ConfirmActionProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** The consequence, with the values that will result. */
  consequence: string
  confirmLabel: string
  cancelLabel: string
  /** Pending label shown on the confirm button while the write runs. */
  pendingLabel?: string
  destructive?: boolean
  /** Admin actions: a one-line reason is required before confirming. */
  reasonLabel?: string
  pending?: boolean
  onConfirm: (reason?: string) => void
}

export function ConfirmAction({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  destructive,
  reasonLabel,
  pending = false,
  onConfirm,
}: ConfirmActionProps) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (!open) setReason('') }, [open])
  const needsReason = Boolean(reasonLabel)
  const ready = !needsReason || reason.trim().length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={consequence}
      kind="confirm"
      placement="auto"
      busy={pending}
      footer={
        <DialogFooter>
          <Button variant="secondary" data-dialog-safe onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'primary'}
            loading={pending}
            loadingLabel={pendingLabel}
            aria-disabled={!ready || undefined}
            onClick={() => { if (ready) onConfirm(needsReason ? reason.trim() : undefined) }}
          >
            {pending && pendingLabel ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      }
    >
      {needsReason && (
        <label className="mp-field block">
          <span className="mp-field__label">{reasonLabel}</span>
          <input
            className="mp-field__input"
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
    </Dialog>
  )
}
