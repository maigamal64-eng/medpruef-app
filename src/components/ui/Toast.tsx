'use client'

/**
 * Toast — MPDS v2 transient notification system (UX-GLOBAL-15, ACC-43).
 *
 * Mount <ToastProvider> once in the root layout; call useToast() anywhere.
 *
 *   const toast = useToast()
 *   toast.success("Gespeichert")
 *   toast.error("Nicht gespeichert", "Prüfen Sie Ihre Verbindung.")
 *   toast.show({ key: "translate", title: "Wird übersetzt…", variant: "info", duration: 0 })
 *   toast.show({ title: "Entfernt", variant: "info", duration: 10000,
 *     action: { label: "Rückgängig", onClick: undo } })
 *
 * Contract:
 * - keyed: a toast with the same key replaces the previous one, never stacks
 * - at most 3 visible; a 4th drops the oldest non-error first
 * - errors stay at least 10 s (or until dismissed); every toast pauses on
 *   hover and focus
 * - spoken once through announce(): errors assertive, everything else polite.
 *   The toast DOM itself is not a live region, so nothing is read twice.
 * - text wraps (two to three lines), optional action button, 44 px close
 * - docks above the bottom navigation and the sticky action bar
 * - a toast is never the only channel for an error that needs action: show
 *   an inline Alert near the cause as well. Payment errors are never toasts.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'
import { t, useLang } from '@/lib/i18n'
import { announce } from '@/lib/announce'
import { pushToast, type ToastRecord } from '@/lib/toast-queue'

type Variant = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem extends ToastRecord {
  description?: string
  duration: number // ms; 0 = no auto-dismiss
  action?: ToastAction
}

export interface ToastInput {
  title: string
  description?: string
  variant: Variant
  duration?: number
  key?: string
  action?: ToastAction
}

interface ToastContextValue {
  show: (input: ToastInput) => number
  dismiss: (id: number) => void
  success: (title: string, description?: string) => number
  error: (title: string, description?: string) => number
  warning: (title: string, description?: string) => number
  info: (title: string, description?: string) => number
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}

const DEFAULT_DURATION = 4200
export const ERROR_MIN_DURATION = 10000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const show = useCallback((input: ToastInput) => {
    const id = nextIdRef.current++
    const requested = input.duration ?? DEFAULT_DURATION
    const duration = input.variant === 'error' && requested !== 0 ? Math.max(requested, ERROR_MIN_DURATION) : requested
    const toast: ToastItem = {
      id,
      key: input.key,
      variant: input.variant,
      title: input.title,
      description: input.description,
      duration,
      action: input.action,
    }
    setToasts((prev) => pushToast(prev, toast) as ToastItem[])
    announce([input.title, input.description].filter(Boolean).join('. '), input.variant === 'error' ? 'assertive' : 'polite')
    return id
  }, [])

  const success = useCallback((title: string, description?: string) => show({ title, description, variant: 'success' }), [show])
  const error = useCallback((title: string, description?: string) => show({ title, description, variant: 'error', duration: ERROR_MIN_DURATION }), [show])
  const warning = useCallback((title: string, description?: string) => show({ title, description, variant: 'warning', duration: 6000 }), [show])
  const info = useCallback((title: string, description?: string) => show({ title, description, variant: 'info' }), [show])

  const value = useMemo<ToastContextValue>(
    () => ({ show, dismiss, success, error, warning, info }),
    [show, dismiss, success, error, warning, info]
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  const lang = useLang()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  // Portalled to <body> after mount so an open Dialog (which makes the rest
  // of the page inert) keeps toasts and their actions reachable.
  if (!mounted) return null
  return createPortal(
    <div
      data-mp-keep-live=""
      role="region"
      aria-label={t('a11_notifications', lang)}
      className="mp-toast-viewport mp-layer-toast fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      {toasts.map((item) => (
        <ToastView key={item.id} toast={item} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  )
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  const lang = useLang()
  useEffect(() => {
    if (toast.duration === 0 || paused) return
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => clearTimeout(timer)
  }, [toast.id, toast.duration, paused, onDismiss])

  const Icon = {
    success: CheckCircle2,
    error: AlertTriangle,
    warning: AlertTriangle,
    info: Info,
  }[toast.variant]

  return (
    <div
      className={`mp-toast mp-toast--${toast.variant} pointer-events-auto animate-scale-in`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="mp-toast__icon">
        <Icon className="w-3 h-3" aria-hidden />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium mp-toast__text">{toast.title}</div>
        {toast.description && <div className="text-[13px] mp-toast__text mp-toast__desc">{toast.description}</div>}
      </div>
      {toast.action && (
        <button
          type="button"
          className="mp-toast__action"
          onClick={() => { toast.action?.onClick(); onDismiss(toast.id) }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('close', lang)}
        className="mp-toast__close"
      >
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  )
}
