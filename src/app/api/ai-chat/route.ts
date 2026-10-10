import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess, isPaidAccess } from "@/lib/auth-guard";
import { canFreeUserReadQuestion, logFreeCapHit } from "@/lib/free-access";
import { addBreadcrumb, captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import {
  AiCacheTtlViolation,
  AiEmptyText,
  AiError,
  AiInputRejected,
  AiRefusal,
  AiTimeout,
  callClaude,
  type ClaudeUsage,
  type MessageParam,
} from "@/lib/ai/anthropic";
import { checkLegacyUserCap, dailyAttemptLimit, getLegacyAiLimits, takeAiQuota } from "@/lib/ai/limits";
import { costMicroUsd, measureInputBytes, reserveCeilingMicro, trimHistoryToFit } from "@/lib/ai/pricing";
import { billingNeutralLine } from "@/lib/billing-copy";

export const dynamic = "force-dynamic";
// Anthropic (25 s) plus the OpenAI fallback (15 s) must fit inside the function.
export const maxDuration = 60;

// In-memory burst guard on top of the DB-backed daily quota. Catches
// someone calling the endpoint 100 times in a row.
const AI_CHAT_BURST_LIMIT = { limit: 10, windowMs: 60_000 };

// ────────────────────────────────────────────────────────────────────
// Config (read per request, never cached at module load).
//
// Kill switch: AI_FEATURES_ENABLED=false or AI_PROVIDER_MODE=disabled.
// AI_PRIMARY_MODEL is SET IN VERCEL and overrides the code default.
// Daily attempts come from AI_CHAT_DAILY_ATTEMPTS (src/lib/ai/limits.ts);
// the old AI_DAILY_QUOTA_PAID name is no longer read.
// ────────────────────────────────────────────────────────────────────
type ProviderMode = "auto" | "claude_oauth" | "openai" | "disabled";

function readConfig() {
  return {
    enabled: (process.env.AI_FEATURES_ENABLED ?? "true") === "true",
    mode: (process.env.AI_PROVIDER_MODE as ProviderMode | undefined) ?? "auto",
    primaryModel: process.env.ANTHROPIC_MODEL || process.env.AI_PRIMARY_MODEL || "claude-sonnet-5",
    fallbackModel: process.env.OPENAI_MODEL || process.env.AI_FALLBACK_MODEL || "gpt-4o-mini",
  };
}

// Sonnet 5.x thinks by default and thinking bills (and is capped) as output.
// Effort is therefore explicit, and max_tokens leaves room for thinking AND the
// ~400-word answer (measured p99 answer without thinking: 775 tokens).
const CHAT_EFFORT = "low" as const;
const CHAT_MAX_TOKENS = 3000;
const ANTHROPIC_TIMEOUT_MS = 25_000;
const OPENAI_TIMEOUT_MS = 15_000;

// OpenAI is not in src/lib/ai/pricing.ts (Anthropic only), so the fallback
// carries its own rates, integer micro-USD per million tokens. An unlisted
// OpenAI model is billed at the dearer gpt-4o row (an upper bound).
const OPENAI_RATES: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 150_000, out: 600_000 },
  "gpt-4o": { in: 2_500_000, out: 10_000_000 },
};
const OPENAI_UNLISTED_RATE = OPENAI_RATES["gpt-4o"];

function openaiCostMicro(model: string, inTok: number, outTok: number): number {
  const key = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const r = OPENAI_RATES[key] ?? OPENAI_UNLISTED_RATE;
  return Math.ceil((inTok * r.in + outTok * r.out) / 1_000_000);
}

