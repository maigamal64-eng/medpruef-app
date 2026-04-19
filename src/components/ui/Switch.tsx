'use client'

/**
 * Switch — MPDS v2 toggle primitive (DD-14).
 *
 * Accessible `<button role="switch" aria-checked>` with keyboard +
 * touch handling. Replaces the `<div onClick>` toggles that the v1
 * audit flagged.
 *
 * Usage:
 *   const [on, setOn] = useState(false)
 *   <Switch checked={on} onChange={setOn} label="Dunkelmodus" />
 *
 *   // With a description row:
 *   <Switch
 *     checked={notif}
 *     onChange={setNotif}
 *     label="Tägliche Erinnerung"
 *     description="Wir schicken dir jeden Morgen dein Tagesziel."
 *   />
 */

import { useId } from 'react'

interface SwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  description?: string
  disabled?: boolean
  /** Hide the label visually but keep it for screen readers. */
  hideLabel?: boolean
  className?: string
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  hideLabel,
  className,
}: SwitchProps) {
  const id = useId()
  const descId = description ? `${id}-desc` : undefined

  return (
    <div className={`flex items-start justify-between gap-4 ${className ?? ''}`}>
      {!hideLabel && (
        <label
          htmlFor={id}
          className="flex-1 min-w-0 cursor-pointer select-none"
          onClick={(e) => {
            // Prevent double-fire; the button handles the real toggle.
            if ((e.target as HTMLElement).closest('button[role="switch"]')) return
            if (!disabled) onChange(!checked)
          }}
        >
          <div className="font-medium text-sm text-[var(--mp-fg)]">{label}</div>
          {description && (
            <p id={descId} className="text-xs text-[var(--mp-fg-muted)] mt-0.5 leading-relaxed">
              {description}
            </p>
          )}
        </label>
      )}
      <button
        id={id}
        role="switch"
        type="button"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-describedby={descId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full
          transition-colors duration-150
          focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
          focus-visible:ring-[var(--mp-viridian)] focus-visible:ring-offset-[var(--mp-surface-raised)]
          disabled:opacity-40 disabled:cursor-not-allowed
          ${checked ? 'bg-[var(--mp-viridian)]' : 'bg-[var(--mp-border-strong)]'}
        `}
      >
        <span
          aria-hidden
          className={`
            inline-block h-5 w-5 rounded-full bg-white shadow-sm
            transform transition-transform duration-150
            ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}
          `}
        />
      </button>
    </div>
  )
}
