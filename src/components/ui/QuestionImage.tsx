'use client'

/**
 * QuestionImage — inline question image (UX-GLOBAL-26).
 *
 * - Renders in a fixed aspect-ratio box with a Skeleton while loading, so the
 *   options never move under the thumb (fallback box, object-contain).
 * - fetchpriority high for the current image, decoding async.
 * - Answering works while the image loads or fails.
 * - On error: an inline Alert "Bild konnte nicht geladen werden." with a
 *   44 px "Erneut laden" (keeps the selected answer) and "Problem melden"
 *   prefilled with "Bild fehlt". Offline: "Bild ist auf diesem Gerät nicht
 *   gespeichert."
 * - Tapping opens the shared ImageLightbox (hint "Tippen zum Vergrößern").
 */

import { useEffect, useState } from 'react'
import { ImageOff, Maximize2, RotateCcw } from 'lucide-react'
import { t, useLang } from '@/lib/i18n'
import { Skeleton } from './Skeleton'

export interface QuestionImageProps {
  src: string
  alt: string
  onOpen: () => void
  /** Opens the report form with reason "Bild fehlt". */
  onReport?: () => void
  /** Aspect ratio of the reserved box (width / height). Default 4 / 3. */
  ratio?: number
  className?: string
}

export function QuestionImage({ src, alt, onOpen, onReport, ratio = 4 / 3, className }: QuestionImageProps) {
  const lang = useLang()
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [offline, setOffline] = useState(false)

  useEffect(() => { setStatus('loading'); setAttempt(0) }, [src])
  useEffect(() => {
    if (typeof navigator !== 'undefined') setOffline(!navigator.onLine)
  }, [status])

  const retrySrc = attempt > 0 ? `${src}${src.includes('?') ? '&' : '?'}r=${attempt}` : src

  return (
    <div className={['mb-4', className].filter(Boolean).join(' ')}>
      {status !== 'error' ? (
        <button
          type="button"
          onClick={onOpen}
          className="mp-question-image group"
          style={{ aspectRatio: String(ratio) }}
          aria-label={`${alt}. ${t('image_open_hint', lang)}`}
        >
          {status === 'loading' && <Skeleton className="absolute inset-0 w-full h-full rounded-none" />}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={retrySrc}
            src={retrySrc}
            alt={alt}
            decoding="async"
            // React 19 supports fetchPriority on img.
            fetchPriority="high"
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            className={`absolute inset-0 w-full h-full object-contain ${status === 'loaded' ? '' : 'invisible'}`}
          />
          <span className="mp-question-image__hint">
            <Maximize2 className="w-3.5 h-3.5" aria-hidden />
            {t('image_open_hint', lang)}
          </span>
        </button>
      ) : (
        <div className="mp-alert mp-alert--warning" style={{ aspectRatio: undefined }}>
          <ImageOff className="mp-alert__icon" aria-hidden />
          <div className="flex-1 min-w-0">
            <p className="mp-alert__title">{t(offline ? 'image_offline' : 'image_failed', lang)}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <button
                type="button"
                className="mp-btn mp-btn--secondary"
                onClick={() => { setAttempt((n) => n + 1); setStatus('loading') }}
              >
                <RotateCcw className="w-4 h-4" aria-hidden />
                {t('image_retry', lang)}
              </button>
              {onReport && (
                <button type="button" className="mp-btn mp-btn--text" onClick={onReport}>
                  {t('image_report', lang)}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