// Upgraded 2026-04-17 per user feedback (Mounzer 3/5 + Hu "bessere
// Erklärungen"). Enforces strict structure that makes explanations
// easier to skim on mobile: TL;DR → correct answer reasoning →
// distractor-by-distractor breakdown.
// 2026-10-10: no exam name (the bank covers three tracks) and no guideline
// citations (there is no source corpus behind them, so they were unverifiable).
const SYSTEM_PROMPT = [
  "You are MedPrüf's study tutor. You explain multiple-choice questions from MedPrüf's question bank to physicians preparing for Austrian medical exams.",
  "Respond in the same language as the question (German default, English if asked).",
  "",
  "MANDATORY FORMAT:",
  "1. Start with a one-sentence **TL;DR** (bold) summarizing the correct answer.",
  "2. Section '**Warum die richtige Antwort**' / '**Why the correct answer**' — 2–4 bullets with clinical/physiological reasoning. Use **bold** for key medical terms.",
  "3. Section '**Warum die anderen falsch sind**' / '**Why the others are wrong**' — one short bullet per distractor naming the specific reason.",
  "",
  "HARD CONSTRAINTS:",
  "- Max ~400 words total. Fit on a mobile screen.",
  "- Use markdown (**bold**, bullet lists, small tables where helpful).",
  "- Never speculate without evidence. If uncertain, say so explicitly.",
  "- Never invent sources, guideline names, editions, years or figures. If you are unsure of a detail, say so instead of citing.",
  "- Do NOT regurgitate the question. Go straight to reasoning.",
].join("\n");

const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;

const TECH_PROBLEM_REPLY =
  "Technisches Problem bei der KI-Generierung. Die Frage und die statische Erklärung funktionieren weiter, bitte später erneut versuchen oder den Fehler über das Feedback-Icon melden.";
const REFUSAL_REPLY =
  "Zu dieser Anfrage kann keine KI-Erklärung erstellt werden. Die Frage und die statische Erklärung funktionieren weiter.";

// ────────────────────────────────────────────────────────────────────
// ai_call_log writer. One row per upstream call, failures included.
// The R2 columns (route, status, cache tokens) exist only after the R2
// migrations; they are written only once a probe confirms them.
// ────────────────────────────────────────────────────────────────────
type CallStatus = "ok" | "timeout" | "empty_text" | "upstream_error" | "rejected_input" | "refusal" | "cache_ttl_violation";

interface CallLogRow {
  provider: "anthropic" | "openai" | "none";
  model: string;
  status: CallStatus;
  errorCode: string | null;
  inTokens: number | null;
  outTokens: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  costMicro: number;
  durationMs: number;
}

type ServiceClient = ReturnType<typeof getServiceClient>;

const R2_NEGATIVE_TTL_MS = 60_000;
let r2Columns: { ok: boolean; at: number } | null = null;

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  return e.code === "42703" || e.code === "PGRST204" || /column .*(does not exist|schema cache)/i.test(String(e.message ?? ""));
}

async function r2ColumnsPresent(db: ServiceClient): Promise<boolean> {
  const now = Date.now();
  if (r2Columns && (r2Columns.ok || now - r2Columns.at < R2_NEGATIVE_TTL_MS)) return r2Columns.ok;
  let ok = false;
  try {
    const { error } = await db
      .from("ai_call_log")
      .select("cache_read_tokens,cache_write_tokens,route,status")
      .limit(0);
    ok = !error;
  } catch {
    ok = false;
  }
  r2Columns = { ok, at: now };
  return ok;
}

async function writeCallLog(userId: string, questionId: number | null, row: CallLogRow): Promise<void> {
  try {
    const db = getServiceClient();
    const legacy: Record<string, unknown> = {
      user_id: userId,
      provider: row.provider,
      model: row.model,
      in_tokens: row.inTokens,
      out_tokens: row.outTokens,
      // Integer micro-USD is already rounded up, so micro / 1e6 is exact at 6 decimals.
      cost_usd: (row.costMicro / 1_000_000).toFixed(6),
      duration_ms: row.durationMs,
      question_id: questionId,
      success: row.status === "ok",
      error_code: row.errorCode,
    };
    const full = {
      ...legacy,
      cache_read_tokens: row.cacheRead,
      cache_write_tokens: row.cacheWrite,
      route: "ai_chat",
      status: row.status,
    };
    const withR2 = await r2ColumnsPresent(db);
    let { error } = await db.from("ai_call_log").insert(withR2 ? full : legacy);
    if (error && withR2 && isMissingColumnError(error)) {
      r2Columns = { ok: false, at: Date.now() };
      ({ error } = await db.from("ai_call_log").insert(legacy));
    }
    if (error) {
      captureServerError(error, { route: "/api/ai-chat", userId, phase: "call-log-insert", provider: row.provider });
    }
  } catch (err) {
    captureServerError(err, { route: "/api/ai-chat", userId, phase: "call-log-insert", provider: row.provider });
  }
}

