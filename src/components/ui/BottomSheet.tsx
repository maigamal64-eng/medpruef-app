'use client'

/**
 * BottomSheet — MPDS v2 accessible slide-in surface.
 *
 * Like <Dialog> but anchored to an edge instead of centered:
 * - Mobile (`<lg`, < 1024px): slides up from the bottom as a sheet,
 *   max-height 85vh, rounded top corners only, with a drag-handle.
 * - Desktop (`>=lg`): slides in from the right as a side drawer,
 *   full viewport height, rounded left corners only, default 420px wide.
 *
 * The picked layout for alt AI-chat-B: content behind stays visible —
 * the backdrop is dimmed but the question card underneath is still
 * partially readable, not hidden by an opaque centered modal.
 *
 * A11y guarantees (all baked in — do NOT re-implement per call-site):
 * - Escape closes (unless `closeOnEscape={false}`)
 * - Click outside closes (unless `closeOnBackdrop={false}`)
 * - Focus trap cycles inside the sheet
 * - Initial focus lands on first focusable element (or surface if none)
 * - Returns focus to the previously-focused element on close
 * - aria-modal="true", aria-labelledby points at the title
 * - Body scroll locked while open
 * - Respects prefers-reduced-motion
 * - Swipe-down on mobile grab handle closes the sheet
 *
 * Usage:
 *   <BottomSheet
 *     open={isOpen}
 *     onOpenChange={setOpen}
 *     title="KI-Erklärung"
 *     description="Bezug: Frage 7 · Kardiologie"
 *     footer={<InputRow onSend={handleSend} />}
 *   >
 *     <MessageList messages={messages} />
 *   </BottomSheet>
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

export type BottomSheetPosition = 'auto' | 'bottom' | 'right'

export interface BottomSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  /**
   * Where to anchor the surface.
   * - "auto" (default): bottom on mobile, right on desktop.
   * - "bottom": always slide up from the bottom.
   * - "right": always slide in from the right.
   */
  position?: BottomSheetPosition
  /** Desktop drawer width. Accepts any CSS length. Default `420px`. */
  width?: string
  /** Prevent backdrop click from closing. */
  closeOnBackdrop?: boolean
  /** Prevent Escape from closing. */
  closeOnEscape?: boolean
  /** Hide the close X button in the header. */
  hideCloseButton?: boolean
  /** ARIA description-id when description prop isn't enough. */
  ariaDescribedBy?: string
  /** Optional className applied to the surface (layout tweaks from call sites). */
  surfaceClassName?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

// Breakpoint aligned with Tailwind's `lg` (1024px).
const DESKTOP_MQ = '(min-width: 1024px)'

