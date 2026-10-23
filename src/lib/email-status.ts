/**
 * One owner for the "this address is proven" write (a-email-status-fix-1022).
 *
 * Why: users.email_status defaults to 'unverified' and, before this fix, no
 * code path ever moved it, so a learner who clicked the confirmation link kept
 * 'unverified' next to a set email_verified_at. Every reader that needs a
 * proven address (Intercom contactEmail, the marketing sender rule) checks
 * both columns, so nobody counted as verified.
 *
 * Rule: a path that proves the learner controls the mailbox (the signed
 * confirmation link of /confirm-email, the single-use link of
 * /api/user/link-email/verify) writes both columns together through
 * provenEmailFields. A path that changes the address (email-update, the admin
 * profile edit) writes unprovenEmailFields. Nothing else marks an address
 * verified: a Whop payer email, a typed address at signup or a Telegram id
 * are not mailbox proof.
 */
export const EMAIL_STATUS_VERIFIED = "valid" as const;
export const EMAIL_STATUS_UNVERIFIED = "unverified" as const;
export const EMAIL_STATUS_BOUNCED = "bounced" as const;

export function provenEmailFields(now: Date): { email_verified_at: string; email_status: typeof EMAIL_STATUS_VERIFIED } {
  return { email_verified_at: now.toISOString(), email_status: EMAIL_STATUS_VERIFIED };
}

export function unprovenEmailFields(): { email_verified_at: null; email_status: typeof EMAIL_STATUS_UNVERIFIED } {
  return { email_verified_at: null, email_status: EMAIL_STATUS_UNVERIFIED };
}

/**
 * A row confirmed earlier whose status was never moved (the 21 Oct
 * confirmations). Healed to 'valid' on a replayed link; a 'bounced' status is
 * never overwritten here, because a bounce may have arrived after the
 * confirmation.
 */
export function needsStatusHeal(row: { email_verified_at: string | null; email_status?: string | null }): boolean {
  return Boolean(row.email_verified_at) && (row.email_status === EMAIL_STATUS_UNVERIFIED || row.email_status == null);
}
