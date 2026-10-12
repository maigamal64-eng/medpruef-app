import type { SupabaseClient } from "@supabase/supabase-js";
import { getTopicCountsCached } from "@/lib/free-tier";
import { getServiceClient } from "@/lib/supabase";
import { GM_BANK, GM_MIN_ACTIVE, GM_TOPIC, isGmPracticeEnabled } from "./index";

/**
 * Whether Gerichtsmedizin practice may be offered (a44): the flag is on AND
 * the bank holds at least GM_MIN_ACTIVE active rows on the topic. Reads the
 * shared 1 h topic-count cache (aggregates only, no question content). A
 * failed read offers nothing, so a public page never promises practice it
 * cannot show.
 */
export async function getGmAvailability(sb: () => SupabaseClient, enabled = isGmPracticeEnabled()): Promise<{ available: boolean; active: number | null }> {
  if (!enabled) return { available: false, active: null };
  try {
    const { data, error } = await getTopicCountsCached(sb(), GM_BANK);
    if (error || !data) return { available: false, active: null };
    const active = data.find((row) => row.topic === GM_TOPIC)?.count ?? 0;
    return { available: active >= GM_MIN_ACTIVE, active };
  } catch {
    return { available: false, active: null };
  }
}

/** The /gerichtsmedizin page's read: service client, shared cache, flag from the build. */
export function gmAvailabilityForPage(): Promise<{ available: boolean; active: number | null }> {
  return getGmAvailability(getServiceClient);
}
