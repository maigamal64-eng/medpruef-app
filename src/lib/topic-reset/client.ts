import { invalidateServerWeaknessCache } from "@/lib/weakness";
import { HOME_LAST_GOOD_KEY } from "@/lib/home-last-good";
import { safeStorage } from "@/lib/safe-storage";

/**
 * After a subject reset: drop every device copy of topic progress so Home,
 * the curriculum and the quiz resume read fresh numbers. Account settings,
 * the session and drafts stay. safeStorage ignores blocked storage.
 */
export const TOPIC_PROGRESS_LOCAL_KEYS = [
  "medpruef_home_study_v1",
  "medpruef_home_topics_v1",
  HOME_LAST_GOOD_KEY,
  "medpruef_quiz_session_v2",
] as const;

export function clearTopicProgressCaches(): void {
  if (typeof window === "undefined") return;
  for (const key of TOPIC_PROGRESS_LOCAL_KEYS) safeStorage.removeItem(key);
  invalidateServerWeaknessCache();
}
