'use client'

/**
 * RatingRow (UX-GLOBAL-34): one review tray for /flashcards and the Library.
 * The set depends on whether the object has a schedule for this account:
 * four ratings where a schedule exists (Pro questions, every Lernnotiz), two
 * ("Nicht gewusst", "Gewusst") with the Pro line for free question cards.
 * No interval is shown before the tap; afterwards the caller renders the
 * server's result (intervalLabel) in a status line.
 */
import { CheckCircle2, MinusCircle, RotateCcw, XCircle, Zap } from 'lucide-react'
import { t, type Lang } from '@/lib/i18n'
import { RatingButton } from './RatingButton'

export type RatingName = 'again' | 'hard' | 'good' | 'easy'

export function ratingLabel(name: RatingName, lang: string): string {
  return t(`a12_rating_${name}`, lang as Lang)
}

export interface RatingRowProps {
  lang: string
  scheduled: boolean
  /** The rating whose save is in flight, if any. */
  busy: RatingName | null
  onRate: (name: RatingName) => void
  id?: string
}

export function RatingRow({ lang, scheduled, busy, onRate, id = 'rating-row-label' }: RatingRowProps) {
  return (
    <div role="group" aria-labelledby={id} aria-busy={busy ? true : undefined}>
      <p id={id} className="mb-2 text-center text-sm font-bold text-[var(--mp-fg)]">
        {t('a12_rating_question', lang as Lang)}
      </p>
      {scheduled ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {(['again', 'hard', 'good', 'easy'] as const).map((name, i) => (
            <RatingButton
              key={name}
              intensity={i as 0 | 1 | 2 | 3}
              icon={[<RotateCcw key="a" className="w-4 h-4" />, <MinusCircle key="h" className="w-4 h-4" />, <CheckCircle2 key="g" className="w-4 h-4" />, <Zap key="e" className="w-4 h-4" />][i]}
              busy={busy !== null}
              pressed={busy === name}
              onClick={() => onRate(name)}
            >
              {ratingLabel(name, lang)}
            </RatingButton>
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <RatingButton intensity={0} icon={<XCircle className="w-4 h-4" />} busy={busy !== null} pressed={busy === 'again'} onClick={() => onRate('again')}>
              {t('a12_rating_not_knew', lang as Lang)}
            </RatingButton>
            <RatingButton intensity={2} icon={<CheckCircle2 className="w-4 h-4" />} busy={busy !== null} pressed={busy === 'good'} onClick={() => onRate('good')}>
              {t('a12_rating_knew', lang as Lang)}
            </RatingButton>
          </div>
          <p className="mt-2 text-center text-xs text-[var(--mp-fg-muted)]">{t('a12_rating_pro_note', lang as Lang)}</p>
        </>
      )}
    </div>
  )
}
