import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { addBreadcrumb, captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// In-memory burst guard on top of the DB-backed daily quota. Catches
// someone calling the endpoint 100 times in a row.
const AI_CHAT_BURST_LIMIT = { limit: 10, windowMs: 60_000 };

// ────────────────────────────────────────────────────────────────────
// Feature flags (read once at module load).
// All optional — defaults are conservative: features ON, auto routing,
// 15/day quota for paid users.
//
// Wave 2026-04-28 added the kill-switch + provider-mode after the
// Anthropic OAuth token investigation (see AI-OAUTH-TEST-2026-04-28.md):
// OAuth subscription tokens (`sk-ant-oat01-*`) are NOT usable against
// /v1/messages for third-party apps. Production runs in `openai` mode
// until Stripe Atlas clears + we provision a real ANTHROPIC_API_KEY.
// ────────────────────────────────────────────────────────────────────
const AI_FEATURES_ENABLED = (process.env.AI_FEATURES_ENABLED ?? "true") === "true";
type ProviderMode = "auto" | "claude_oauth" | "openai" | "disabled";
const AI_PROVIDER_MODE: ProviderMode =
  (process.env.AI_PROVIDER_MODE as ProviderMode | undefined) ?? "auto";
const AI_DAILY_QUOTA_PAID = (() => {
  const raw = Number(process.env.AI_DAILY_QUOTA_PAID);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 15;
})();
const AI_PRIMARY_MODEL = process.env.AI_PRIMARY_MODEL || "claude-sonnet-4-6";
const AI_FALLBACK_MODEL = process.env.AI_FALLBACK_MODEL || "gpt-4o-mini";

// Token-cost rates per 1M tokens (USD). Approximate; used only for the
// audit table's cost_usd column. Update when pricing changes.
const COST_RATES_PER_M: Record<string, { in: number; out: number }> = {
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-sonnet-4-5": { in: 3.0, out: 15.0 },
  "claude-haiku-4-5": { in: 0.8, out: 4.0 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10.0 },
};
function estimateCostUsd(model: string, inTok: number | null, outTok: number | null): number | null {
  const rate = COST_RATES_PER_M[model];
  if (!rate || inTok == null || outTok == null) return null;
  return Number(((inTok * rate.in + outTok * rate.out) / 1_000_000).toFixed(6));
}

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
  const startedAt = Date.now();
  addBreadcrumb({ category: "ai-chat", message: "request_received" });

  // ──────────────────────────────────────────────────────────────────
  // GATE 1: hard kill switch.
  // Set AI_FEATURES_ENABLED=false to immediately disable AI for everyone.
  // Returns 503 with a generic message; the client falls back gracefully
  // (showing only cached explanations). Use this when a provider has an
  // outage / runaway cost / abuse incident.
  // ──────────────────────────────────────────────────────────────────
  if (!AI_FEATURES_ENABLED || AI_PROVIDER_MODE === "disabled") {
    addBreadcrumb({ category: "ai-chat", message: "kill_switch_active", level: "warning" });
    return NextResponse.json(
      { error: "ai_disabled", message: "AI features are temporarily paused." },
      { status: 503 },
    );
  }

  const guard = await requireUser(req);
  if ("error" in guard) {
    addBreadcrumb({ category: "ai-chat", message: "auth_failed", level: "warning" });
    return guard.error;
  }
  const { userId, tier } = guard;
  addBreadcrumb({ category: "ai-chat", message: "auth_resolved", data: { userId, tier } });

  // Burst guard — stops a single Pro user from slamming the endpoint
  // and burning their daily quota in a programmatic loop.
  const burstGate = checkRateLimit({
    key: rateKey("ai-chat", userId),
    ...AI_CHAT_BURST_LIMIT,
  });
  if (!burstGate.allowed) {
    addBreadcrumb({
      category: "ai-chat",
      message: "burst_limited",
      level: "warning",
      data: { retryAfter: burstGate.retryAfterSec },
    });
    return NextResponse.json(
      {
        error: "AI chat burst limit reached, please pause a moment before asking again.",
        retryAfter: burstGate.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(burstGate, AI_CHAT_BURST_LIMIT) },
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // GATE 2: tier check.
  // Free users (no active paid subscription, no admin role, no gifted
  // Pro) can still READ cached explanations via GET, but cannot trigger
  // a new upstream call. Admins always pass (`isFreeAccess` returns
  // false for `role='admin'` regardless of tier).
  // ──────────────────────────────────────────────────────────────────
  if (isFreeAccess(guard)) {
    addBreadcrumb({
      category: "ai-chat",
      message: "tier_gate_blocked",
      level: "warning",
      data: { tier },
    });
    return NextResponse.json(
      {
        error: "upgrade_required",
        message:
          "AI features are available on paid plans starting at €9. Upgrade to continue.",
      },
      { status: 402 },
    );
  }
  addBreadcrumb({ category: "ai-chat", message: "tier_check_passed" });

  // ──────────────────────────────────────────────────────────────────
  // GATE 3: per-user daily quota.
  // Counts ai_call_log rows where (created_at AT TIME ZONE 'Europe/Vienna')::date
  // matches today-in-Vienna. Resets at 00:00 Europe/Vienna.
  // Falls open on DB error so a flaky table doesn't block paying users,
  // but ships a Sentry breadcrumb so silent under-enforcement surfaces.
  // ──────────────────────────────────────────────────────────────────
  try {
    const db = getServiceClient();
    // Compute Vienna-local "today" boundary in UTC for the count window.
    // We use a Postgres-side filter on the (created_at AT TIME ZONE 'Europe/Vienna')::date
    // expression via a date literal computed client-side.
    const viennaNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Europe/Vienna" }),
    );
    const viennaY = viennaNow.getFullYear();
    const viennaM = String(viennaNow.getMonth() + 1).padStart(2, "0");
    const viennaD = String(viennaNow.getDate()).padStart(2, "0");
    const viennaDate = `${viennaY}-${viennaM}-${viennaD}`;

    const { count, error: countErr } = await db
      .from("ai_call_log")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", `${viennaDate}T00:00:00+02:00`)
      .lt("created_at", `${viennaDate}T23:59:59.999+02:00`);

    if (countErr) {
      // Fail-open with telemetry — see comment block above.
      captureServerError(countErr, {
        route: "/api/ai-chat",
        userId,
        phase: "quota-check",
        failOpen: true,
      });
    } else if (typeof count === "number" && count >= AI_DAILY_QUOTA_PAID) {
      addBreadcrumb({
        category: "ai-chat",
        message: "quota_exceeded",
        level: "warning",
        data: { used: count, limit: AI_DAILY_QUOTA_PAID },
      });
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message: `Daily AI quota reached (${AI_DAILY_QUOTA_PAID}/day). Resets at midnight CET.`,
          retry_after: 3600,
        },
        { status: 429 },
      );
    } else {
      addBreadcrumb({
        category: "ai-chat",
        message: "quota_check_passed",
        data: { used: count ?? 0, limit: AI_DAILY_QUOTA_PAID },
      });
    }
  } catch (err) {
    captureServerError(err, {
      route: "/api/ai-chat",
      userId,
      phase: "quota-check",
      failOpen: true,
    });
  }

  // ──────────────────────────────────────────────────────────────────
  // Body parsing + sanitization.
  // `system` is intentionally NOT accepted from the client — the output
  // is cached globally and served free to all users, so a client-supplied
  // prompt is a cache-poisoning vector. Context is built server-side from
  // the question row fetched by questionId below.
  // ──────────────────────────────────────────────────────────────────
  let parsed: { messages?: unknown; questionId?: unknown; regenerate?: unknown; lang?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { messages, questionId, regenerate, lang } = parsed;
  const forceRegenerate = regenerate === true;
  // Accept "de" or "en"; default to German.
  const responseLang: "de" | "en" = lang === "en" ? "en" : "de";

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages[] required" }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `messages[] max ${MAX_MESSAGES}` },
      { status: 400 },
    );
  }
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

  // ──────────────────────────────────────────────────────────────────
  // Fetch question context server-side (fix 4A).
  //
  // When questionId is present, fetch the full row BEFORE the upstream
  // provider calls so we can build an accurate system prompt. We also
  // cache the fetched `ai_explanation` value here so the cache-write
  // block below can reuse it without a second round-trip.
  //
  // Shape of `choices` JSONB is `{ text: string; correct: boolean }[]`
  // (StoredChoice from src/lib/mcq.ts — same as the client's options prop).
  // ──────────────────────────────────────────────────────────────────
  type QuestionRow = {
    question: string | null;
    answer: string | null;
    explanation: string | null;
    topic: string | null;
    choices: { text: string; correct: boolean }[] | null;
    ai_explanation: string | null;
  };
  let questionRow: QuestionRow | null = null;
  if (qidNum) {
    try {
      const db = getServiceClient();
      const { data } = await db
        .from("questions")
        .select("question, answer, explanation, topic, choices, ai_explanation")
        .eq("id", qidNum)
        .maybeSingle();
      questionRow = data as QuestionRow | null;
    } catch (err) {
      captureServerError(err, {
        route: "/api/ai-chat",
        userId,
        phase: "question-fetch",
        questionId: qidNum,
      });
      // Non-fatal: fall back to bare SYSTEM_PROMPT below.
    }
  }

  // Build the composed system prompt from the fetched row. When no row is
  // available (no questionId, fetch error, or missing row) we fall back to
  // the bare SYSTEM_PROMPT so existing behaviour for question-less calls is
  // unchanged.
  function buildComposedPrompt(row: QuestionRow | null): string {
    if (!row || !row.question) return SYSTEM_PROMPT;

    const lines: string[] = [
      SYSTEM_PROMPT,
      "",
      "--- QUESTION CONTEXT (use this; do not ask the user for it) ---",
    ];
    if (row.topic) lines.push(`TOPIC: ${row.topic}`);
    lines.push(`QUESTION: ${row.question}`);

    const choices = row.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      lines.push("OPTIONS:");
      choices.forEach((c, i) => {
        const letter = String.fromCharCode(65 + i); // A, B, C, …
        lines.push(`${letter}. ${c.text}${c.correct ? " (CORRECT)" : ""}`);
      });
    }

    if (row.answer) lines.push(`CORRECT ANSWER: ${row.answer}`);
    if (row.explanation && row.explanation.trim().length > 0) {
      lines.push(`STATIC EXPLANATION: ${row.explanation}`);
    }

    lines.push(
      responseLang === "en" ? "Respond in English." : "Respond in German.",
    );

    return lines.join("\n");
  }

  const composedSystemPrompt = buildComposedPrompt(questionRow);

  async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const r = await fetch(url, { ...init, signal: controller.signal });
      return r;
    } catch (err) {
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

  // ──────────────────────────────────────────────────────────────────
  // GATE 4: provider routing.
  //
  //   auto         → try Anthropic first if ANTHROPIC_API_KEY is set,
  //                  then fall back to OpenAI on failure (default).
  //   claude_oauth → only try Anthropic. (Reserved — currently broken
  //                  for OAuth tokens. Kept as a config option so the
  //                  switch is one-line when Anthropic re-enables OAuth
  //                  for /v1/messages. Today this mode is equivalent to
  //                  `auto` but without OpenAI fallback on rate-limit.)
  //   openai       → skip Anthropic entirely; only OpenAI.
  //   disabled     → caught above by GATE 1.
  //
  // The actual upstream attempts use AI_PRIMARY_MODEL / AI_FALLBACK_MODEL
  // unless the legacy ANTHROPIC_MODEL/OPENAI_MODEL envs are set, which
  // take precedence (so a hot-fix model swap stays one env var away).
  // ──────────────────────────────────────────────────────────────────
  let reply = "";
  let upstreamProvider: "anthropic" | "openai" | "none" = "none";
  let upstreamModel: string = "none";
  let inTokens: number | null = null;
  let outTokens: number | null = null;

  const tryAnthropic = AI_PROVIDER_MODE === "auto" || AI_PROVIDER_MODE === "claude_oauth";
  const tryOpenAI = AI_PROVIDER_MODE === "auto" || AI_PROVIDER_MODE === "openai";

  // Try Anthropic first (when allowed).
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (tryAnthropic && anthropicKey) {
    const anthropicModel = process.env.ANTHROPIC_MODEL || AI_PRIMARY_MODEL;
    addBreadcrumb({
      category: "ai-chat",
      message: "upstream_request_started",
      data: { provider: "anthropic", model: anthropicModel },
    });
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1024,
        system: composedSystemPrompt,
        messages: sanitized,
      }),
    });
    if (response?.ok) {
      const data = await response.json();
      reply = data.content?.[0]?.text || "";
      inTokens = data.usage?.input_tokens ?? null;
      outTokens = data.usage?.output_tokens ?? null;
      upstreamProvider = "anthropic";
      upstreamModel = anthropicModel;
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_response",
        data: { provider: "anthropic", status: response.status, replyLen: reply.length },
      });
    } else {
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_failed",
        level: "error",
        data: { provider: "anthropic", status: response?.status ?? null },
      });
    }
  }

  // Fall back to OpenAI (when allowed AND Anthropic didn't already succeed).
  if (!reply && tryOpenAI) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const openaiModel = process.env.OPENAI_MODEL || AI_FALLBACK_MODEL;
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_request_started",
        data: { provider: "openai", model: openaiModel },
      });
      const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: openaiModel,
          max_tokens: 1024,
          messages: [{ role: "system", content: composedSystemPrompt }, ...sanitized],
        }),
      });
      if (response?.ok) {
        const data = await response.json();
        reply = data.choices?.[0]?.message?.content || "";
        inTokens = data.usage?.prompt_tokens ?? null;
        outTokens = data.usage?.completion_tokens ?? null;
        upstreamProvider = "openai";
        upstreamModel = openaiModel;
        addBreadcrumb({
          category: "ai-chat",
          message: "upstream_response",
          data: { provider: "openai", status: response.status, replyLen: reply.length },
        });
      } else {
        addBreadcrumb({
          category: "ai-chat",
          message: "upstream_failed",
          level: "error",
          data: { provider: "openai", status: response?.status ?? null },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Failure path: log, return 503.
  // ──────────────────────────────────────────────────────────────────
  if (!reply) {
    addBreadcrumb({
      category: "ai-chat",
      message: "all_upstreams_failed",
      level: "error",
      data: { durationMs: Date.now() - startedAt, mode: AI_PROVIDER_MODE },
    });
    // Still log to ai_call_log so the failure shows up in usage analytics.
    try {
      const db = getServiceClient();
      await db.from("ai_call_log").insert({
        user_id: userId,
        provider: "none",
        model: "none",
        in_tokens: null,
        out_tokens: null,
        cost_usd: null,
        duration_ms: Date.now() - startedAt,
        question_id: qidNum,
        success: false,
        error_code: AI_PROVIDER_MODE === "openai" ? "openai_failed" : "all_upstreams_failed",
      });
    } catch {
      /* swallow — telemetry must not block */
    }
    // Legacy user_events row (kept so the admin "AI failed" tile keeps working).
    try {
      const db = getServiceClient();
      await db.from("user_events").insert({
        user_id: userId,
        event_type: "ai_chat_failed",
        event_data: {
          phase: "all_upstreams_failed",
          duration_ms: Date.now() - startedAt,
          mode: AI_PROVIDER_MODE,
        },
      });
    } catch {
      /* swallow */
    }
    return NextResponse.json(
      {
        reply:
          "Technisches Problem bei der KI-Generierung. Die Frage und die statische Erklärung funktionieren weiter, bitte später erneut versuchen oder den Fehler über das Feedback-Icon melden.",
      },
      { status: 503 },
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Cache-write (only when the question doesn't have an explanation
  // yet, OR when the caller explicitly regenerate=true).
  // ──────────────────────────────────────────────────────────────────
  if (qidNum && sanitized.length === 1) {
    try {
      const db = getServiceClient();
      // Reuse the row fetched earlier for context-building — no second
      // round-trip needed. `questionRow` is null only when the initial
      // fetch errored; in that case we re-fetch so the cache write is
      // still reliable.
      let existingAiExplanation = questionRow?.ai_explanation ?? null;
      if (questionRow === null) {
        const { data: refetch } = await db
          .from("questions")
          .select("ai_explanation")
          .eq("id", qidNum)
          .maybeSingle();
        existingAiExplanation = refetch?.ai_explanation ?? null;
      }
      const shouldWrite = !existingAiExplanation || forceRegenerate;
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
        if (cacheErr) {
          console.error("[ai-chat] cache write:", cacheErr);
          addBreadcrumb({
            category: "ai-chat",
            message: "cache_write_failed",
            level: "error",
            data: { questionId: qidNum, code: cacheErr.code },
          });
        } else {
          addBreadcrumb({
            category: "ai-chat",
            message: "cache_write_ok",
            data: { questionId: qidNum, regenerate: forceRegenerate },
          });
        }
      } else {
        addBreadcrumb({
          category: "ai-chat",
          message: "cache_write_skipped",
          data: { questionId: qidNum, reason: "existing_ai_explanation" },
        });
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

  // ──────────────────────────────────────────────────────────────────
  // Telemetry: ai_call_log (the new quota counter) + legacy user_events
  // (admin tile compatibility).
  // ──────────────────────────────────────────────────────────────────
  try {
    const db = getServiceClient();
    const cost_usd = estimateCostUsd(upstreamModel, inTokens, outTokens);
    await db.from("ai_call_log").insert({
      user_id: userId,
      provider: upstreamProvider,
      model: upstreamModel,
      in_tokens: inTokens,
      out_tokens: outTokens,
      cost_usd,
      duration_ms: Date.now() - startedAt,
      question_id: qidNum,
      success: true,
    });
  } catch {
    /* swallow — telemetry must not block */
  }
  try {
    const db = getServiceClient();
    await db.from("user_events").insert({
      user_id: userId,
      event_type: "ai_chat_completed",
      event_data: {
        provider: upstreamProvider,
        model: upstreamModel,
        question_id: qidNum,
        reply_len: reply.length,
        duration_ms: Date.now() - startedAt,
      },
    });
  } catch {
    /* swallow */
  }

  addBreadcrumb({
    category: "ai-chat",
    message: "response_sent",
    data: {
      provider: upstreamProvider,
      model: upstreamModel,
      durationMs: Date.now() - startedAt,
      replyLen: reply.length,
    },
  });
  return NextResponse.json({ reply });
}
