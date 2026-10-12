import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import {
  DEFAULT_EXAM_SOURCE,
  EXAM_SOURCE_IDS,
} from "@/lib/topics";
import { loadFreeAccess, getTopicCountsCached } from "@/lib/free-tier";
import { logFreeCapHit } from "@/lib/free-access";
import {
  OFFLINE_MAX_PER_CALL,
  estimatePackTextBytes,
  nextCursor,
  parseAfterId,
} from "@/lib/offline-pack-rules";

export const dynamic = "force-dynamic";

const OFFLINE_CHUNK_LIMIT = { limit: 300, windowMs: 60 * 60 * 1000 };
const OFFLINE_SUMMARY_LIMIT = { limit: 120, windowMs: 60 * 60 * 1000 };

/**
 * GET /api/offline/questions
 *
 * Returns a batch of active questions for offline use. The client
 * (src/app/settings/page.tsx) calls this when the user taps
 * "Herunterladen", then persists the batch into IndexedDB via
 * src/lib/offlineDb.ts.
 *
 * Query params:
 *   examType — 'kenntnispruefung' | 'kmp_innsbruck' | 'pharma' (default: kenntnispruefung)
 *   count    — integer 1..500 (default: 100, capped at 500 per call)
 *   topic    — optional, narrow to one specialty
 *   afterId  — optional cursor (LX-16): rows with a larger id, ordered by id,
 *              so a whole-topic or whole-bank pack is a run of disjoint chunks
 *   summary  — "1" returns { total, images, estimatedTextBytes, topics } for
 *              the same scope instead of rows (size line before a download)
 *
 * Download responses carry { questions, nextAfterId, sizeBytes, accessUntil,
 * limited }: the next cursor (null on the last chunk), the serialised size of
 * this chunk and the end of the paid access that allowed it. Rate limited per
 * account (429 OFFLINE_RATE_LIMITED).
 *
 * Auth: requireUser — this is a user-specific download action (counts
 * against the session, not anonymous). Guests can't use offline mode
 * because their answers can't be synced back to a real user row.
 *
 * Cache-Control: private, no-store — the response is bound to the
 * caller's session. Middle-boxes must not cache.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const sp = req.nextUrl.searchParams;
  const noStore = { "Cache-Control": "private, no-store, max-age=0" };

  // ── examType validation ──
  const rawExam = sp.get("examType") || DEFAULT_EXAM_SOURCE;
  const examType =
    rawExam === "SIP" ? "kenntnispruefung" : rawExam;
  if (!(EXAM_SOURCE_IDS as readonly string[]).includes(examType)) {
    return NextResponse.json(
      { error: "Invalid examType" },
      { status: 400 },
    );
  }

  // ── count validation (1..500) ──
  const rawCount = parseInt(sp.get("count") || "100", 10);
  if (!Number.isFinite(rawCount) || rawCount < 1) {
    return NextResponse.json(
      { error: "count must be a positive integer" },
      { status: 400 },
    );
  }
  const count = Math.min(OFFLINE_MAX_PER_CALL, Math.max(1, Math.round(rawCount)));

  const afterId = parseAfterId(sp.get("afterId"));
  if (afterId === "invalid") {
    return NextResponse.json({ error: "afterId must be a non-negative integer" }, { status: 400 });
  }

  const rawTopic = sp.get("topic");
  const topic = rawTopic ? rawTopic.slice(0, 200) : null;
  const summary = sp.get("summary") === "1";

  // Per-account bound on pack traffic (a28): a whole Vienna bank is about 76
  // chunks of 100, so 300 chunk calls an hour allow several full downloads.
  const limit = summary ? OFFLINE_SUMMARY_LIMIT : OFFLINE_CHUNK_LIMIT;
  const rl = checkRateLimit({ key: rateKey(summary ? "offline-summary" : "offline-chunk", guard.userId), ...limit });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many offline downloads", code: "OFFLINE_RATE_LIMITED" },
      { status: 429, headers: { ...noStore, "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const sb = getServiceClient();

  // ── Free-tier gate (2026-06-20, free set a-free-set 2026-10-12) ──
  // A free user's offline batch is bounded to what they may read: the free
  // set plus already-answered questions of the old slice, and once capped
  // only answered free questions (rule in src/lib/free-set.ts). The offline
  // path can never be looser than the live questions route. The same bound
  // applies to the summary counts and to every chunk.
  let allowed: number[] | null = null;
  if (isFreeAccess(guard)) {
    const access = await loadFreeAccess(sb, guard.userId, examType);
    if (access.capped && !summary) {
      await logFreeCapHit(sb, {
        userId: guard.userId,
        gate: "qbank_limit",
        route: "/api/offline/questions",
        examType,
        seen: access.counted,
      });
    }
    allowed = access.readable;
    if (allowed.length === 0) {
      return NextResponse.json(
        summary
          ? { total: 0, images: 0, estimatedTextBytes: 0, topics: [], limited: true }
          : { questions: [], nextAfterId: null, sizeBytes: 0, accessUntil: null, limited: true },
        { headers: noStore },
      );
    }
  }

  // One scope for summary and download: active MCQ rows of this exam (open-
  // answer fallbacks are less useful without the server's grading round-trip),
  // optional topic, free slice for free accounts.
  const scoped = (columns: string, head = false) => {
    let q = sb
      .from("questions")
      .select(columns, head ? { count: "exact", head: true } : undefined)
      .eq("is_active", true)
      .eq("exam_type", examType)
      .not("choices", "is", null);
    if (topic) q = q.eq("topic", topic);
    if (allowed) q = q.in("id", allowed);
    return q;
  };

  if (summary) {
    const [totalRes, imageRes, topicRes] = await Promise.all([
      scoped("id", true),
      scoped("id", true).or("image_url.not.is.null,image_urls.not.is.null"),
      allowed
        ? sb.from("questions").select("topic").eq("is_active", true).eq("exam_type", examType).not("choices", "is", null).in("id", allowed)
        : getTopicCountsCached(sb, examType),
    ]);
    if (totalRes.error || imageRes.error || topicRes.error) {
      console.error("[offline/questions summary]", totalRes.error ?? imageRes.error ?? topicRes.error);
      return NextResponse.json({ error: "Query failed" }, { status: 500 });
    }
    const topicCounts = new Map<string, number>();
    for (const row of (topicRes.data ?? []) as unknown as { topic: string; count?: number }[]) {
      if (!row.topic) continue;
      topicCounts.set(row.topic, (topicCounts.get(row.topic) ?? 0) + (row.count != null ? Number(row.count) || 0 : 1));
    }
    const total = totalRes.count ?? 0;
    return NextResponse.json(
      {
        total,
        images: imageRes.count ?? 0,
        estimatedTextBytes: estimatePackTextBytes(total),
        topics: [...topicCounts.entries()]
          .map(([name, n]) => ({ topic: name, count: n }))
          .sort((a, b) => a.topic.localeCompare(b.topic, "de")),
        limited: allowed !== null,
      },
      { headers: noStore },
    );
  }

  let query = scoped(
    "id, topic, question, answer, explanation, ai_explanation, exam_type, choices, image_url, image_urls, exam_dates, tags",
  );
  if (afterId !== null) query = query.gt("id", afterId);

  // Ordered by id so afterId chunks are disjoint and their union is the scope.
  const { data, error } = await query.order("id", { ascending: true }).limit(count);

  if (error) {
    console.error("[offline/questions]", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  const cachedAt = new Date().toISOString();
  const questions = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: row.id as number,
    topic: (row.topic as string) ?? "",
    question: (row.question as string) ?? "",
    answer: (row.answer as string) ?? "",
    explanation: (row.explanation as string | null) ?? null,
    ai_explanation: (row.ai_explanation as string | null) ?? null,
    exam_type: (row.exam_type as string) ?? examType,
    choices: row.choices ?? null,
    image_url: (row.image_url as string | null) ?? null,
    image_urls: (row.image_urls as string[] | null) ?? null,
    exam_dates: (row.exam_dates as string[] | null) ?? [],
    tags: (row.tags as string[] | null) ?? [],
    cached_at: cachedAt,
  }));

  return NextResponse.json(
    {
      questions,
      nextAfterId: nextCursor(questions.map((q) => q.id), count),
      sizeBytes: new TextEncoder().encode(JSON.stringify(questions)).length,
      // Paid packs carry the end of the access that allowed them; the offline
      // quiz stops serving (and clears) the pack after it. null = no end date
      // (admin, open-ended grant) or a free pack (the free slice stays free).
      accessUntil: allowed ? null : guard.tierExpiresAt,
      limited: allowed !== null,
    },
    { headers: noStore },
  );
}
