'use client'

/**
 * Dialog — MPDS v2 accessible modal primitive.
 *
 * Replaces the 7 hand-rolled modal chromes across the app with a single
 * a11y-correct primitive. Backed by `.mp-dialog__*` CSS classes in
 * globals.css (tokens-only, dark-mode aware).
 *
 * Usage:
 *   <Dialog open={isOpen} onOpenChange={setOpen} title="Confirm delete">
 *     <p>This cannot be undone.</p>
 *     <DialogFooter>
 *       <button className="mp-btn mp-btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
 *       <button className="mp-btn mp-btn--destructive" onClick={handleDelete}>Delete</button>
 *     </DialogFooter>
 *   </Dialog>
 *
 * A11y guarantees (all baked in — do NOT re-implement per call-site):
 * - Escape closes
 * - Click outside closes (override with closeOnBackdrop={false})
 * - Focus trap cycles inside the dialog
 * - Initial focus lands on first focusable element (or dialog surface if none)
 * - Returns focus to the previously-focused element on close
 * - aria-modal="true", aria-labelledby points at the title
 * - Body scroll locked while open
 * - Respects prefers-reduced-motion
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  /** Prevent backdrop click from closing. Use for destructive confirmations. */
  closeOnBackdrop?: boolean
  /** Prevent Escape from closing. Rarely needed. */
  closeOnEscape?: boolean
  /** Hide the close X button in the header. */
  hideCloseButton?: boolean
  /** max-width override — defaults to 440px. Accepts any CSS length. */
  maxWidth?: string
  /** ARIA description-id for screen readers when description prop isn't enough. */
  ariaDescribedBy?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideCloseButton = false,
  maxWidth,
  ariaDescribedBy,
}: DialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  // Dedicated focus-return effect (post-soft-launch §1.4.6.5).
  //
  // Runs on every `open` transition:
  //   false → true: capture the currently-focused element (the element
  //   that triggered opening the dialog — usually a button) so we can
  //   return focus to it on close.
  //   true → false: if we captured a trigger and it's still attached
  //   to the document, focus it. This ensures keyboard users end up
  //   back where they started — a WCAG 2.4.3 (focus order) requirement.
  //
  // We run this separately from the keydown/scroll-lock effect so the
  // focus-return fires deterministically even if the main effect's
  // cleanup short-circuits (e.g. unmount under React strict-mode double
  // render).
  useEffect(() => {
    if (open) {
      previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    } else if (previousFocusRef.current) {
      const target = previousFocusRef.current
      previousFocusRef.current = null
      if (document.contains(target) && typeof target.focus === 'function') {
        // Tiny rAF delay — React may still be clearing the portal when
        // `open` flips. Deferring one frame lets the trigger element
        // become the stable `document.activeElement` again.
        requestAnimationFrame(() => target.focus())
      }
    }
  }, [open])

  // Escape key + focus trap
  useEffect(() => {
    if (!open) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation()
        onOpenChange(false)
        return
      }
      if (e.key === 'Tab' && surfaceRef.current) {
        const focusables = surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKey)

    // Initial focus — first focusable, or the surface itself
    const focusTimer = setTimeout(() => {
      if (!surfaceRef.current) return
      const focusables = surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (focusables.length > 0) focusables[0].focus()
      else surfaceRef.current.focus()
    }, 0)

    // Body scroll lock
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKey)
      clearTimeout(focusTimer)
      document.body.style.overflow = prevOverflow
      // Focus return is handled by the dedicated effect above.
    }
  }, [open, closeOnEscape, onOpenChange])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const titleId = `mp-dialog-title-${Math.random().toString(36).slice(2, 8)}`

  return createPortal(
    <div
      className="mp-dialog__overlay animate-scale-in"
      role="presentation"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onOpenChange(false)
      }}
    >
      <div
        ref={surfaceRef}
        className="mp-dialog__surface"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
        style={maxWidth ? { maxWidth } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mp-dialog__header">
          <div className="flex-1">
            <h2 id={titleId} className="mp-dialog__title">{title}</h2>
            {description && (
              <p className="text-sm text-[var(--mp-fg-muted)] mt-1">{description}</p>
            )}
          </div>
          {!hideCloseButton && (
            <button
              type="button"
              className="mp-dialog__close"
              onClick={() => onOpenChange(false)}
              aria-label="Close dialog"
            >
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
        {children !== undefined && <div className="mp-dialog__body">{children}</div>}
        {footer && <div className="mp-dialog__footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

/** Convenience wrapper — use inside `<Dialog footer={<DialogFooter>...</DialogFooter>}>`. */
export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
