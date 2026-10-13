import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { canFreeUserReadQuestion, logFreeCapHit } from "@/lib/free-access";
import { isDbUnavailable } from "@/lib/db-unavailable";
import { dbUnavailableResponse } from "@/lib/db-unavailable-route";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { getLegacyAiLimits } from "@/lib/ai/limits";
import { anthropicFallbackModel, resolveFallback } from "@/lib/ai/fallback";
import { legacyGate, logAiCall, meteredClaude, type MeterDb } from "@/lib/notes-safety";
import { logTranslateCapHit, translateDailyLimit } from "@/lib/ai/translate-cap";
import {
  TRANSLATION_FIELDS,
  TRANSLATION_LANG_LABELS,
  TRANSLATION_TARGETS,
  buildTranslationSystem,
  buildTranslationUser,
  isUsableTranslation,
} from "@/lib/explanation-translation";

/** a-db-relief-1: an unreadable allowance is a retry (503), never a refusal. */
async function freeReadVerdict(db: ReturnType<typeof getServiceClient>, userId: string | null, questionId: number): Promise<"allowed" | "denied" | "unavailable"> {
  try {
    return (await canFreeUserReadQuestion(db, userId, questionId)) ? "allowed" : "denied";
  } catch (err) {
    if (isDbUnavailable(err)) return "unavailable";
    throw err;
  }
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Translation burst guard — the daily quota (5 for free, unlimited
// for Pro) lives below, but a programmatic caller on Pro could still
// spike costs. 15 translations/min is far above any real-user pattern
// (clicking a lang flag on each question = one per question).
const TRANSLATE_BURST_LIMIT = { limit: 15, windowMs: 60_000 };

/**
 * POST /api/translate
 *
 * Context: Backlog item #9. Foreign doctors preparing for the Austrian
 * Kenntnisprüfung frequently need a native-language scaffold for the
 * German medical explanations. Vladimir Abaev (Russian, 182 Qs at 32%
 * accuracy) is the canonical case. We promised him Russian support in
 * his Apr 17 reply email — this is that delivery.
 *
 * Design:
 * - Request: { questionId:int, lang:'ru'|'ar'|'en'|'fr'|'tr'|'uk'|'sr',
 *              field:'ai_explanation'|'explanation' }
 * - Cache-first: hit question_translations. Cache key
 *   (question_id, lang, field) is unique → zero duplicate upstream
 *   calls per (question, language, field) across the entire user base.
 * - On miss: fetch source text from questions, call Anthropic (Haiku)
 *   first, then the fallback slot (OPENAI_TRANSLATE_MODEL, else
 *   AI_FALLBACK_MODEL, else gpt-4o-mini): a Claude model id is a second
 *   metered Anthropic call through the same wrapper, any other id goes to
 *   OpenAI. Then cache + return.
 * - Rate-limit: DB-backed daily ATTEMPT cap through ai_quota_take for free
 *   callers only (5, Europe/Vienna day); Pro and admin have no daily cap
 *   (issue 10, 2026-10-12, lib/ai/translate-cap.ts). Cache hits are free
 *   and never counted. Every model call (Anthropic and the
 *   OpenAI fallback) writes one ai_call_log row; a global spend cap pauses
 *   the route ("resting") and a per-user monthly legacy cost cap limits it.
 * - Prompt preserves medical terminology — drug names, anatomical
 *   structures, eponyms stay in German or the standard international
 *   spelling. The model is told this explicitly.
 * - 20s upstream timeout so a slow provider doesn't stall the fn.
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
// Daily cap: lib/ai/translate-cap.ts (free only; paid callers are unlimited).
// Cache hits are free and never counted.

// ────────────────────────────────────────────────────────────────────
// AI kill switch — mirrors /api/ai-chat (GATE 1). Without this, translate
// would call Anthropic/OpenAI even while AI_FEATURES_ENABLED=false, breaking
// the documented "instantly disable all AI" guarantee and leaking spend.
// ────────────────────────────────────────────────────────────────────
const AI_FEATURES_ENABLED = (process.env.AI_FEATURES_ENABLED ?? "true") === "true";
type ProviderMode = "auto" | "claude_oauth" | "openai" | "disabled";
const AI_PROVIDER_MODE: ProviderMode =
  (process.env.AI_PROVIDER_MODE as ProviderMode | undefined) ?? "auto";

// Target languages, prompt and the usable-text rule live in one owner
// (src/lib/explanation-translation.ts), shared with the staging script.
const SUPPORTED_LANGS: ReadonlySet<string> = new Set(TRANSLATION_TARGETS);
const LANG_LABELS: Record<string, string> = TRANSLATION_LANG_LABELS;
const SUPPORTED_FIELDS: ReadonlySet<string> = new Set(TRANSLATION_FIELDS);

function isMissingKeyRevisionColumn(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const message = `${String(e.message ?? "")} ${String(e.details ?? "")}`;
  return (e.code === "42703" || e.code === "PGRST204") && /key_revision/i.test(message);
}

/**
 * GET /api/translate?questionId=<int>&field=<explanation|ai_explanation>
 *
 * Read-only cache fetch (UX-6). Returns EVERY already-cached translation
 * for a (question, field) in one shot as { translations: { <lang>: text } }
 * so the Explanation surface can:
 *   (a) auto-show the row matching the user's UI language on mount, at ZERO
 *       cost — no upstream call, no quota spend, no `translation` event; and
 *   (b) mark each language in the switcher as instant (cached) vs.
 *       generate-on-first-view.
 *
 * Deliberately NOT behind the POST burst guard (that guard runs before the
 * cache lookup, so sharing it would 429 a user browsing quickly). It never
 * generates, so it is safe to call freely. `requireUser` still gates it so
 * it is not an open endpoint. The AI kill switch does NOT apply — reading a
 * cached row costs nothing and must keep working even while generation is
 * paused.
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const { searchParams } = new URL(req.url);
  const qidRaw = Number(searchParams.get("questionId"));
  const questionId = Number.isInteger(qidRaw) && qidRaw > 0 ? qidRaw : NaN;
  const field = searchParams.get("field") || "";

  if (!Number.isInteger(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }
  if (!SUPPORTED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Unsupported field. Allowed: ${[...SUPPORTED_FIELDS].join(", ")}` },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  // 2026-10-02 paywall: translations carry the stem/explanation, so free
  // callers only get them for questions inside their free allowance.
  // a-db-relief-1: an unreadable allowance is a retry (503), never "locked".
  const verdict = isFreeAccess(guard) ? await freeReadVerdict(db, guard.userId, questionId) : "allowed";
  if (verdict === "unavailable") return dbUnavailableResponse();
  if (verdict === "denied") {
    await logFreeCapHit(db, {
      userId: guard.userId,
      gate: "qbank_limit",
      route: "/api/translate GET",
      questionId,
    });
    return NextResponse.json({ translations: {}, field, locked: true, upgradeRequired: true });
  }

  const { data, error } = await db
    .from("question_translations")
    .select("lang, translated_text")
    .eq("question_id", questionId)
    .eq("field", field);

  if (error) {
    console.error("[translate:GET] cache read:", error);
    // Fail soft — the surface just shows the German original + a manual
    // switcher, no crash.
    return NextResponse.json({ translations: {}, field });
  }

  const translations: Record<string, string> = {};
  for (const row of data || []) {
    if (row?.lang && isUsableTranslation(row.translated_text)) translations[row.lang] = row.translated_text;
  }
  return NextResponse.json({ translations, field });
}

// OpenAI fallback: not in the Anthropic price table, so it is booked at the
// table's top row (an upper bound, never zero). Over-metering is the safe side.
// OpenAI is not in src/lib/ai/pricing.ts (Anthropic only). Book the fallback at
// real OpenAI rates (integer micro-USD per MTok); booking it at the dearest
// Anthropic row would overstate ~20x against the shared per-user cap (R2-04).
// An unlisted OpenAI model is billed at the dearer gpt-4o row (upper bound).
const OPENAI_RATES: Record<string, { in: number; out: number }> = {
  "gpt-4o-mini": { in: 150_000, out: 600_000 },
  "gpt-4o": { in: 2_500_000, out: 10_000_000 },
};
function openaiCostMicro(model: string, inTok: number, outTok: number): number {
  const key = model.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const r = OPENAI_RATES[key] ?? OPENAI_RATES["gpt-4o"];
  return Math.ceil((inTok * r.in + outTok * r.out) / 1_000_000);
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...init, signal: controller.signal });
    return r;
  } catch (err) {
    console.error("[translate] upstream error:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  // GATE 1: hard kill switch (same contract as /api/ai-chat). When AI is
  // disabled, return 503 before any auth or upstream call so "AI off" is
  // honored for translate too. AI_PROVIDER_MODE === "disabled" is treated as
  // off as well, matching ai-chat.
  if (!AI_FEATURES_ENABLED || AI_PROVIDER_MODE === "disabled") {
    return NextResponse.json(
      { error: "ai_disabled", message: "AI features are temporarily paused." },
      { status: 503 },
    );
  }

  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  const burstGate = checkRateLimit({
    key: rateKey("translate", userId),
    ...TRANSLATE_BURST_LIMIT,
  });
  if (!burstGate.allowed) {
    return NextResponse.json(
      {
        error: "Too many translation requests, please wait a moment.",
        retryAfter: burstGate.retryAfterSec,
      },
      { status: 429, headers: rateLimitHeaders(burstGate, TRANSLATE_BURST_LIMIT) }
    );
  }

  let parsed: { questionId?: unknown; lang?: unknown; field?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const qidRaw = parsed.questionId;
  const questionId =
    typeof qidRaw === "number" && Number.isInteger(qidRaw) && qidRaw > 0 ? qidRaw : NaN;
  const lang = typeof parsed.lang === "string" ? parsed.lang.toLowerCase() : "";
  const field = typeof parsed.field === "string" ? parsed.field : "";

  if (!Number.isInteger(questionId) || questionId <= 0) {
    return NextResponse.json({ error: "questionId required" }, { status: 400 });
  }
  if (!SUPPORTED_LANGS.has(lang)) {
    return NextResponse.json(
      { error: `Unsupported language. Allowed: ${[...SUPPORTED_LANGS].join(", ")}` },
      { status: 400 },
    );
  }
  if (!SUPPORTED_FIELDS.has(field)) {
    return NextResponse.json(
      { error: `Unsupported field. Allowed: ${[...SUPPORTED_FIELDS].join(", ")}` },
      { status: 400 },
    );
  }

  const db = getServiceClient();

  // 0. Paywall (2026-10-02): free callers may only translate questions inside
  //    their free allowance (cache hits included; they carry the content).
  //    An unreadable allowance is a retry (503), never a 402 (a-db-relief-1).
  const verdict = isFreeAccess(guard) ? await freeReadVerdict(db, userId, questionId) : "allowed";
  if (verdict === "unavailable") return dbUnavailableResponse();
  if (verdict === "denied") {
    await logFreeCapHit(db, {
      userId,
      gate: "qbank_limit",
      route: "/api/translate POST",
      questionId,
    });
    return NextResponse.json(
      { error: "upgrade_required", upgradeRequired: true, gate: "qbank_limit" },
      { status: 402 },
    );
  }

  // 1. Cache lookup — if this translation already exists, serve it
  //    and log the event for analytics without any upstream cost.
  {
    const { data: cached } = await db
      .from("question_translations")
      .select("translated_text, source_model, created_at")
      .eq("question_id", questionId)
      .eq("lang", lang)
      .eq("field", field)
      .maybeSingle();
    // A blank cached row is never served. The cache insert is ON CONFLICT DO
    // NOTHING, so the blank row is removed first (only while it is still
    // that exact blank value); otherwise every request would regenerate and
    // spend quota without ever replacing it.
    const cachedText: unknown = cached?.translated_text;
    if (isUsableTranslation(cachedText)) {
      return NextResponse.json({
        translatedText: cachedText,
        lang,
        field,
        cached: true,
        sourceModel: cached?.source_model || null,
      });
    }
    if (cached) {
      let del = db
        .from("question_translations")
        .delete()
        .eq("question_id", questionId)
        .eq("lang", lang)
        .eq("field", field);
      del = typeof cachedText === "string" ? del.eq("translated_text", cachedText) : del.is("translated_text", null);
      const { error: delErr } = await del;
      if (delErr) console.error("[translate] blank cache row cleanup:", delErr);
    }
  }

  // 2. Load source text from the questions table. (Before the gates below,
  //    so a 404 or an empty source never burns a daily attempt.)
  // Until 20261110090000 is applied key_revision is absent: read without it
  // and skip the cache write below (never an unguarded insert).
  let { data: qrow, error: qerr } = await db
    .from("questions")
    .select("id, ai_explanation, explanation, key_revision")
    .eq("id", questionId)
    .maybeSingle();
  if (qerr && isMissingKeyRevisionColumn(qerr)) {
    const legacy = await db.from("questions")
      .select("id, ai_explanation, explanation")
      .eq("id", questionId)
      .maybeSingle();
    qrow = legacy.data ? { ...legacy.data, key_revision: null } : null;
    qerr = legacy.error;
  }

  if (qerr) {
    console.error("[translate] question lookup:", qerr);
    return NextResponse.json({ error: "Failed to load question" }, { status: 500 });
  }
  if (!qrow) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  const sourceText =
    field === "ai_explanation"
      ? (qrow.ai_explanation as string | null)
      : (qrow.explanation as string | null);
  if (!sourceText || !sourceText.trim()) {
    return NextResponse.json(
      { error: `No ${field} available to translate for this question.` },
      { status: 404 },
    );
  }

  // 3. Gates, in order: global spend (503 resting), per-user monthly legacy
  //    cost cap (429), then the DB-backed daily attempt (429). Any DB error
  //    refuses the call (fail closed). Cache hits returned above, uncounted.
  //    Free callers keep their 5 a day; Pro and admin take no daily attempt.
  const limits = getLegacyAiLimits();
  const free = isFreeAccess(guard);
  const dailyLimit = translateDailyLimit(free, limits.translateDailyAttempts);
  const meterDb = db as unknown as MeterDb;
  const gate = await legacyGate(meterDb, userId, "translate", dailyLimit);
  if (!gate.ok) {
    if (gate.kind === "daily" && dailyLimit !== null) {
      await logTranslateCapHit(db, { userId, limit: dailyLimit, questionId, lang, field });
    }
    const body =
      gate.kind === "resting"
        ? { error: "Translations are resting for now. Please try again later.", code: gate.code }
        : gate.kind === "user_cap"
          ? { error: "You have reached this month's AI limit. It resets at the start of next month.", code: gate.code }
          : gate.kind === "daily"
            ? {
                error: free
                  ? `Daily translation quota reached (${dailyLimit}). Upgrade to Pro for more.`
                  : `Daily translation limit reached (${dailyLimit}). Resets at midnight CET.`,
                code: gate.code,
              }
            : { error: "Translation is temporarily unavailable. Please try again shortly.", code: gate.code };
    return NextResponse.json(body, { status: gate.status });
  }

  // 4. Upstream call: Anthropic first (metered), then ONE fallback (metered):
  //    the Anthropic fallback model or OpenAI, chosen by the fallback slot.
  //    Every model call writes one ai_call_log row, failures included.
  const targetLangLabel = LANG_LABELS[lang] || lang;
  const system = buildTranslationSystem(targetLangLabel);
  const user = buildTranslationUser(sourceText);

  let translatedText = "";
  let sourceModel = "";

  const primaryModel = process.env.ANTHROPIC_TRANSLATE_MODEL || "claude-haiku-4-5";
  const fallback = resolveFallback([process.env.OPENAI_TRANSLATE_MODEL, process.env.AI_FALLBACK_MODEL]);
  let primaryRefused = false;

  {
    const res = await meteredClaude({
      db: meterDb,
      userId,
      route: "translate",
      model: primaryModel,
      system,
      user,
      maxTokens: 1400,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      questionId,
    });
    if (res.ok && res.text) {
      translatedText = res.text;
      sourceModel = primaryModel;
    } else if (!res.ok && !res.skipped && res.status === "refusal") {
      primaryRefused = true;
    }
  }

  // Anthropic fallback (the slot is a Claude model, for example
  // claude-sonnet-4-6): same wrapper, same key, own ai_call_log row. A refusal
  // is never re-sent to another model; a slot naming the primary is skipped.
  const fallbackClaudeModel = anthropicFallbackModel(fallback, primaryModel);
  if (!translatedText && !primaryRefused && fallbackClaudeModel) {
    const res = await meteredClaude({
      db: meterDb,
      userId,
      route: "translate",
      model: fallbackClaudeModel,
      system,
      user,
      maxTokens: 1400,
      timeoutMs: UPSTREAM_TIMEOUT_MS,
      questionId,
    });
    if (res.ok && res.text) {
      translatedText = res.text;
      sourceModel = fallbackClaudeModel;
    }
  }

  if (!translatedText && fallback.provider === "openai") {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const model = fallback.model;
      const started = Date.now();
      const inputBytes = new TextEncoder().encode(system + user).length;
      const resp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1400,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      let usage: { input_tokens: number; output_tokens: number } | null = null;
      let text = "";
      let ok = false;
      if (resp?.ok) {
        try {
          const data = await resp.json();
          text = data.choices?.[0]?.message?.content || "";
          const pt = Number(data.usage?.prompt_tokens);
          const ct = Number(data.usage?.completion_tokens);
          if (Number.isFinite(pt) && Number.isFinite(ct) && pt >= 0 && ct >= 0) {
            usage = { input_tokens: Math.floor(pt), output_tokens: Math.floor(ct) };
          }
          ok = !!text;
        } catch {
          /* unreadable body: booked below as a failure */
        }
      }
      // Cost: real usage when OpenAI reported it, else an input-bytes estimate;
      // a 4xx proves the model did not run, so it books 0.
      const rejected = !!resp && !resp.ok && resp.status >= 400 && resp.status < 500;
      const costMicro = rejected
        ? 0
        : (() => {
            const u = usage ?? { input_tokens: inputBytes, output_tokens: ok ? 1400 : 0 };
            return openaiCostMicro(model, u.input_tokens, u.output_tokens);
          })();
      await logAiCall(meterDb, {
        userId,
        route: "translate",
        provider: "openai",
        model,
        status: ok ? "ok" : "upstream_error",
        costMicro,
        inTokens: usage?.input_tokens ?? null,
        outTokens: usage?.output_tokens ?? null,
        durationMs: Date.now() - started,
        questionId,
        errorCode: ok ? null : resp ? `http_${resp.status}` : "network_or_timeout",
      });
      if (ok) {
        translatedText = text;
        sourceModel = model;
      }
    }
  }

  // Trim first: a whitespace-only or stub reply is a failed call, never cached
  // or shown as a translation (CNT-35: never an empty explanation).
  translatedText = translatedText.trim();
  if (!isUsableTranslation(translatedText, sourceText)) {
    return NextResponse.json(
      { error: "Translation service temporarily unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  // 5. Validate the pre-generation revision and exact source under the
  // question row lock. Never fall back to an unguarded insert on RPC failure.
  if (qrow.key_revision == null) {
    console.warn("[translate] cache write skipped: key_revision unavailable", { questionId, field });
  } else {
    try {
      const { data: cachedNow, error: insErr } = await db.rpc("cache_question_translation_if_current", {
        p_question_id: questionId,
        p_key_revision: qrow.key_revision,
        p_field: field,
        p_source_text: sourceText,
        p_lang: lang,
        p_translated_text: translatedText,
        p_source_model: sourceModel || null,
      });
      if (insErr) console.error("[translate] cache write:", insErr);
      else if (cachedNow === false) {
        // The question changed while translating; the next request re-translates.
        console.warn("[translate] cache write skipped: source changed", { questionId, field });
      }
    } catch (err) {
      console.error("[translate] cache insert:", err);
    }
  }

  // Analytics event for the upstream (cost-incurring) translation. The daily cap
  // itself is the DB-backed ai_quota_take above; cache hits return earlier.
  try {
    await db.from("user_events").insert({
      user_id: userId,
      event_type: "translation",
      event_data: { question_id: questionId, lang, field, model: sourceModel || null },
    });
  } catch {
    /* swallow — telemetry must not block the response */
  }

  return NextResponse.json({
    translatedText,
    lang,
    field,
    cached: false,
    sourceModel: sourceModel || null,
  });
}