function useResolvedPosition(position: BottomSheetPosition): 'bottom' | 'right' {
  const [resolved, setResolved] = useState<'bottom' | 'right'>(() => {
    if (position === 'bottom' || position === 'right') return position
    if (typeof window === 'undefined') return 'bottom'
    return window.matchMedia(DESKTOP_MQ).matches ? 'right' : 'bottom'
  })

  useEffect(() => {
    if (position === 'bottom' || position === 'right') {
      setResolved(position)
      return
    }
    if (typeof window === 'undefined') return
    const mq = window.matchMedia(DESKTOP_MQ)
    const sync = () => setResolved(mq.matches ? 'right' : 'bottom')
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [position])

  return resolved
}

export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  position = 'auto',
  width = '420px',
  closeOnBackdrop = true,
  closeOnEscape = true,
  hideCloseButton = false,
  ariaDescribedBy,
  surfaceClassName,
}: BottomSheetProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const anchor = useResolvedPosition(position)
  const titleId = useId()

  // Swipe-down tracking (mobile only).
  const dragStartY = useRef<number | null>(null)
  const [dragOffset, setDragOffset] = useState(0)

  // Escape key + focus trap + body scroll lock + return focus.
  useEffect(() => {
    if (!open) return

    try {
      previousFocusRef.current = document.activeElement as HTMLElement | null

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

      // Initial focus — first focusable, or the surface itself.
      const focusTimer = setTimeout(() => {
        if (!surfaceRef.current) return
        const focusables = surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)
        if (focusables.length > 0) focusables[0].focus()
        else surfaceRef.current.focus()
      }, 0)

      // Body scroll lock.
      const prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'

      return () => {
        document.removeEventListener('keydown', handleKey)
        clearTimeout(focusTimer)
        document.body.style.overflow = prevOverflow
        if (previousFocusRef.current && document.contains(previousFocusRef.current)) {
          try {
            previousFocusRef.current.focus()
          } catch {
            /* element may be detached; ignore */
          }
        }
        dragStartY.current = null
        setDragOffset(0)
      }
    } catch {
      return
    }
  }, [open, closeOnEscape, onOpenChange])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const isBottom = anchor === 'bottom'

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 27, 61, 0.45)',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: isBottom ? 'flex-end' : 'stretch',
    justifyContent: isBottom ? 'center' : 'flex-end',
    zIndex: 50,
    animation: `mp-bs-fade var(--mp-dur-base, 200ms) var(--mp-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards`,
  }

  const surfaceBase: React.CSSProperties = {
    background: 'var(--mp-surface-raised)',
    boxShadow: 'var(--mp-shadow-modal)',
    display: 'flex',
    flexDirection: 'column',
    outline: 'none',
    overflow: 'hidden',
    position: 'relative',
  }

  const surfaceStyle: React.CSSProperties = isBottom
    ? {
        ...surfaceBase,
        width: '100%',
        maxWidth: '640px',
        maxHeight: '85vh',
        borderTopLeftRadius: 'var(--mp-r-modal)',
        borderTopRightRadius: 'var(--mp-r-modal)',
        transform: `translateY(${dragOffset}px)`,
        transition: dragStartY.current === null
          ? 'transform var(--mp-dur-hero, 400ms) var(--mp-ease-out, cubic-bezier(0.16, 1, 0.3, 1))'
          : 'none',
        animation: dragStartY.current === null
          ? `mp-bs-slide-up var(--mp-dur-hero, 400ms) var(--mp-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards`
          : undefined,
      }
    : {
        ...surfaceBase,
        width,
        maxWidth: '90vw',
        height: '100%',
        borderTopLeftRadius: 'var(--mp-r-modal)',
        borderBottomLeftRadius: 'var(--mp-r-modal)',
        animation: `mp-bs-slide-right var(--mp-dur-hero, 400ms) var(--mp-ease-out, cubic-bezier(0.16, 1, 0.3, 1)) forwards`,
      }

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isBottom) return
    dragStartY.current = e.touches[0].clientY
  }
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isBottom || dragStartY.current === null) return
    const delta = e.touches[0].clientY - dragStartY.current
    if (delta > 0) setDragOffset(delta)
  }
  const handleTouchEnd = () => {
    if (!isBottom || dragStartY.current === null) return
    const finalOffset = dragOffset
    dragStartY.current = null
    if (finalOffset > 120) {
      onOpenChange(false)
    } else {
      setDragOffset(0)
    }
  }

  return createPortal(
    <>
      <style>{`
        @keyframes mp-bs-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes mp-bs-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
        @keyframes mp-bs-slide-right {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-mp-bs="overlay"],
          [data-mp-bs="surface"] {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
      <div
        data-mp-bs="overlay"
        role="presentation"
        style={overlayStyle}
        onClick={(e) => {
          if (closeOnBackdrop && e.target === e.currentTarget) onOpenChange(false)
        }}
      >
        <div
          ref={surfaceRef}
          data-mp-bs="surface"
          className={surfaceClassName}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={ariaDescribedBy}
          tabIndex={-1}
          style={surfaceStyle}
          onClick={(e) => e.stopPropagation()}
        >
          {isBottom && (
            <div
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              aria-hidden
              style={{
                padding: '8px 0 4px',
                display: 'flex',
                justifyContent: 'center',
                cursor: 'grab',
                touchAction: 'none',
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '4px',
                  borderRadius: '2px',
                  background: 'var(--mp-border-strong)',
                  opacity: 0.6,
                }}
              />
            </div>
          )}
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              padding: isBottom ? '4px 20px 12px' : '20px 20px 12px',
              borderBottom: '1px solid var(--mp-border-subtle)',
              flexShrink: 0,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2
                id={titleId}
                style={{
                  fontFamily: 'var(--mp-font-display)',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--mp-fg)',
                  margin: 0,
                  letterSpacing: '-0.01em',
                }}
              >
                {title}
              </h2>
              {description && (
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--mp-fg-muted)',
                    marginTop: '4px',
                    marginBottom: 0,
                    lineHeight: 1.4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {description}
                </p>
              )}
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--mp-fg-subtle)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--mp-surface-sunken)'
                  e.currentTarget.style.color = 'var(--mp-fg)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'var(--mp-fg-subtle)'
                }}
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>
          {children !== undefined && (
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                minHeight: 0,
              }}
            >
              {children}
            </div>
          )}
          {footer && (
            <div
              style={{
                borderTop: '1px solid var(--mp-border-subtle)',
                background: 'var(--mp-surface-raised)',
                flexShrink: 0,
              }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  )
}
