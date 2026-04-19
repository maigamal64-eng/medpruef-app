'use client'

/**
 * Alert — MPDS v2 inline banner primitive.
 *
 * For non-dismissable, non-transient status messages shown inside a flow
 * (above a form, below a header, etc.). For transient notifications use
 * `useToast()` instead.
 *
 * Usage:
 *   <Alert variant="warning" title="Streak endet in 3 Stunden">
 *     Beantworte heute mindestens eine Frage, um deinen 7-Tage-Streak zu halten.
 *   </Alert>
 *
 *   <Alert variant="info" title="Neue Erklärung verfügbar" onClose={() => dismiss()} />
 */

import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react'

type Variant = 'info' | 'success' | 'warning' | 'error'

interface AlertProps {
  variant?: Variant
  title?: string
  children?: React.ReactNode
  onClose?: () => void
  className?: string
  role?: 'status' | 'alert'
}

const iconByVariant = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
}

export function Alert({
  variant = 'info',
  title,
  children,
  onClose,
  className,
  role,
}: AlertProps) {
  const Icon = iconByVariant[variant]
  // "alert" role is appropriate for errors; "status" for informational
  const ariaRole = role ?? (variant === 'error' ? 'alert' : 'status')
  return (
    <div className={`mp-alert mp-alert--${variant} ${className ?? ''}`} role={ariaRole}>
      <Icon className="mp-alert__icon" aria-hidden />
      <div className="flex-1 min-w-0">
        {title && <div className="mp-alert__title">{title}</div>}
        {children && <div className="mp-alert__body">{children}</div>}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="flex-shrink-0 rounded-md p-1 opacity-70 hover:opacity-100 transition"
        >
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
    </div>
  )
}
