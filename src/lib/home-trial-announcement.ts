export interface HomeTrialTerms {
  eligible: boolean; trial_enabled: boolean; is_pro: boolean; already_trialed: boolean;
  trial_days: number; price_after_cents: number; currency: string;
  charge_at?: string | null;
}

/** Do not promote a trial until there are real answers and the shared queue is clear. */
export function canShowHomeTrial(terms: HomeTrialTerms | null, queue: {
  ready: boolean; answered: number; activeSurface: string | null;
}): boolean {
  return !!terms && queue.ready && queue.answered >= 5 && queue.activeSurface === null
    && terms.eligible === true && terms.trial_enabled === true && terms.is_pro === false && terms.already_trialed === false
    && terms.currency === 'EUR' && Number.isInteger(terms.price_after_cents) && terms.price_after_cents >= 0
    && Number.isInteger(terms.trial_days) && terms.trial_days > 0;
}
