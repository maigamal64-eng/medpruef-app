import "server-only";
/** Landing read: the free case slug and the case count per subject. Titles and slugs only, no key column. Any failure reads as "no cases". */
import { getServiceClient } from "@/lib/supabase";
import { DE_KP_EXAM_KEY } from "./index";

export interface LandingCases { freeSlug: string | null; total: number }

export async function readLandingCases(): Promise<LandingCases> {
  try {
    const { data, error } = await getServiceClient().from("de_kp_cases").select("slug, is_free").eq("exam_key", DE_KP_EXAM_KEY).eq("is_active", true).range(0, 199);
    if (error || !data) return { freeSlug: null, total: 0 };
    const rows = data as { slug: string; is_free: boolean }[];
    return { freeSlug: rows.find((r) => r.is_free === true)?.slug ?? null, total: rows.length };
  } catch {
    return { freeSlug: null, total: 0 };
  }
}
