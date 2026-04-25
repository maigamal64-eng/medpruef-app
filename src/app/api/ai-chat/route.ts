import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// In-memory burst guard on top of the DB-backed daily quota. Catches
// someone calling the endpoint 100 times in a row. The daily
// DAILY_QUOTA_PRO = 50 still applies; this just stops them from
// burning it in 10 seconds.
const AI_CHAT_BURST_LIMIT = { limit: 10, windowMs: 60_000 };

/**
 * AI Explanation + Chat endpoint.
 *
 * 2026-04-15 audit findings this addresses (BE-P0-004 + SEC equivalent
 * + P1-A4 + Infra cost-watch #1):
 *
 * BEFORE:
 *   - Unauthenticated. Anyone with curl could drain the OpenAI/
 *     Anthropic budget in a loop, with no per-user rate limit.
 *   - Accepted a client-controlled `system` prompt → attacker could
 *     jailbreak / reshape the model's behavior with arbitrary
 *     instructions.
 *   - Cached reply overwrote `questions.ai_explanation` for ANY
 *     questionId the caller supplied → content poisoning attack on
 *     any question in the DB.
 *   - No upstream timeout → a slow Anthropic/OpenAI incident would
 *     stall Vercel functions until the platform timeout killed them.
 *
 * AFTER:
 *   - requireUser gate.
 *   - Tier check: 'pro' | 'admin' can generate new explanations.
 *     'free' users can still READ cached (via GET) — they just can't
 *     trigger a new upstream call.
 *   - Per-user daily rate limit: default 50 generations/day for pro.
 *     Counted by a simple `SELECT count(*) FROM answer_history` cheat
 *     (no new table): we count today's aichat feature_use events in
 *     user_events. If the events table is unavailable, the limit still
 *     enforces but fails open with a log.
 *   - System prompt is hard-coded server-side.
 *   - Messages: max 20, each max 4000 chars.
 *   - 20-second AbortController timeout on each upstream fetch.
 *   - Cache write only populates `ai_explanation` when it's currently
 *     null (no overwrite of good existing content).
 */

// Upgraded 2026-04-17 per user feedback (Mounzer 3/5 + Hu "bessere
// Erklärungen"). Enforces strict structure that makes explanations
// easier to skim on mobile: TL;DR → correct answer reasoning →
// distractor-by-distractor breakdown → guideline citation.
const SYSTEM_PROMPT = [
  "You are MedPrüf's AI study tutor for the Austrian Kenntnisprüfung.",
  "Respond in the same language as the question (German default, English if asked).",
  "",
  "MANDATORY FORMAT:",
  "1. Start with a one-sentence **TL;DR** (bold) summarizing the correct answer.",
  "2. Section '**Warum die richtige Antwort**' / '**Why the correct answer**' — 2–4 bullets with clinical/physiological reasoning. Use **bold** for key medical terms.",
  "3. Section '**Warum die anderen falsch sind**' / '**Why the others are wrong**' — one short bullet per distractor naming the specific reason.",
  "4. Where relevant, cite the guideline or source: ERC 2021, ESC, ÖDG, Österreichischer Impfplan, WHO, AGES.",
  "",
  "HARD CONSTRAINTS:",
  "- Max ~400 words total. Fit on a mobile screen.",
  "- Use markdown (**bold**, bullet lists, small tables where helpful).",
  "- Never speculate without evidence. If uncertain, say so explicitly.",
  "- Do NOT regurgitate the question. Go straight to reasoning.",
].join("\n");

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const UPSTREAM_TIMEOUT_MS = 20_000;
const DAILY_QUOTA_PRO = 50;

// GET — Check for cached AI explanation for a question.
// Open to anyone (free + pro + anon) because reading cached content is
// not a cost-runaway vector and the app shows the cached text under
// the normal quiz flow.
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("questionId");
    const questionId = raw ? Number(raw) : NaN;
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return NextResponse.json({ cached: false });
    }

    const db = getServiceClient();
    const { data } = await db
      .from("questions")
      .select("ai_explanation, ai_explanation_generated_at")
      .eq("id", questionId)
      .maybeSingle();

    if (data?.ai_explanation) {
      return NextResponse.json({ cached: true, explanation: data.ai_explanation });
    }
    return NextResponse.json({ cached: false });
  } catch {
    return NextResponse.json({ cached: false });
  }
}

