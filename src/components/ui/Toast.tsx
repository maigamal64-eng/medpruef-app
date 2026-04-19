'use client'

/**
 * Toast — MPDS v2 transient notification system.
 *
 * Exposes a `<ToastProvider>` that wraps the app (mount once in layout)
 * and a `useToast()` hook that any component can call to push a toast.
 *
 * Usage:
 *   // In RootLayout:
 *   <ToastProvider><App /></ToastProvider>
 *
 *   // In any component:
 *   const toast = useToast()
 *   toast.success("Answer recorded")
 *   toast.error("Could not save")
 *   toast.show({ title: "Translating…", variant: "info", duration: 0 })
 *
 * A11y: toasts render into a single `aria-live="polite"` region so
 * screen readers announce them without interrupting the user. Pause
 * auto-dismiss on hover (pointer users) and on focus (keyboard users).
 *
 * Respects `prefers-reduced-motion` — entrance animation is disabled
 * automatically via the same rule that kills the rest of the app's motion.
 */

import { createContext, useCallback, useContext, useMemo, useState, useRef, useEffect } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type Variant = 'success' | 'error' | 'warning' | 'info'

interface ToastItem {
  id: number
  title: string
  description?: string
  variant: Variant
  duration: number // ms; 0 = no auto-dismiss
}

interface ToastContextValue {
  show: (input: Omit<ToastItem, 'id'>) => number
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

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const show = useCallback((input: Omit<ToastItem, 'id'>) => {
    const id = nextIdRef.current++
    const toast: ToastItem = {
      ...input,
      duration: input.duration ?? DEFAULT_DURATION,
      id,
    }
    setToasts((prev) => [...prev, toast])
    return id
  }, [])

  const success = useCallback(
    (title: string, description?: string) =>
      show({ title, description, variant: 'success', duration: DEFAULT_DURATION }),
    [show]
  )
  const error = useCallback(
    (title: string, description?: string) =>
      show({ title, description, variant: 'error', duration: 6000 }),
    [show]
  )
  const warning = useCallback(
    (title: string, description?: string) =>
      show({ title, description, variant: 'warning', duration: 5000 }),
    [show]
  )
  const info = useCallback(
    (title: string, description?: string) =>
      show({ title, description, variant: 'info', duration: DEFAULT_DURATION }),
    [show]
  )

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
  // IMPORTANT: do NOT gate on `typeof document === 'undefined'` here.
  // This component renders on both server and client via ToastProvider,
  // and a null/div split triggers a hydration mismatch. The region is
  // harmless when empty (fixed-positioned, pointer-events-none) so we
  // render it unconditionally and let the portal-less viewport stay in
  // the React tree. Only individual toasts render once `toasts` grows.
  return (
    <div
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0)' }}
    >
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (toast.duration === 0 || paused) return
    const t = setTimeout(() => onDismiss(toast.id), toast.duration)
    return () => clearTimeout(t)
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
        <div className="font-medium truncate">{toast.title}</div>
        {toast.description && (
          <div className="text-xs opacity-80 truncate">{toast.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="flex-shrink-0 rounded-md p-1 hover:bg-white/10 transition"
      >
        <X className="w-3 h-3" aria-hidden />
      </button>
    </div>
  )
}
