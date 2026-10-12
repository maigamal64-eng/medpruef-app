'use client'

/**
 * Field primitives — MPDS v2 form wrappers.
 *
 * `<TextField>` and `<Textarea>` are the canonical way to render a labeled
 * form control with optional helper text, error state, and required
 * indicator. They wrap `.mp-field__*` CSS classes and forward all native
 * input props, so they drop into any form without extra wiring.
 *
 * Usage:
 *   <TextField
 *     label="E-Mail"
 *     type="email"
 *     required
 *     helper="Wir mailen dir Prüfungsupdates."
 *     error={emailError}
 *     value={email}
 *     onChange={e => setEmail(e.target.value)}
 *   />
 *
 *   <Textarea
 *     label="Feedback"
 *     rows={4}
 *     helper="Optional. Wird an user-b7e46e80@example.com gesendet."
 *   />
 *
 * A11y: label is tied to the input via htmlFor/id; helper + error use
 * aria-describedby; invalid state uses aria-invalid.
 */

import { forwardRef, useId } from 'react'

interface FieldBaseProps {
  label: string
  helper?: string
  error?: string
  required?: boolean
  hideLabel?: boolean
  className?: string
}

export type TextFieldProps = FieldBaseProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'required'> & {
    /** A control inside the field at the inline end (UX-ONB-15 password toggle). */
    end?: React.ReactNode
  }

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, helper, error, required, hideLabel, className, id, end, ...rest }, ref) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`
    const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ') || undefined

    return (
      <div className={`mp-field ${className ?? ''}`}>
        <label
          htmlFor={inputId}
          className={`mp-field__label ${required ? 'mp-field__label--required' : ''} ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
        </label>
        {end ? (
          <div className="relative">
            <input
              ref={ref}
              id={inputId}
              required={required}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              className={`mp-field__input w-full ${error ? 'mp-field__input--error' : ''}`}
              style={{ paddingInlineEnd: 48 }}
              {...rest}
            />
            <span className="absolute inset-y-0 end-0.5 flex items-center">{end}</span>
          </div>
        ) : (
          <input
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className={`mp-field__input ${error ? 'mp-field__input--error' : ''}`}
            {...rest}
          />
        )}
        {error ? (
          <p id={errorId} className="mp-field__helper mp-field__helper--error" role="alert">
            {error}
          </p>
        ) : helper ? (
          <p id={helperId} className="mp-field__helper">
            {helper}
          </p>
        ) : null}
      </div>
    )
  }
)

export type TextareaProps = FieldBaseProps &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'required'>

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, helper, error, required, hideLabel, className, id, ...rest }, ref) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`
    const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ') || undefined

    return (
      <div className={`mp-field ${className ?? ''}`}>
        <label
          htmlFor={inputId}
          className={`mp-field__label ${required ? 'mp-field__label--required' : ''} ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
        </label>
        <textarea
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`mp-field__input ${error ? 'mp-field__input--error' : ''}`}
          style={{ resize: 'vertical', minHeight: '80px' }}
          {...rest}
        />
        {error ? (
          <p id={errorId} className="mp-field__helper mp-field__helper--error" role="alert">
            {error}
          </p>
        ) : helper ? (
          <p id={helperId} className="mp-field__helper">
            {helper}
          </p>
        ) : null}
      </div>
    )
  }
)

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export type SelectProps = FieldBaseProps & {
  options: SelectOption[]
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'required'>

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, helper, error, required, hideLabel, className, options, id, ...rest }, ref) {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`
    const describedBy = [error ? errorId : null, helper ? helperId : null].filter(Boolean).join(' ') || undefined

    return (
      <div className={`mp-field ${className ?? ''}`}>
        <label
          htmlFor={inputId}
          className={`mp-field__label ${required ? 'mp-field__label--required' : ''} ${hideLabel ? 'sr-only' : ''}`}
        >
          {label}
        </label>
        <select
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`mp-field__input ${error ? 'mp-field__input--error' : ''}`}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        {error ? (
          <p id={errorId} className="mp-field__helper mp-field__helper--error" role="alert">
            {error}
          </p>
        ) : helper ? (
          <p id={helperId} className="mp-field__helper">
            {helper}
          </p>
        ) : null}
      </div>
    )
  }
)
