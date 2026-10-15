/**
 * Launch gate for every public KI-Mentor sentence (a39, MUX-87/88/109, OW-26).
 * Pricing line, ladder, privacy, terms and FAQ copy stay invisible until the
 * build sets NEXT_PUBLIC_MENTOR_PUBLIC_COPY to the literal string "true".
 * Absent, empty or any other value means off. The env name is written out in
 * full so Next.js inlines it into client bundles.
 *
 * Turn it on only together with MENTOR_ACCESS_SCOPE=signed_in (a-mentor-preconds):
 * the FAQ tells every learner they can book Mentor Basis, which is true only
 * when any signed-in account can open the mentor.
 */
export function mentorPublicCopyEnabled(value: string | undefined = process.env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY): boolean {
  return value === "true";
}

/**
 * Second gate for the sentences that say Pro or the Exam Cohort INCLUDE mentor
 * credits (a-mentor-preconds): the /pricing plan-card line, the ladder's Pro
 * detail, the FAQ credits sentence and the terms "included" paragraph. The
 * included grants (ensureIncludedGrants) run only for beta-allowlisted
 * accounts; a Pro learner admitted by MENTOR_ACCESS_SCOPE gets none. Leave
 * NEXT_PUBLIC_MENTOR_INCLUDED_COPY unset until every Pro and Cohort learner
 * receives the included lots; only the literal "true" turns it on, and only
 * while the public copy itself is on.
 *
 * a-free-credit-hooks: the ladder prints the raised defaults (Pro 200, Cohort
 * 400). Turn this on only with MENTOR_INCLUDED_RAISE_ENABLED=true,
 * MENTOR_HOUSE_GRANTS_SCOPE=signed_in and MENTOR_INCLUDED_PRO_CREDITS /
 * MENTOR_INCLUDED_COHORT_CREDITS unset (or equal to those defaults), or the
 * public numbers differ from what is granted.
 */
export function mentorIncludedCopyEnabled(
  value: string | undefined = process.env.NEXT_PUBLIC_MENTOR_INCLUDED_COPY,
  publicCopy: string | undefined = process.env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY,
): boolean {
  return mentorPublicCopyEnabled(publicCopy) && value === "true";
}
