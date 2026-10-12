/**
 * One destination list for the learner app (UX-GLOBAL-09).
 *
 * The desktop Sidebar and the phone "Mehr" sheet render THIS list, in these
 * groups and this order. The phone BottomNav shows at most five slots
 * including Mehr; the Mehr sheet shows every destination that is not in the
 * bar, in the same group order.
 *
 * Slot set = [name]'s HOME-49 option B (12 Oct 2026, "re-slot in the
 * relaunch, keep a raised centre action, give the mentor a visible slot when
 * it is switched on"): Start, Üben (raised centre), Simulation, Lernplan,
 * Mehr (visual order: Start, Simulation, Üben raised in the centre,
 * Lernplan, Mehr). When the mentor is available for this learner it takes the Lernplan
 * slot and Lernplan stays first in the Mehr sheet, so the bar never exceeds
 * five items at 320 px. Bibliothek and Fortschritt live in Mehr.
 *
 * Pure data + functions (labels are i18n keys) so the slot rules are tested.
 */

import type { TranslationKey } from './i18n'

export type DestinationGroup = 'learn' | 'plan' | 'review' | 'account'

export type DestinationKey =
  | 'home' | 'practice' | 'library' | 'exam' | 'mistakes' | 'mentor'
  | 'study-plan' | 'curriculum'
  | 'progress' | 'stats' | 'history'
  | 'settings' | 'billing' | 'pricing' | 'changelog' | 'referrals' | 'feedback' | 'search'

export interface Destination {
  key: DestinationKey
  group: DestinationGroup
  /** i18n key for the visible label (also the accessible name). */
  labelKey: TranslationKey
  /** Shorter label for the bottom bar slot, when it differs. */
  slotLabelKey?: TranslationKey
  /** Route; absent for actions (feedback, search). */
  href?: string
  /** A window event that opens an overlay instead of navigating. */
  action?: 'open-feedback' | 'open-search'
  /** Route prefixes that make this destination active. */
  activePrefixes?: readonly string[]
  /** Only for learners the server has enabled (mentor) or enrolled (referrals). */
  gated?: 'mentor' | 'referrals'
}

export const GROUP_ORDER: readonly DestinationGroup[] = ['learn', 'plan', 'review', 'account']

export const GROUP_LABEL_KEYS: Record<DestinationGroup, TranslationKey> = {
  learn: 'nav_group_learn',
  plan: 'nav_group_plan',
  review: 'nav_group_review',
  account: 'nav_group_account',
}

/**
 * The practice destination keeps the builder as its first screen
 * (FEEDBACK #4a: choosing Quiz must offer customization).
 */
export const PRACTICE_HREF = '/quiz?setup=1'

export const DESTINATIONS: readonly Destination[] = [
  { key: 'home', group: 'learn', labelKey: 'home', slotLabelKey: 'nav_slot_home', href: '/', activePrefixes: [] },
  { key: 'practice', group: 'learn', labelKey: 'nav_practice', href: PRACTICE_HREF, activePrefixes: ['/quiz'] },
  { key: 'library', group: 'learn', labelKey: 'home_library', href: '/library', activePrefixes: ['/library', '/flashcards'] },
  { key: 'exam', group: 'learn', labelKey: 'nav_exam_simulation', slotLabelKey: 'nav_slot_simulation', href: '/exam', activePrefixes: ['/exam', '/dashboard/exam-result'] },
  { key: 'mistakes', group: 'learn', labelKey: 'mistakes_title', href: '/mistakes', activePrefixes: ['/mistakes'] },
  { key: 'mentor', group: 'learn', labelKey: 'nav_mentor', href: '/mentor', activePrefixes: ['/mentor'], gated: 'mentor' },
  { key: 'study-plan', group: 'plan', labelKey: 'home_study_plan', href: '/study-plan', activePrefixes: ['/study-plan'] },
  { key: 'curriculum', group: 'plan', labelKey: 'curriculum', href: '/curriculum', activePrefixes: ['/curriculum'] },
  { key: 'progress', group: 'review', labelKey: 'progress', href: '/progress', activePrefixes: ['/progress'] },
  { key: 'stats', group: 'review', labelKey: 'stats', href: '/stats', activePrefixes: ['/stats'] },
  { key: 'history', group: 'review', labelKey: 'home_history', href: '/history', activePrefixes: ['/history'] },
  { key: 'settings', group: 'account', labelKey: 'settings', href: '/settings', activePrefixes: ['/settings'] },
  { key: 'billing', group: 'account', labelKey: 'nav_billing', href: '/settings#konto' },
  { key: 'pricing', group: 'account', labelKey: 'home_pricing', href: '/pricing', activePrefixes: ['/pricing'] },
  { key: 'changelog', group: 'account', labelKey: 'home_what_s_new', href: '/changelog', activePrefixes: ['/changelog'] },
  { key: 'referrals', group: 'account', labelKey: 'home_referrals', href: '/referrals', activePrefixes: ['/referrals'], gated: 'referrals' },
  { key: 'feedback', group: 'account', labelKey: 'nav_feedback_help', action: 'open-feedback' },
  { key: 'search', group: 'account', labelKey: 'nav_search', action: 'open-search' },
]

