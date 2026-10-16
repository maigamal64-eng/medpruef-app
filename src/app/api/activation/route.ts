import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { checkRateLimit } from "@/lib/rate-limit";
import { readThrough } from "@/lib/data-cache";
import { freeOpeningIds, freeSetIds, freeSetTopicsAtBuild } from "@/lib/free-set";
import { getLearnerMoments } from "@/lib/journey/moments";
import { captureServerError } from "@/lib/sentry-capture";
import {
  FIRST_WIN_SIZE,
  activationEnabled,
  activationSegment,
  activationStage,
  activationWindowEnd,
  inActivationWindow,
  pickStarterIds,
  readingLang,
  reminderHourFor,
  starterHref,
  translatedCount,
} from "@/lib/activation/rules";
import type { TranslationTarget } from "@/lib/explanation-translation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "cache-control": "no-store" };
const BANKS = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
/** Answers read for an account in its first 48 hours; far above any real first two days. */
const ANSWER_READ_LIMIT = 1000;
const TRANSLATED_CACHE_SECONDS = 24 * 60 * 60;

type Db = ReturnType<typeof getServiceClient>;

interface Learner {
  createdAt: string | null;
  activeExam: string | null;
  examDate: string | null;
}

async function readLearner(sb: Db, userId: string): Promise<Learner> {
  const { data, error } = await sb.from("users").select("created_at, active_exam, exam_date").eq("id", userId).maybeSingle();
  if (error) throw error;
  const row = (data ?? {}) as { created_at?: string | null; active_exam?: string | null; exam_date?: string | null };
  return { createdAt: row.created_at ?? null, activeExam: row.active_exam ?? null, examDate: row.exam_date ?? null };
}

/** Distinct questions the learner answered (any bank). One indexed read. */
async function readAnswered(sb: Db, userId: string): Promise<Set<number>> {
  const { data, error } = await sb.from("answer_history").select("question_id").eq("user_id", userId).limit(ANSWER_READ_LIMIT);
  if (error) throw error;
  return new Set(((data ?? []) as { question_id: number | null }[]).map((r) => Number(r.question_id)).filter((n) => Number.isInteger(n) && n > 0));
}

/**
 * Free-set ids of a bank with a cached explanation translation in `lang`.
 * Shared Data Cache, 24 hours per (bank, language); a failed read is never
 * cached and reads as "unknown" (the starter set still forms, unranked).
 */
async function readTranslated(sb: Db, exam: string, lang: TranslationTarget): Promise<Set<number> | null> {
  const ids = [...freeSetIds(exam)];
  if (ids.length === 0) return new Set();
  try {
    const list = await readThrough(
      ["activation-starter-translated", exam, lang],
      async () => {
        const { data, error } = await sb
          .from("question_translations")
          .select("question_id")
          .eq("lang", lang)
          .eq("field", "explanation")
          .in("question_id", ids);
        if (error) throw error;
        return [...new Set(((data ?? []) as { question_id: number }[]).map((r) => Number(r.question_id)))].sort((a, b) => a - b);
      },
      { revalidate: TRANSLATED_CACHE_SECONDS, tags: ["activation:starter-translated"] },
    );
    return new Set(list);
  } catch (err) {
    if (!isDbUnavailable(err)) captureServerError(err, { route: "/api/activation", phase: "translated" });
    return null;
  }
}

/**
 * GET /api/activation?lang=<ui language> (a-activation-48h): the signed-in
 * learner's step in their first 48 hours. {enabled:false} with no read while
 * ACTIVATION_48H_ENABLED is off. Outside the window {stage:"outside"} with no
 * read beyond the auth guard. Inside it: answers so far, whether a sitting is
 * named, the starter set (ids and quiz link) and the reminder hour offered.
 * Counts and ids only; no question text, no learner data beyond the caller's.
 */
export const GET = withDbUnavailable(async (req: NextRequest) => {
  if (!activationEnabled()) return NextResponse.json({ enabled: false }, { headers: noStore });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const gate = checkRateLimit({ key: `activation-read:${guard.userId}`, limit: 60, windowMs: 10 * 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Too many requests", retryAfter: gate.retryAfterSec }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec) } });
  }
  const now = new Date();
  const sb = getServiceClient();
  const learner: Learner = guard.profile
    ? { createdAt: guard.profile.createdAt, activeExam: guard.profile.activeExam, examDate: guard.profile.examDate }
    : await readLearner(sb, guard.userId);

  const inWindow = inActivationWindow(learner.createdAt, now);
  if (!inWindow) return NextResponse.json({ enabled: true, stage: "outside" }, { headers: noStore });

  const exam = learner.activeExam && BANKS.has(learner.activeExam) ? learner.activeExam : "kenntnispruefung";
  const moments = getLearnerMoments({ examDate: learner.examDate, activeExam: learner.activeExam }, now);
  const segment = activationSegment(moments.named?.segment ?? null, learner.activeExam);
  const answeredIds = await readAnswered(sb, guard.userId);
  const answered = answeredIds.size;
  const stage = activationStage({ inWindow, answered });

  let starter: { href: string; ids: number[]; translated: number | null; lang: TranslationTarget | null } | null = null;
  if (stage === "starter" || stage === "continue") {
    const lang = readingLang(req.nextUrl.searchParams.get("lang"));
    const translated = lang ? await readTranslated(sb, exam, lang) : new Set<number>();
    const ids = pickStarterIds({
      opening: freeOpeningIds(exam),
      free: freeSetIds(exam),
      topicOf: freeSetTopicsAtBuild(exam),
      translated: translated ?? new Set(),
      answered: answeredIds,
      size: FIRST_WIN_SIZE - answered,
    });
    if (ids.length > 0) {
      starter = { href: starterHref(exam, ids), ids, translated: translated && lang ? translatedCount(ids, translated) : null, lang };
    }
  }

  const windowEnd = activationWindowEnd(learner.createdAt);
  return NextResponse.json(
    {
      enabled: true,
      stage,
      window_ends_at: windowEnd === null ? null : new Date(windowEnd).toISOString(),
      exam,
      segment,
      answered,
      first_win_size: FIRST_WIN_SIZE,
      named: moments.named !== null,
      starter,
      reminder_hour: reminderHourFor(now),
    },
    { headers: noStore },
  );
});