/** Input-only token estimate for failures that carry no usage (German text is about 3 to 4 bytes per token). */
function estimateInputTokens(system: string, messages: MessageParam[]): number {
  return Math.ceil(measureInputBytes({ system: [{ type: "text", text: system }], messages }) / 3);
}

function hasUsage(u: ClaudeUsage | null | undefined): u is ClaudeUsage {
  return !!u && (u.input_tokens > 0 || u.output_tokens > 0 || u.cache_read_input_tokens > 0 || u.cache_creation_input_tokens > 0);
}

/**
 * R2-05: a reached call with no usage may have run thinking/output up to
 * max_tokens, so book the reserve ceiling (input + max output), never an
 * input-only estimate. Unknown model falls back to the dearest row with the
 * full output budget.
 */
function reachedNoUsageCostMicro(model: string, system: string, turns: MessageParam[]): number {
  const inputBytes = measureInputBytes({ system: [{ type: "text", text: system }], messages: turns });
  try {
    return reserveCeilingMicro(model, inputBytes, CHAT_MAX_TOKENS);
  } catch {
    return costMicroUsd(
      model,
      { input_tokens: estimateInputTokens(system, turns), output_tokens: CHAT_MAX_TOKENS },
      { onUnknown: "top_row" },
    );
  }
}

function classifyAnthropicError(err: unknown): { status: CallStatus; code: string; reached: boolean; usage: ClaudeUsage | null } {
  if (err instanceof AiError) {
    const status: CallStatus =
      err instanceof AiTimeout
        ? "timeout"
        : err instanceof AiEmptyText
          ? "empty_text"
          : err instanceof AiRefusal
            ? "refusal"
            : err instanceof AiCacheTtlViolation
              ? "cache_ttl_violation"
              : err instanceof AiInputRejected
                ? "rejected_input"
                : "upstream_error";
    return { status, code: err.code, reached: err.reachedModel, usage: err.usage };
  }
  // Not a wrapper error (should not happen): bill conservatively as reached.
  return { status: "upstream_error", code: "unexpected_error", reached: true, usage: null };
}

function secondsUntilViennaMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vienna",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Math.max(1, 86_400 - (g("hour") * 3600 + g("minute") * 60 + g("second")));
}

function aiUnavailable(): NextResponse {
  return NextResponse.json(
    { error: "ai_unavailable", message: "AI is temporarily unavailable. Please try again later." },
    { status: 503 },
  );
}

function isMissingExplanationLocaleColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = `${String(e.message ?? "")} ${String(e.details ?? "")}`;
  return e.code === "42703" || e.code === "PGRST204" || /ai_explanation_lang.*(does not exist|schema cache|column)/i.test(message);
}

// GET — Check for cached AI explanation for a question.
// Paid/admin: any question. Free/anon: only questions inside the free
// allowance (free slice, and not past the cap unless already answered).
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("questionId");
    const questionId = raw ? Number(raw) : NaN;
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return NextResponse.json({ cached: false });
    }

    const db = getServiceClient();

    // 2026-10-02 paywall: the cached explanation reveals the answer, so it is
    // served only for questions inside the caller's free allowance unless
    // they have paid access. (This GET used to answer for ANY id, even anon.)
    let callerId: string | null = null;
    let paid = false;
    if (req.headers.get("x-session-token")) {
      const guard = await requireUser(req);
      if (!("error" in guard)) {
        callerId = guard.userId;
        paid = isPaidAccess(guard);
      }
    }
    if (!paid && !(await canFreeUserReadQuestion(db, callerId, questionId))) {
      await logFreeCapHit(db, {
        userId: callerId,
        gate: "qbank_limit",
        route: "/api/ai-chat GET",
        questionId,
      });
      return NextResponse.json({ cached: false, locked: true, upgradeRequired: true });
    }

    let { data, error } = await db
      .from("questions")
      .select("ai_explanation, ai_explanation_generated_at, ai_explanation_lang")
      .eq("id", questionId)
      .maybeSingle();
    // During rolling deployment the API can briefly run before its additive
    // migration. Keep legacy cache reads available during that window.
    if (error && isMissingExplanationLocaleColumn(error)) {
      const legacy = await db.from("questions")
        .select("ai_explanation, ai_explanation_generated_at")
        .eq("id", questionId)
        .maybeSingle();
      data = legacy.data as typeof data;
      error = legacy.error;
    }
    if (error) throw error;

    if (data?.ai_explanation) {
      return NextResponse.json({ cached: true, explanation: data.ai_explanation, lang: data.ai_explanation_lang ?? "de" });
    }
    return NextResponse.json({ cached: false });
  } catch {
    return NextResponse.json({ cached: false });
  }
}