export interface NavGates {
  mentor: boolean
  referrals: boolean
}

export function visibleDestinations(gates: NavGates): Destination[] {
  return DESTINATIONS.filter((d) => !d.gated || gates[d.gated])
}

/**
 * Bottom bar slots, left to right, before the Mehr slot. The raised centre
 * action (Üben) sits in the visual middle of the five items.
 */
export function bottomSlots(gates: NavGates): DestinationKey[] {
  return ['home', 'exam', 'practice', gates.mentor ? 'mentor' : 'study-plan']
}

export const RAISED_SLOT: DestinationKey = 'practice'
export const MAX_BOTTOM_ITEMS = 5 // four slots + Mehr

/** Destinations shown in the Mehr sheet: everything not in the bar. */
export function moreSheetDestinations(gates: NavGates): Destination[] {
  const inBar = new Set(bottomSlots(gates))
  const rest = visibleDestinations(gates).filter((d) => !inBar.has(d.key))
  // Lernplan and Meine Fehler first so they are visible without scrolling.
  const priority: DestinationKey[] = ['study-plan', 'mistakes']
  return [
    ...priority.map((key) => rest.find((d) => d.key === key)).filter((d): d is Destination => !!d),
    ...rest.filter((d) => !priority.includes(d.key)),
  ]
}

export function groupDestinations(list: readonly Destination[]): Array<{ group: DestinationGroup; items: Destination[] }> {
  return GROUP_ORDER
    .map((group) => ({ group, items: list.filter((d) => d.group === group) }))
    .filter((entry) => entry.items.length > 0)
}

/** The Mehr sheet keeps the priority rows on top, then the groups. */
export function groupMoreSheet(gates: NavGates): Array<{ group: DestinationGroup | 'top'; items: Destination[] }> {
  const list = moreSheetDestinations(gates)
  const top = list.filter((d) => d.key === 'study-plan' || d.key === 'mistakes')
  const rest = list.filter((d) => !top.includes(d))
  return [{ group: 'top' as const, items: top }, ...groupDestinations(rest)].filter((g) => g.items.length > 0)
}

export function isDestinationActive(destination: Destination, pathname: string): boolean {
  if (destination.key === 'home') return pathname === '/'
  return (destination.activePrefixes ?? []).some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/') || pathname.startsWith(prefix + '?'))
}

export function activeDestination(pathname: string, gates: NavGates): Destination | undefined {
  return visibleDestinations(gates).find((d) => isDestinationActive(d, pathname))
}

/** Mehr is highlighted while the learner is on one of its pages. */
export function isMoreActive(pathname: string, gates: NavGates): boolean {
  const active = activeDestination(pathname, gates)
  return !!active && !bottomSlots(gates).includes(active.key)
}
