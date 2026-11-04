/**
 * a-first-five-1104: the four first-five-minutes changes, each behind its own
 * default-OFF switch. Only the literal "true" turns one on.
 *
 *   NEXT_PUBLIC_SIM_PRO_PILL          client: Pro pill on every exam simulator entry (nav, bottom bar, home tiles)
 *   FIRST_RUN_CONFIRM_CARD_ENABLED    server: the Mentor first-run confirm-email line (reported to the client by /api/auth/me);
 *                                     shows only while MENTOR_WELCOME_ENABLED and EMAIL_CONFIRM_ENABLED are on too
 *   NEXT_PUBLIC_TOPIC_ROLL            client: topic practice rolls into the next topic with free questions
 *   NEXT_PUBLIC_ARRIVAL_EXAM_PICKER   client: exam picker on /landing for campaign arrivals
 *
 * NEXT_PUBLIC values are inlined at build time, so each is read as a literal
 * process.env member; tests pass their own env object.
 */
type Env = Record<string, string | undefined>;

export function simProPillEnabled(env: Env = { NEXT_PUBLIC_SIM_PRO_PILL: process.env.NEXT_PUBLIC_SIM_PRO_PILL }): boolean {
  return env.NEXT_PUBLIC_SIM_PRO_PILL === "true";
}

export function firstRunConfirmEnabled(env: Env = process.env): boolean {
  return env.FIRST_RUN_CONFIRM_CARD_ENABLED === "true";
}

export function topicRollEnabled(env: Env = { NEXT_PUBLIC_TOPIC_ROLL: process.env.NEXT_PUBLIC_TOPIC_ROLL }): boolean {
  return env.NEXT_PUBLIC_TOPIC_ROLL === "true";
}

export function arrivalExamPickerEnabled(env: Env = { NEXT_PUBLIC_ARRIVAL_EXAM_PICKER: process.env.NEXT_PUBLIC_ARRIVAL_EXAM_PICKER }): boolean {
  return env.NEXT_PUBLIC_ARRIVAL_EXAM_PICKER === "true";
}
