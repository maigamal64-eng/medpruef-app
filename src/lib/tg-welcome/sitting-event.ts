/**
 * The sitting_set event the in-app picker path stores (a-tg-miniapp-welcome).
 * Only a known source writes one, and only for a saved date. `named` says the
 * date is an official sitting (the journey rule, resolveNamedSitting); a custom
 * date stays named:false. Enumerated values only: never the date itself.
 */
import { resolveNamedSitting } from "@/lib/journey/moments";
import { TG_WELCOME_SOURCE, tgMiniappWelcomeEnabled } from "@/lib/tg-welcome";
import { homeCramCardEnabled } from "@/lib/home-cram-card/flag";

/** a-cram-card: the Home cram card names a SIP sitting through the same PATCH (a-release-int-6 seam). */
export const CRAM_CARD_SOURCE = "cram_card";

export const SITTING_SET_EVENT = "sitting_set";
export const SITTING_SET_SOURCES: readonly string[] = [TG_WELCOME_SOURCE, CRAM_CARD_SOURCE];

/**
 * Sources that write a row right now: each only while its own feature flag is
 * on (a-release-int-6 reviewer P3), so with every flag off the PATCH writes no
 * sitting_set row at all.
 */
export function activeSittingSetSources(env: Record<string, string | undefined> = process.env): string[] {
  return SITTING_SET_SOURCES.filter((s) =>
    s === TG_WELCOME_SOURCE ? tgMiniappWelcomeEnabled(env) : s === CRAM_CARD_SOURCE ? homeCramCardEnabled(env) : false,
  );
}

export interface SittingSetData {
  source: string;
  exam: string | null;
  named: boolean;
  segment: string | null;
}

export function sittingSetEventData(args: {
  source: unknown;
  activeExam: string | null;
  examDate: string | null;
  now: Date;
}): SittingSetData | null {
  if (typeof args.source !== "string" || !SITTING_SET_SOURCES.includes(args.source)) return null;
  if (!args.examDate) return null;
  const named = resolveNamedSitting({ examDate: args.examDate, activeExam: args.activeExam }, args.now);
  return { source: args.source, exam: args.activeExam, named: named !== null, segment: named?.segment ?? null };
}
