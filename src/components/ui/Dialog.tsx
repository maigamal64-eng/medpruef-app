'use client'

/**
 * Dialog — MPDS v2 accessible overlay primitive (UX-GLOBAL-14).
 *
 * One implementation for every modal overlay: paywall, report, confirms,
 * the Mehr sheet, search, admin money dialogs and the image lightbox.
 *
 * Usage:
 *   <Dialog open={isOpen} onOpenChange={setOpen} title="Eintrag löschen?">
 *     <p>Das kann nicht rückgängig gemacht werden.</p>
 *   </Dialog>
 *
 *   // Destructive confirm: focus starts on the safe action, the primary
 *   // stays inert for 800 ms after opening, and `busy` blocks every close
 *   // path while the write runs.
 *   <Dialog open kind="confirm" busy={saving} onOpenChange={setOpen} title="…"
 *     footer={<>
 *       <button data-dialog-safe className="mp-btn mp-btn--secondary">Abbrechen</button>
 *       <button data-dialog-primary className="mp-btn mp-btn--destructive">Löschen</button>
 *     </>}
 *   />
 *
 * Placements: 'center' (default, the legacy look), 'auto' (bottom sheet under
 * 640 px, centred above), 'sheet' (sheet on phones, centred on desktop) and
 * 'fullscreen' (lightbox).
 *
 * Contract baked in (do NOT re-implement per call site):
 * - role=dialog, aria-modal, title and description ids from useId
 * - focus trap; background inert; focus returns to the opener
 * - Escape closes only the topmost overlay (nested dialogs stack)
 * - Android Back / iOS swipe-back close the overlay via a pushed history entry
 * - 44 px close button with a translated name; solid scrim, no blur
 * - sheets close by a swipe on the handle or header, never on the body
 * - overflowing bodies become a named, focusable region
 * - dialogs with inputs follow the visual viewport while an input has focus
 * - `busy` blocks Escape, scrim tap and close while a write runs
 * - `mandatory` has no Escape, no scrim close and no close button
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { t, useLang } from '@/lib/i18n'
import {
  closeOverlayEntry,
  consumeSelfPop,
  isTopOverlay,
  ownsCurrentEntry,
  pushOverlay,
  pushOverlayEntry,
  removeOverlay,
} from '@/lib/overlay-stack'

export type DialogPlacement = 'center' | 'auto' | 'sheet' | 'fullscreen'
/** Initial focus by kind: content focuses the title, form the first field,
 *  confirm the safe action ([data-dialog-safe]). 'auto' picks from the DOM. */
export type DialogKind = 'auto' | 'content' | 'form' | 'confirm'

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
  /** Extra aria-describedby id(s); the description id is always included. */
  ariaDescribedBy?: string
  placement?: DialogPlacement
  kind?: DialogKind
  /** Element to focus first; overrides `kind`. */
  initialFocus?: React.RefObject<HTMLElement | null>
  /** A write is running: no Escape, no scrim close, close button disabled. */
  busy?: boolean
  /** No way to dismiss (e.g. the onboarding exam step). */
  mandatory?: boolean
  /**
   * Close through a pushed history entry on Back. Default: on for sheets and
   * fullscreen overlays (the phone placements), opt-in for centred dialogs.
   * Centred dialogs that navigate programmatically must stay opt-out.
   */
  closeOnBack?: boolean
  /** Visually hide the title (it still names the dialog). */
  hideTitle?: boolean
  className?: string
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** Text-entry fields (a form dialog focuses the first one). Radios and checkboxes are choices, not fields. */
const FIELD = 'input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]):not([disabled]), textarea:not([disabled]), select:not([disabled])'

/**
 * Tab order inside the dialog: visible focusables, with a radio group
 * represented by its checked radio (or its first radio when none is checked).
 */