// POST — Generate AI explanation (and cache it).
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const config = readConfig();
  addBreadcrumb({ category: "ai-chat", message: "request_received" });

  // ──────────────────────────────────────────────────────────────────
  // GATE 1: hard kill switch.
  // Set AI_FEATURES_ENABLED=false to immediately disable AI for everyone.
  // Returns 503 with a generic message; the client falls back gracefully
  // (showing only cached explanations). Use this when a provider has an
  // outage / runaway cost / abuse incident.
  // ──────────────────────────────────────────────────────────────────
  if (!config.enabled || config.mode === "disabled") {
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
  // The copy carries no price: prices and renewal wording are owned by
  // billing-copy.ts and /pricing (the old text hard-coded a stale "from 9 EUR").
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
        message: `AI explanations are part of MedPrüf Pro. ${billingNeutralLine("en")} Current plans and prices: https://medpruf.com/pricing`,
      },
      { status: 402 },
    );
  }
  addBreadcrumb({ category: "ai-chat", message: "tier_check_passed" });

  // ──────────────────────────────────────────────────────────────────
  // Body parsing + sanitization (BEFORE the quota, so a malformed
  // request never burns an attempt).
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
  // The cache write below applies only to a single-message request, judged on
  // what the client sent (not on the normalized conversation).
  const clientMessageCount = sanitized.length;
  if (sanitized[sanitized.length - 1].role !== "user") {
    return NextResponse.json({ error: "Last message must be from the user" }, { status: 400 });
  }
  // The follow-up UI seeds the chat with the explanation as an ASSISTANT turn,
  // so a follow-up arrives as [assistant, user, ...]. The Messages API (and
  // the shared wrapper) need the first turn to be the user's.
  const conversation: MessageParam[] =
    sanitized[0].role === "assistant"
      ? [
          {
            role: "user",
            content: responseLang === "en" ? "Please explain this question." : "Bitte erkläre diese Frage.",
          },
          ...sanitized,
        ]
      : sanitized.map((m) => ({ role: m.role, content: m.content }));

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
    ai_explanation_lang: "de" | "en" | null;
  };
  let questionRow: QuestionRow | null = null;
  if (qidNum) {
    try {
      const db = getServiceClient();
      let { data, error } = await db
        .from("questions")
        .select("question, answer, explanation, topic, choices, ai_explanation, ai_explanation_lang")
        .eq("id", qidNum)
        .maybeSingle();
      if (error && isMissingExplanationLocaleColumn(error)) {
        const legacy = await db.from("questions")
          .select("question, answer, explanation, topic, choices, ai_explanation")
          .eq("id", qidNum)
          .maybeSingle();
        data = legacy.data as typeof data;
        error = legacy.error;
      }
      if (error) throw error;
      questionRow = data as QuestionRow | null;
    } catch (err) {
      captureServerError(err, {
        route: "/api/ai-chat",
        userId,
        phase: "question-fetch",
        questionId: qidNum,
      });
    }
    // R2-03: a question-bound request without its question must not reach the
    // model: the context-less answer would be billed and then cached as the
    // global explanation. Refuse before any cap check or attempt is taken.
    if (!questionRow) {
      return aiUnavailable();
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
      lines.push("ANSWER CHOICES (the interface shuffles their display order):");
      choices.forEach((c) => {
        lines.push(`- ${JSON.stringify(c.text)}${c.correct ? " (CORRECT)" : ""}`);
      });
      lines.push("Refer to each choice by its exact wording. Never use A/B/C letters or positional labels, because learners see a shuffled order.");
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

  // Keep the whole request inside the wrapper's input cap (and so below the
  // cheap price step). Oldest turns go first; the newest user turn must fit.
  const fitted = trimHistoryToFit({ system: [{ type: "text", text: composedSystemPrompt }], messages: conversation });
  if (!fitted) {
    return NextResponse.json({ error: "Message too large" }, { status: 400 });
  }
  const turns = fitted.messages;

  // ──────────────────────────────────────────────────────────────────
  // GATE 3: per-user monthly legacy cost cap (read-only, so a refusal
  // does not burn a daily attempt). Fails CLOSED on any DB problem.
  // ──────────────────────────────────────────────────────────────────
  const limits = getLegacyAiLimits();
  const quotaDb = getServiceClient();
  const cap = await checkLegacyUserCap(quotaDb, userId, limits);
  if (!cap.ok) {
    if (cap.reason === "cap_reached") {
      addBreadcrumb({
        category: "ai-chat",
        message: "monthly_cap_reached",
        level: "warning",
        data: { spentMicro: cap.spentMicro, capMicro: cap.capMicro },
      });
      return NextResponse.json(
        {
          error: "monthly_cap_reached",
          message: "Your monthly AI fair-use limit is reached. It resets at the start of next month (UTC).",
        },
        { status: 429 },
      );
    }
    captureServerError(new Error(`ai_legacy_cost_month ${cap.reason ?? "failed"}`), {
      route: "/api/ai-chat",
      userId,
      phase: "legacy-cap-check",
      failClosed: true,
    });
    return aiUnavailable();
  }

  // ──────────────────────────────────────────────────────────────────
  // GATE 4: per-user daily quota, counted as ATTEMPTS (a failed model
  // call still counts) by ai_quota_take: atomic, Europe/Vienna day
  // computed in SQL, so it needs no hard-coded UTC offset across the
  // CEST to CET switch. Fails CLOSED: a DB error is a 503, never a free pass.
  // ──────────────────────────────────────────────────────────────────
  const dailyLimit = dailyAttemptLimit("ai_chat", limits);
  const quota = await takeAiQuota(quotaDb, userId, "ai_chat", dailyLimit);
  if (!quota.ok) {
    if (quota.reason === "limit_reached") {
      addBreadcrumb({
        category: "ai-chat",
        message: "quota_exceeded",
        level: "warning",
        data: { used: quota.used, limit: dailyLimit },
      });
      const retryAfter = secondsUntilViennaMidnight();
      return NextResponse.json(
        {
          error: "quota_exceeded",
          message: `Daily AI quota reached (${dailyLimit}/day). Resets at midnight Vienna time.`,
          retry_after: retryAfter,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
    captureServerError(new Error(`ai_quota_take ${quota.reason ?? "failed"}`), {
      route: "/api/ai-chat",
      userId,
      phase: "quota-check",
      failClosed: true,
    });
    return aiUnavailable();
  }
  addBreadcrumb({
    category: "ai-chat",
    message: "quota_check_passed",
    data: { used: quota.used, limit: dailyLimit },
  });

  // ──────────────────────────────────────────────────────────────────
  // GATE 5: provider routing.
  //
  //   auto         → try Anthropic first if ANTHROPIC_API_KEY is set,
  //                  then fall back to OpenAI on failure (default).
  //   claude_oauth → only try Anthropic. (Reserved; see AI-OAUTH-TEST-2026-04-28.md.)
  //   openai       → skip Anthropic entirely; only OpenAI.
  //   disabled     → caught above by GATE 1.
  //
  // Anthropic goes through the shared wrapper (src/lib/ai/anthropic.ts):
  // reply = first TEXT block (never content[0], Sonnet 5 thinks by
  // default), explicit effort, one request, usage incl. cache tokens.
  // EVERY upstream call writes one ai_call_log row, failures included.
  // ──────────────────────────────────────────────────────────────────
  let reply = "";
  let upstreamProvider: "anthropic" | "openai" | "none" = "none";
  let upstreamModel = "none";
  let truncated = false;
  let refused = false;

  const tryAnthropic = config.mode === "auto" || config.mode === "claude_oauth";
  const tryOpenAI = config.mode === "auto" || config.mode === "openai";

  if (tryAnthropic && process.env.ANTHROPIC_API_KEY) {
    const model = config.primaryModel;
    addBreadcrumb({
      category: "ai-chat",
      message: "upstream_request_started",
      data: { provider: "anthropic", model },
    });
    const callStart = Date.now();
    try {
      const result = await callClaude({
        model,
        effort: CHAT_EFFORT,
        system: [{ type: "text", text: composedSystemPrompt }],
        messages: turns,
        max_tokens: CHAT_MAX_TOKENS,
        timeoutMs: ANTHROPIC_TIMEOUT_MS,
      });
      reply = result.text;
      truncated = result.stop_reason === "max_tokens";
      upstreamProvider = "anthropic";
      upstreamModel = model;
      await writeCallLog(userId, qidNum, {
        provider: "anthropic",
        model,
        status: "ok",
        errorCode: null,
        inTokens: result.usage.input_tokens,
        outTokens: result.usage.output_tokens,
        cacheRead: result.usage.cache_read_input_tokens,
        cacheWrite: result.usage.cache_creation_input_tokens,
        costMicro: costMicroUsd(model, result.usage, { onUnknown: "top_row" }),
        durationMs: Date.now() - callStart,
      });
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_response",
        data: {
          provider: "anthropic",
          requestId: result.request_id,
          stopReason: result.stop_reason,
          blockTypes: result.blocks.map((b) => b.type),
          replyLen: reply.length,
        },
      });
    } catch (err) {
      const c = classifyAnthropicError(err);
      let costMicro = 0;
      if (c.reached) {
        costMicro = hasUsage(c.usage)
          ? costMicroUsd(model, c.usage, { onUnknown: "top_row" })
          : reachedNoUsageCostMicro(model, composedSystemPrompt, turns);
      }
      await writeCallLog(userId, qidNum, {
        provider: "anthropic",
        model,
        status: c.status,
        errorCode: c.code,
        inTokens: c.usage?.input_tokens ?? null,
        outTokens: c.usage?.output_tokens ?? null,
        cacheRead: c.usage?.cache_read_input_tokens ?? null,
        cacheWrite: c.usage?.cache_creation_input_tokens ?? null,
        costMicro,
        durationMs: Date.now() - callStart,
      });
      captureServerError(err, { route: "/api/ai-chat", userId, phase: "upstream", provider: "anthropic", status: c.status, code: c.code });
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_failed",
        level: "error",
        data: { provider: "anthropic", status: c.status, code: c.code },
      });
      // A safety refusal is not an outage: never route the same content to another provider.
      refused = c.status === "refusal";
    }
  }

  // Fall back to OpenAI (when allowed AND Anthropic didn't already succeed).
  if (!reply && !refused && tryOpenAI) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const model = config.fallbackModel;
      addBreadcrumb({
        category: "ai-chat",
        message: "upstream_request_started",
        data: { provider: "openai", model },
      });
      const callStart = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
      let status: CallStatus = "upstream_error";
      let errorCode: string | null = "network_error";
      let reached = true;
      let inTok: number | null = null;
      let outTok: number | null = null;
      let text = "";
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            messages: [{ role: "system", content: composedSystemPrompt }, ...turns],
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          const data = await response.json();
          text = typeof data.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content : "";
          inTok = typeof data.usage?.prompt_tokens === "number" ? data.usage.prompt_tokens : null;
          outTok = typeof data.usage?.completion_tokens === "number" ? data.usage.completion_tokens : null;
          status = text ? "ok" : "empty_text";
          errorCode = text ? null : "empty_text";
        } else {
          status = "upstream_error";
          errorCode = `http_${response.status}`;
          reached = response.status >= 500; // a 4xx was rejected before generation
        }
      } catch (err) {
        status = controller.signal.aborted ? "timeout" : "upstream_error";
        errorCode = controller.signal.aborted ? "timeout" : "network_error";
        captureServerError(err, { route: "/api/ai-chat", userId, phase: "upstream", provider: "openai" });
      } finally {
        clearTimeout(timer);
      }
      const costMicro = !reached
        ? 0
        : openaiCostMicro(model, inTok ?? estimateInputTokens(composedSystemPrompt, turns), outTok ?? 0);
      await writeCallLog(userId, qidNum, {
        provider: "openai",
        model,
        status,
        errorCode,
        inTokens: inTok,
        outTokens: outTok,
        cacheRead: null,
        cacheWrite: null,
        costMicro,
        durationMs: Date.now() - callStart,
      });
      if (status === "ok") {
        reply = text;
        upstreamProvider = "openai";
        upstreamModel = model;
        addBreadcrumb({
          category: "ai-chat",
          message: "upstream_response",
          data: { provider: "openai", replyLen: reply.length },
        });
      } else {
        addBreadcrumb({
          category: "ai-chat",
          message: "upstream_failed",
          level: "error",
          data: { provider: "openai", status, code: errorCode },
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────
  // Failure path: return 503. Each upstream call already wrote its own
  // ai_call_log row above. When NO provider was even attempted (no key,
  // or a mode that allows none), write one explanatory row so the 503
  // is visible in the usage table.
  // ──────────────────────────────────────────────────────────────────
  if (!reply) {
    addBreadcrumb({
      category: "ai-chat",
      message: "all_upstreams_failed",
      level: "error",
      data: { durationMs: Date.now() - startedAt, mode: config.mode, refused },
    });
    if (!refused && !(tryAnthropic && process.env.ANTHROPIC_API_KEY) && !(tryOpenAI && process.env.OPENAI_API_KEY)) {
      await writeCallLog(userId, qidNum, {
        provider: "none",
        model: "none",
        status: "upstream_error",
        errorCode: "no_provider_configured",
        inTokens: null,
        outTokens: null,
        cacheRead: null,
        cacheWrite: null,
        costMicro: 0,
        durationMs: Date.now() - startedAt,
      });
    }
    // Legacy user_events row (kept so the admin "AI failed" tile keeps working).
    try {
      const db = getServiceClient();
      await db.from("user_events").insert({
        user_id: userId,
        event_type: "ai_chat_failed",
        event_data: {
          phase: refused ? "refusal" : "all_upstreams_failed",
          duration_ms: Date.now() - startedAt,
          mode: config.mode,
        },
      });
    } catch {
      /* swallow */
    }
    return NextResponse.json({ reply: refused ? REFUSAL_REPLY : TECH_PROBLEM_REPLY }, { status: 503 });
  }

  // ──────────────────────────────────────────────────────────────────
  // Cache-write (only when the question doesn't have an explanation
  // yet, OR when the caller explicitly regenerate=true).
  // ──────────────────────────────────────────────────────────────────
  if (qidNum && clientMessageCount === 1 && !truncated) {
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
          ai_explanation_lang: responseLang,
        };
        if (forceRegenerate) {
          update.explanation_rating_sum = 0;
          update.explanation_rating_count = 0;
        }
        let { error: cacheErr } = await db
          .from("questions")
          .update(update)
          .eq("id", qidNum);
        let skippedLocaleAmbiguousWrite = false;
        if (cacheErr && isMissingExplanationLocaleColumn(cacheErr)) {
          if (responseLang === "en") {
            // Without the locale column, GET must assume legacy cache rows are
            // German. Never write an English response into that shared slot.
            skippedLocaleAmbiguousWrite = true;
            cacheErr = null;
          } else {
            // Preserve the historical German fallback while the additive
            // locale migration is not yet present in every environment.
            delete update.ai_explanation_lang;
            const legacyWrite = await db.from("questions").update(update).eq("id", qidNum);
            cacheErr = legacyWrite.error;
          }
        }
        if (skippedLocaleAmbiguousWrite) {
          addBreadcrumb({
            category: "ai-chat",
            message: "cache_write_skipped",
            data: { questionId: qidNum, reason: "missing_locale_column_for_english_response" },
          });
        } else if (cacheErr) {
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
  // Telemetry: legacy user_events (admin tile compatibility). The
  // ai_call_log row was already written per upstream call above.
  // ──────────────────────────────────────────────────────────────────
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
