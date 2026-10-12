/**
 * Entitlements matrix (UX-GLOBAL-19, LX-07): one table of what each audience
 * may use, read by the API gates and by the UI pills. [name]'s open options
 * change a cell here, never a component.
 *
 * Free sample decision (pick-free-features A, [name] 2026-10-11): mistake review
 * and mock exams stay Pro-only for the relaunch; a small free taste is tested
 * after launch. Spaced-repetition review, bookmarks and the answer history are
 * Pro as well. Library notes review is not Pro-gated (STU-56). Pure module: no
 * database, no clock except the optional `now` passed by the caller.
 */
import { isPaidTier, type PaywallGate } from './free-tier';

export type Audience = 'guest' | 'free' | 'trial' | 'pro' | 'lapsed';

export type Feature =
  | 'question_sample'
  | 'full_bank'
  | 'spaced_repetition'
  | 'mistake_review'
  | 'mock_exam'
  | 'bookmarks'
  | 'history'
  /** a24 (pick-ux-exm-38 B): the read-only list of the learner's own exam dates and scores. */
  | 'history_list'
  | 'ai_followup'
  | 'cached_ai_explanation'
  | 'note_review'
  | 'offline_download';

const PRO_ONLY = { guest: false, free: false, trial: true, pro: true, lapsed: false } as const;
const SIGNED_IN = { guest: false, free: true, trial: true, pro: true, lapsed: true } as const;

export const ENTITLEMENTS: Readonly<Record<Feature, Readonly<Record<Audience, boolean>>>> = {
  question_sample: SIGNED_IN,
  full_bank: PRO_ONLY,
  spaced_repetition: PRO_ONLY,
  mistake_review: PRO_ONLY,
  mock_exam: PRO_ONLY,
  bookmarks: PRO_ONLY,
  // Question-by-question review and the answer history stay Pro.
  history: PRO_ONLY,
  // pick-ux-exm-38 B ([name] 2026-10-12): every signed-in learner keeps a
  // read-only list of their own exam dates and scores, lapsed accounts too.
  history_list: SIGNED_IN,
  ai_followup: PRO_ONLY,
  cached_ai_explanation: SIGNED_IN,
  note_review: SIGNED_IN,
  // ACC-35: downloads stay free, limited to the learner's own allowance.
  offline_download: SIGNED_IN,
};

/** The recorded free-sample decision LX-07 asks for. */
export const FREE_SAMPLE_DECISION = {
  id: 'pick-free-features',
  pick: 'A',
  decidedOn: '2026-10-11',
  proOnly: ['mistake_review', 'mock_exam', 'spaced_repetition', 'bookmarks', 'history'] as const satisfies readonly Feature[],
  note: 'Mistake review and mock exams Pro-only for launch; a free taste is tested after launch.',
} as const;

/** pick-ux-exm-38 B: scores free, question-by-question review Pro. */
export const HISTORY_LIST_DECISION = {
  id: 'pick-ux-exm-38',
  pick: 'B',
  decidedOn: '2026-10-12',
  open: 'history_list',
  proOnly: 'history',
} as const satisfies { open: Feature; proOnly: Feature } & Record<string, string>;

export interface AudienceInput {
  signedIn: boolean;
  role?: string | null;
  tier?: string | null;
  tierExpiresAt?: string | null;
  /** True while a no-charge card trial is running. Display only: trial = Pro cells. */
  inTrial?: boolean;
}

export function audienceOf(input: AudienceInput): Audience {
  if (!input.signedIn) return 'guest';
  if (input.role === 'admin') return 'pro';
  if (isPaidTier(input.tier, input.tierExpiresAt)) return input.inTrial ? 'trial' : 'pro';
  // A Pro row whose window ended keeps its history but loses the Pro cells.
  if (input.tier === 'pro' && input.tierExpiresAt) return 'lapsed';
  return 'free';
}

export function canUse(feature: Feature, audience: Audience): boolean {
  return ENTITLEMENTS[feature][audience];
}

export function isProFeature(feature: Feature): boolean {
  return !ENTITLEMENTS[feature].free && ENTITLEMENTS[feature].pro;
}

/** The 402 gate id each API returns for a denied feature. */
export const FEATURE_GATE: Partial<Record<Feature, PaywallGate>> = {
  spaced_repetition: 'spaced_repetition',
  mistake_review: 'wrong_only',
  mock_exam: 'mock_exam',
  bookmarks: 'bookmarks',
  full_bank: 'qbank_limit',
};

/** Quiz practice modes map onto features so /api/questions reads the matrix. */
export function featureForPracticeMode(mode: string | null | undefined): Feature | null {
  if (mode === 'review') return 'spaced_repetition';
  if (mode === 'wrong') return 'mistake_review';
  return null;
}

/** /pricing?gate=<id> carries the gate; unknown values show no line. */
export function featureFromGate(gate: string | null | undefined): Feature | null {
  if (!gate) return null;
  if (gate === 'mistakes' || gate === 'wrong_only') return 'mistake_review';
  if (gate === 'mock_exam') return 'mock_exam';
  if (gate === 'spaced_repetition' || gate === 'review') return 'spaced_repetition';
  if (gate === 'bookmarks') return 'bookmarks';
  if (gate === 'history') return 'history';
  if (gate === 'ai_followup') return 'ai_followup';
  if (gate === 'full_bank') return 'full_bank';
  return null;
}
