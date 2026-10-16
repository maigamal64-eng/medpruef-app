/** Text-free mentor funnel schema. Turn truth stays in ai_mentor_turn. */
export const MENTOR_CLIENT_EVENTS = [
  "mentor_entry_shown", "mentor_entry_click", "mentor_first_message",
  "mentor_paywall_hit", "mentor_packages_view", "mentor_pkg_click",
  "mentor_checkout_return", "mentor_credits_exhausted", "mentor_resting_view",
  "mentor_report", "mentor_next_step_click", "mentor_next_action_completed",
  // a-mentor-reliability R8: the credit balance load ran out of retries on the client.
  "mentor_usage_failed",
] as const;
export type MentorClientEvent = typeof MENTOR_CLIENT_EVENTS[number];
const VALUES: Record<string, readonly string[]> = {
  entry: ["mentor", "question", "packages", "checkout", "nav", "pill", "home", "explanation", "study_plan", "exam_dates", "pricing", "faq"],
  lang: ["de", "en", "ru", "uk", "tr", "ar"],
  mode: ["facts", "study", "explain"],
  plan_source: ["trial", "pro_included", "admin_included", "whop_payment", "package", "gift", "admin", "none", "mixed"],
  package_id: ["mentor_basis", "mentor_plus", "mentor_topup", "included_pro", "included_admin", "mentor_trial"],
  reason: ["none", "low", "exhausted", "402"],
  from: ["mentor", "question", "packages", "checkout", "nav", "pill", "402", "exhausted"],
  source: ["usage", "402", "final"],
  status: ["pending", "slow", "granted", "failed", "refunded", "needs_manual", "declined"],
  error: ["network", "upstream_error", "reserve_failed", "unknown", "rate_limited"],
  http: ["0", "429", "4xx", "5xx", "2xx"],
  duration: ["under_5s", "5_to_12s", "12_to_28s", "28s_or_more"],
  attempts: ["1", "2", "3", "4"],
  kind: ["practice_topic", "open_mistakes", "open_flashcards", "save_note", "report_question", "practice", "save", "open_question", "open_exam_dates", "open_study_plan", "set_exam_date", "deadline_reminder"],
};
export function isMentorClientEvent(event: string): event is MentorClientEvent {
  return (MENTOR_CLIENT_EVENTS as readonly string[]).includes(event);
}
export function mentorEventData(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    typeof value === "string" && VALUES[key]?.includes(value),
  )) as Record<string, string>;
}
export function mentorCostBucket(micro: number): string {
  return micro <= 0 ? "zero" : micro < 500 ? "under_500_micro_usd" : micro < 5_000 ? "under_5000_micro_usd" : "5000_micro_usd_or_more";
}