function tabbables(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
  const seenGroups = new Set<string>()
  const out: HTMLElement[] = []
  for (const el of all) {
    if (el instanceof HTMLInputElement && el.type === 'radio' && el.name) {
      if (seenGroups.has(el.name)) continue
      seenGroups.add(el.name)
      const group = all.filter((x): x is HTMLInputElement => x instanceof HTMLInputElement && x.type === 'radio' && x.name === el.name)
      out.push(group.find((x) => x.checked) ?? group[0])
      continue
    }
    out.push(el)
  }
  return out
}
/** Destructive primary stays inert this long after opening (EXM-19, ACC-46). */
export const CONFIRM_ARM_MS = 800

// Shared background lock: reference-counted so nested dialogs that close out
// of order never unlock the page while another dialog is still open.
const inertCounts = new Map<Element, number>()
let scrollLocks = 0
let scrollRestore = ''
function lockBackground(except: Element): Element[] {
  const locked: Element[] = []
  for (const child of Array.from(document.body.children)) {
    if (child === except || child.contains(except)) continue
    if (child.hasAttribute('data-mp-keep-live')) continue
    const count = inertCounts.get(child) ?? 0
    if (count === 0 && child.hasAttribute('inert')) continue // inert for another reason
    inertCounts.set(child, count + 1)
    child.setAttribute('inert', '')
    locked.push(child)
  }
  if (scrollLocks === 0) { scrollRestore = document.body.style.overflow; document.body.style.overflow = 'hidden' }
  scrollLocks++
  return locked
}
function unlockBackground(locked: Element[]): void {
  for (const el of locked) {
    const count = (inertCounts.get(el) ?? 1) - 1
    if (count <= 0) { inertCounts.delete(el); el.removeAttribute('inert') } else inertCounts.set(el, count)
  }
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = scrollRestore
}

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
  placement = 'center',
  kind = 'auto',
  initialFocus,
  busy = false,
  mandatory = false,
  closeOnBack,
  hideTitle = false,
  className,
}: DialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => { onOpenChangeRef.current = onOpenChange })
  /** Set when an in-dialog link replaced the overlay's history entry. */
  const skipBackRef = useRef(false)
  const busyRef = useRef(busy)
  useEffect(() => { busyRef.current = busy }, [busy])
  const lang = useLang()
  const router = useRouter()
  const reactId = useId()
  const overlayId = `mp-dialog-${reactId}`
  const titleId = `${overlayId}-title`
  const descriptionId = `${overlayId}-desc`
  const [depth, setDepth] = useState(0)
  const [arming, setArming] = useState(false)
  const [bodyScrolls, setBodyScrolls] = useState(false)
  const [viewportStyle, setViewportStyle] = useState<React.CSSProperties | undefined>()

  const dismissible = !mandatory
  const canEscape = dismissible && closeOnEscape
  const canBackdrop = dismissible && closeOnBackdrop
  const showClose = dismissible && !hideCloseButton

  const requestClose = useCallback(() => {
    if (busyRef.current) return
    onOpenChangeRef.current(false)
  }, [])

  // Focus return: capture the opener on open, restore it on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current = (document.activeElement as HTMLElement | null) ?? null
    } else if (previousFocusRef.current) {
      const target = previousFocusRef.current
      previousFocusRef.current = null
      if (document.contains(target) && typeof target.focus === 'function') {
        requestAnimationFrame(() => target.focus())
      }
    }
  }, [open])

  // Stack registration + history entry for Back.
  useEffect(() => {
    if (!open) return
    setDepth(pushOverlay(overlayId))
    const backCloses = closeOnBack ?? placement !== 'center'
    const usesHistory = backCloses && dismissible && typeof window !== 'undefined'
    skipBackRef.current = false
    const hrefAtOpen = typeof window !== 'undefined' ? window.location.href : ''
    if (usesHistory) pushOverlayEntry(overlayId, window.history)
    const onPop = () => {
      // Our own programmatic Back (another overlay closed): not a user Back.
      if (consumeSelfPop()) return
      // Back pressed while this overlay was on top: close it. If a write is
      // running, restore the entry so the overlay stays open.
      if (!isTopOverlay(overlayId)) return
      if (busyRef.current) { pushOverlayEntry(overlayId, window.history); return }
      onOpenChangeRef.current(false)
    }
    if (usesHistory) window.addEventListener('popstate', onPop)
    return () => {
      if (usesHistory) {
        window.removeEventListener('popstate', onPop)
        if (!skipBackRef.current) closeOverlayEntry(overlayId, window.history, window.location, hrefAtOpen)
      }
      removeOverlay(overlayId)
    }
  }, [open, overlayId, closeOnBack, dismissible, placement])

  // Escape (topmost only) + focus trap + scroll lock + inert background.
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (!isTopOverlay(overlayId)) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (canEscape) requestClose()
        return
      }
      if (e.key === 'Tab' && surfaceRef.current) {
        // Manual cycling: the trap never lets focus leave the topmost dialog.
        const list = tabbables(surfaceRef.current)
        e.preventDefault()
        if (list.length === 0) { surfaceRef.current.focus(); return }
        const active = document.activeElement as HTMLElement | null
        let index = active ? list.indexOf(active) : -1
        if (index < 0 && active instanceof HTMLInputElement && active.type === 'radio') {
          index = list.findIndex((el) => el instanceof HTMLInputElement && el.type === 'radio' && el.name === active.name)
        }
        if (index < 0) {
          // Focus is on the title or the surface: Tab starts at the first item.
          ;(e.shiftKey ? list[list.length - 1] : list[0]).focus()
          return
        }
        const next = e.shiftKey ? (index - 1 + list.length) % list.length : (index + 1) % list.length
        list[next].focus()
      }
    }
    document.addEventListener('keydown', handleKey, true)

    const focusTimer = setTimeout(() => {
      const surface = surfaceRef.current
      if (!surface) return
      if (surface.contains(document.activeElement) && document.activeElement !== surface) return
      const pick = (): HTMLElement | null => {
        if (initialFocus?.current) return initialFocus.current
        const field = surface.querySelector<HTMLElement>(FIELD)
        const safe = surface.querySelector<HTMLElement>('[data-dialog-safe]')
        const resolved = kind === 'auto' ? (field ? 'form' : safe ? 'confirm' : 'content') : kind
        if (resolved === 'form') return field ?? surface.querySelector<HTMLElement>(FOCUSABLE)
        if (resolved === 'confirm') return safe ?? surface.querySelector<HTMLElement>('button:not([disabled])')
        return titleRef.current
      }
      ;(pick() ?? surface).focus({ preventScroll: true })
    }, 0)

    // Background inert + scroll lock: every body child except this overlay
    // and the root live regions (they must keep announcing).
    const overlay = overlayRef.current
    const locked = overlay ? lockBackground(overlay) : []

    return () => {
      document.removeEventListener('keydown', handleKey, true)
      clearTimeout(focusTimer)
      unlockBackground(locked)
    }
  }, [open, overlayId, canEscape, requestClose, kind, initialFocus])

  // Destructive confirm: primary inert for 800 ms after opening.
  useEffect(() => {
    if (!open) return
    const surface = surfaceRef.current
    const confirmKind = kind === 'confirm' || (kind === 'auto' && !!surface?.querySelector('[data-dialog-safe]'))
    if (!confirmKind) return
    setArming(true)
    const timer = setTimeout(() => setArming(false), CONFIRM_ARM_MS)
    return () => { clearTimeout(timer); setArming(false) }
  }, [open, kind])

  // Overflowing body becomes a named, focusable region.
  useEffect(() => {
    if (!open) return
    const body = bodyRef.current
    if (!body || typeof ResizeObserver === 'undefined') return
    const check = () => setBodyScrolls(body.scrollHeight > body.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(body)
    return () => observer.disconnect()
  }, [open, children])

  // Dialogs with inputs track the visual viewport while an input has focus.
  useEffect(() => {
    if (!open || placement === 'fullscreen') return
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => {
      const active = document.activeElement
      const typing = !!active && !!surfaceRef.current?.contains(active) && active.matches(FIELD)
      if (!typing) { setViewportStyle(undefined); return }
      setViewportStyle({ maxHeight: Math.max(240, vv.height - 16) })
    }
    vv.addEventListener('resize', update)
    document.addEventListener('focusin', update)
    document.addEventListener('focusout', update)
    return () => {
      vv.removeEventListener('resize', update)
      document.removeEventListener('focusin', update)
      document.removeEventListener('focusout', update)
    }
  }, [open, placement])

  // Swipe-to-close from the handle and header only.
  const dragStart = useRef<number | null>(null)
  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (placement === 'center' || placement === 'fullscreen' || !dismissible) return
    dragStart.current = e.clientY
  }
  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (dragStart.current === null) return
    const dy = e.clientY - dragStart.current
    dragStart.current = null
    if (dy > 80) requestClose()
  }

  if (!open) return null
  if (typeof document === 'undefined') return null

  const describedBy = [description ? descriptionId : null, ariaDescribedBy].filter(Boolean).join(' ') || undefined

  return createPortal(
    <div
      ref={overlayRef}
      className="mp-dialog__overlay animate-scale-in"
      role="presentation"
      data-placement={placement}
      data-stack-depth={depth}
      style={{ ['--mp-dialog-depth' as string]: depth }}
      onClick={(e) => {
        if (canBackdrop && e.target === e.currentTarget) requestClose()
      }}
    >
      <div
        ref={surfaceRef}
        className={['mp-dialog__surface', className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        aria-busy={busy || undefined}
        data-arming={arming || undefined}
        tabIndex={-1}
        style={{ ...(maxWidth ? { maxWidth } : null), ...viewportStyle }}
        onClick={(e) => e.stopPropagation()}
        onClickCapture={(e) => {
          // The armed primary ignores taps for the first 800 ms; busy blocks it.
          const el = e.target as HTMLElement
          const target = el.closest?.('[data-dialog-primary]')
          if (target && (arming || busy)) { e.preventDefault(); e.stopPropagation(); return }
          // An in-app link inside the overlay replaces the overlay's own
          // history entry, so Back from the new page returns to the page
          // under the overlay (no duplicate entry, no double Back).
          const link = el.closest?.('a[href]') as HTMLAnchorElement | null
          if (!link || busy || !dismissible || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return
          let url: URL
          try { url = new URL(link.href, window.location.href) } catch { return }
          if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
          if (!ownsCurrentEntry(overlayId, window.history)) { requestClose(); return }
          // A link to the page under the overlay (or an in-page hash) only closes it.
          if (url.pathname === window.location.pathname && url.search === window.location.search) {
            if (url.hash) return
            e.preventDefault(); requestClose(); return
          }
          e.preventDefault()
          skipBackRef.current = true
          router.replace(url.pathname + url.search + url.hash)
          requestClose()
        }}
      >
        <div className="mp-dialog__handle" aria-hidden onPointerDown={onHandlePointerDown} onPointerUp={onHandlePointerUp} />
        <div className="mp-dialog__header" onPointerDown={onHandlePointerDown} onPointerUp={onHandlePointerUp}>
          <div className="flex-1 min-w-0">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className={hideTitle ? 'mp-sr-only' : 'mp-dialog__title'}>{title}</h2>
            {description && (
              <p id={descriptionId} className="text-sm text-[var(--mp-fg-muted)] mt-1">{description}</p>
            )}
          </div>
          {showClose && (
            <button
              type="button"
              className="mp-dialog__close"
              onClick={requestClose}
              disabled={busy}
              aria-label={t('close', lang)}
            >
              <X className="w-5 h-5" aria-hidden />
            </button>
          )}
        </div>
        {children !== undefined && (
          <div
            ref={bodyRef}
            className="mp-dialog__body"
            {...(bodyScrolls ? { tabIndex: 0, role: 'region', 'aria-label': title } : {})}
          >
            {children}
          </div>
        )}
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
