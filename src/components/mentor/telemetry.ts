"use client";
import { trackEvent } from "@/lib/tracker";
import { mentorEventData, type MentorClientEvent } from "@/lib/mentor/telemetry";
const seen = new Set<string>();
export function trackMentor(event: MentorClientEvent, data: Record<string, unknown> = {}) {
  trackEvent(event, mentorEventData(data));
}
/** Only existing learner/session identity is used, never sent in event data. */
export function trackMentorOnce(userId: string, event: MentorClientEvent, surface: string, data: Record<string, unknown> = {}) {
  if (!userId) return;
  const key = `${userId}:${event}:${surface}`;
  if (seen.has(key)) return;
  try {
    if (sessionStorage.getItem(`mentor_event:${key}`) === "1") { seen.add(key); return; }
    sessionStorage.setItem(`mentor_event:${key}`, "1");
  } catch { /* Memory still deduplicates when storage is unavailable. */ }
  seen.add(key);
  trackMentor(event, data);
}
/** a-mentor-question-entry-v2: a nav tap into /mentor (no impression; the nav is always there). */
export function trackMentorNavClick() {
  trackMentor("mentor_entry_click", { entry: "nav" });
}