// POST — Generate AI explanation (and cache it).
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId, tier } = guard;

  // Burst guard — stops a single Pro user from slamming the endpoint
  // and burning their daily quota in a programmatic loop.
  const burstGate = checkRateLimit({
    key: rateKey("ai-chat", userId),
    ...AI_CHAT_BURST_LIMIT,
  });
  if (!burstGate.allowed) {
    return NextResponse.json(
      {
        error: "AI chat burst limit reached — please pause a moment before asking again.",
        retryAfter: burstGate.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(burstGate, AI_CHAT_BURST_LIMIT) }
    );
  }

  // Tier gate — only pro + admin (tier OR role) can trigger upstream
  // calls. 2026-04-24: switched from a bare `tier === "free"` check to
  // the canonical `isFreeAccess(guard)` so /admin/ operators with
  // `role='admin'` but `tier='free'` aren't locked out of AI chat.
  if (isFreeAccess(guard)) {
    return NextResponse.json(
      {
        error:
          "AI chat is a Pro feature. You can still read cached explanations — upgrade to ask follow-up questions.",
      },
      { status: 402 },
    );
  }

  // Per-user daily quota check. Uses user_events as a cheap counter.
  try {
    const db = getServiceClient();
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const { count } = await db
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("event_type", "ai_chat_message")
      .gte("created_at", since.toISOString());
    if (typeof count === "number" && count >= DAILY_QUOTA_PRO) {
      return NextResponse.json(
        {
          error: `Daily AI chat quota reached (${DAILY_QUOTA_PRO}). Resets at midnight UTC.`,
        },
        { status: 429 },
      );
    }
  } catch (err) {
    // Fail-open is intentional — we don't want a flaky events table to
    // block Pro users from AI chat. But still ship it to Sentry so we
    // notice if the quota is silently unenforced for long stretches.
    captureServerError(err, {
      route: "/api/ai-chat",
      userId,
      phase: "quota-check",
      failOpen: true,
    });
  }

  let parsed: { messages?: unknown; questionId?: unknown; regenerate?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { messages, questionId, regenerate } = parsed;
  const forceRegenerate = regenerate === true;

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `messages[] max ${MAX_MESSAGES}` },
      { status: 400 },
    );
  }
  // Sanitize + length cap every message. Drop anything we don't recognize.
  const sanitized: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages as unknown[]) {
    if (!m || typeof m !== "object") continue;
    const mo = m as { role?: unknown; content?: unknown };
    if (typeof mo.content !== "string") continue;
    if (mo.content.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json(
        { error: `Each message must be ≤ ${MAX_MESSAGE_CHARS} chars` },
        { status: 400 },
      );
    }
    sanitized.push({
      role: mo.role === "assistant" ? "assistant" : "user",
      content: mo.content,
    });
  }
  if (sanitized.length === 0) {
    return NextResponse.json({ error: "No valid messages" }, { status: 400 });
  }

  const qidNum =
    typeof questionId === "number" && Number.isInteger(questionId) && questionId > 0
      ? questionId
      : null;

  async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...init, signal: controller.signal });
      return r;
    } catch (err) {
      // Upstream (Anthropic/OpenAI) failure — network error or the
      // AbortController firing at the 20s mark. Not a user-caused bug,
      // but we still want the visibility in Sentry so a sustained
      // outage shows up as a cluster.
      captureServerError(err, {
        route: "/api/ai-chat",
        userId,
        phase: "upstream",
        upstream: url,
      });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  let reply = "";

  // Try Anthropic first.
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: sanitized,
      }),
    });
    if (response?.ok) {
      const data = await response.json();
      reply = data.content?.[0]?.text || "";
    }
  }

  // Fall back to OpenAI.
  if (!reply) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          max_tokens: 1024,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...sanitized],
        }),
      });
      if (response?.ok) {
        const data = await response.json();
        reply = data.choices?.[0]?.message?.content || "";
      }
    }
  }

  if (!reply) {
    return NextResponse.json(
      {
        reply:
          "Technisches Problem bei der KI-Generierung. Die Frage und die statische Erklärung funktionieren weiter — bitte später erneut versuchen oder den Fehler über das Feedback-Icon melden.",
      },
      { status: 503 },
    );
  }

  // Cache the explanation ONLY when there isn't one yet (default),
  // OR always overwrite if pro/admin user explicitly requested
  // regenerate=true (bypasses content-poisoning protection because
  // the tier gate already ensures the caller is trusted + has quota).
  // When regenerating, also reset the rating counters so the new
  // explanation is judged on its own merits.
  if (qidNum && sanitized.length === 1) {
    try {
      const db = getServiceClient();
      const { data: existing } = await db
        .from("questions")
        .select("ai_explanation")
        .eq("id", qidNum)
        .maybeSingle();
      const shouldWrite = !existing?.ai_explanation || forceRegenerate;
      if (shouldWrite) {
        const update: Record<string, unknown> = {
          ai_explanation: reply,
          ai_explanation_generated_at: new Date().toISOString(),
        };
        if (forceRegenerate) {
          update.explanation_rating_sum = 0;
          update.explanation_rating_count = 0;
        }
        const { error: cacheErr } = await db
          .from("questions")
          .update(update)
          .eq("id", qidNum);
        if (cacheErr) console.error("[ai-chat] cache write:", cacheErr);
      }
    } catch (err) {
      captureServerError(err, {
        route: "/api/ai-chat",
        userId,
        phase: "cache-write",
        questionId: qidNum,
      });
    }
  }

  return NextResponse.json({ reply });
}
