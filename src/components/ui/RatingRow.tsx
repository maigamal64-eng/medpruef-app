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
import { BINARY_BUTTON_LABELS } from '@/lib/master-learning/srs'
import { RatingButton } from './RatingButton'

export type RatingName = 'again' | 'hard' | 'good' | 'easy'

const LABELS: Record<RatingName, { de: string; en: string }> = {
  again: { de: 'Nochmal', en: 'Again' },
  hard: { de: 'Schwer', en: 'Hard' },
  good: { de: 'Gut', en: 'Good' },
  easy: { de: 'Einfach', en: 'Easy' },
}

export function ratingLabel(name: RatingName, lang: string): string {
  return LABELS[name][lang === 'de' ? 'de' : 'en']
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
  const de = lang === 'de'
  const binary = BINARY_BUTTON_LABELS[de ? 'de' : 'en']
  return (
    <div role="group" aria-labelledby={id} aria-busy={busy ? true : undefined}>
      <p id={id} className="mb-2 text-center text-sm font-bold text-[var(--mp-fg)]">
        {de ? 'Wie gut wussten Sie es?' : 'How well did you know it?'}
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
              {binary.wrong}
            </RatingButton>
            <RatingButton intensity={2} icon={<CheckCircle2 className="w-4 h-4" />} busy={busy !== null} pressed={busy === 'good'} onClick={() => onRate('good')}>
              {binary.right}
            </RatingButton>
          </div>
          <p className="mt-2 text-center text-xs text-[var(--mp-fg-muted)]">{binary.proNote}.</p>
        </>
      )}
    </div>
  )
}
