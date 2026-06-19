import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
 *   first, fall back to OpenAI (gpt-4o-mini), then cache + return.
 * - Rate-limit: 5 translations/day for free tier. Pro + admin
 *   unlimited (but still logged for analytics/cost tracking).
 * - Prompt preserves medical terminology — drug names, anatomical
 *   structures, eponyms stay in German or the standard international
 *   spelling. The model is told this explicitly.
 * - 20s upstream timeout so a slow provider doesn't stall the fn.
 */

const UPSTREAM_TIMEOUT_MS = 20_000;
const FREE_DAILY_QUOTA = 5;
// Paid (Pro/admin) daily cap on NEW (upstream) translations. Generous for real
// use (one click per question) but blocks programmatic cost runaway. Cache hits
// are free and never counted. Overridable via env.
const PAID_DAILY_QUOTA = (() => {
  const raw = Number(process.env.AI_TRANSLATE_QUOTA_PAID);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 200;
})();

// ────────────────────────────────────────────────────────────────────
// AI kill switch — mirrors /api/ai-chat (GATE 1). Without this, translate
// would call Anthropic/OpenAI even while AI_FEATURES_ENABLED=false, breaking
// the documented "instantly disable all AI" guarantee and leaking spend.
// ────────────────────────────────────────────────────────────────────
const AI_FEATURES_ENABLED = (process.env.AI_FEATURES_ENABLED ?? "true") === "true";
type ProviderMode = "auto" | "claude_oauth" | "openai" | "disabled";
const AI_PROVIDER_MODE: ProviderMode =
  (process.env.AI_PROVIDER_MODE as ProviderMode | undefined) ?? "auto";

const SUPPORTED_LANGS = new Set([
  "ru", // Russian
  "ar", // Arabic
  "en", // English
  "fr", // French
  "tr", // Turkish
  "uk", // Ukrainian
  "sr", // Serbian
]);

const LANG_LABELS: Record<string, string> = {
  ru: "Russian",
  ar: "Arabic",
  en: "English",
  fr: "French",
  tr: "Turkish",
  uk: "Ukrainian",
  sr: "Serbian",
};

const SUPPORTED_FIELDS = new Set(["ai_explanation", "explanation"]);

function buildPrompt(targetLangLabel: string, sourceText: string): string {
  return [
    `You are translating a medical exam explanation from German into ${targetLangLabel}.`,
    "",
    "STRICT RULES:",
    `- Output only the translated text in ${targetLangLabel}. No preamble, no apology, no markdown fences.`,
    "- PRESERVE medical terminology in its standard international or German form. Do NOT translate:",
    "  * drug names (e.g. Acetylsalicylsäure, Metoprolol, Amoxicillin)",
    "  * anatomical structures in Latin/Greek (e.g. Musculus biceps brachii, Arteria carotis)",
    "  * eponyms (e.g. Mallory-Weiss-Syndrom, Morbus Crohn)",
    "  * guideline names and abbreviations (ERC 2021, ESC, ÖDG, AGES, WHO, ATLS)",
    "  * units and lab values (mg/dl, mmol/l, IE)",
    `- Translate the surrounding clinical reasoning and connective prose into natural ${targetLangLabel}.`,
    "- Keep the same structure (headings, bullets, **bold**, lists) as the source.",
    "- If the source is already in the target language, return it unchanged.",
    "- Never add content that isn't in the source.",
    "",
    "SOURCE TEXT:",
    sourceText,
  ].join("\n");
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
        error: "Too many translation requests — please wait a moment.",
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
    if (cached?.translated_text) {
      return NextResponse.json({
        translatedText: cached.translated_text,
        lang,
        field,
        cached: true,
        sourceModel: cached.source_model || null,
      });
    }
  }

  // 2. Quota check (free tier only). Counts today's translation events
  //    via user_events.event_type='translation'. Fails open on error
  //    so a DB hiccup doesn't block the user.
  //
  //    2026-04-24: switched from `tier === "free"` to `isFreeAccess(guard)`
  //    so /admin/ operators (role='admin' but tier='free') aren't
  //    quota-limited. Same fix pattern as /api/ai-chat.
  {
    const free = isFreeAccess(guard);
    const dailyCap = free ? FREE_DAILY_QUOTA : PAID_DAILY_QUOTA;
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { count } = await db
        .from("user_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("event_type", "translation")
        .gte("created_at", since.toISOString());
      if (typeof count === "number" && count >= dailyCap) {
        return NextResponse.json(
          {
            error: free
              ? `Daily translation quota reached (${FREE_DAILY_QUOTA}). Upgrade to Pro for more.`
              : `Daily translation limit reached (${PAID_DAILY_QUOTA}). Resets at midnight CET.`,
            code: "QUOTA_EXCEEDED",
          },
          { status: 429 },
        );
      }
    } catch (err) {
      console.error("[translate] quota check failed (failing open):", err);
    }
  }

  // 3. Load source text from the questions table.
  const { data: qrow, error: qerr } = await db
    .from("questions")
    .select("id, ai_explanation, explanation")
    .eq("id", questionId)
    .maybeSingle();

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

  // 4. Upstream call — Anthropic first, OpenAI fallback.
  const targetLangLabel = LANG_LABELS[lang] || lang;
  const prompt = buildPrompt(targetLangLabel, sourceText);

  let translatedText = "";
  let sourceModel = "";

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const model = process.env.ANTHROPIC_TRANSLATE_MODEL || "claude-haiku-4-5";
    const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (resp?.ok) {
      const data = await resp.json();
      translatedText = data.content?.[0]?.text || "";
      if (translatedText) sourceModel = model;
    }
  }

  if (!translatedText) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      const model = process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini";
      const resp = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1400,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (resp?.ok) {
        const data = await resp.json();
        translatedText = data.choices?.[0]?.message?.content || "";
        if (translatedText) sourceModel = model;
      }
    }
  }

  if (!translatedText) {
    return NextResponse.json(
      { error: "Translation service temporarily unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  translatedText = translatedText.trim();

  // 5. Cache the result. ON CONFLICT DO NOTHING so concurrent callers
  //    race-safely — whoever lands first wins, the others can re-read.
  try {
    const { error: insErr } = await db.from("question_translations").insert({
      question_id: questionId,
      lang,
      field,
      translated_text: translatedText,
      source_model: sourceModel || null,
    });
    // unique constraint conflict (23505) is expected on rare races — silently ignore.
    if (insErr && insErr.code !== "23505") {
      console.error("[translate] cache write:", insErr);
    }
  } catch (err) {
    console.error("[translate] cache insert:", err);
  }

  // Log the upstream (cost-incurring) translation so the per-tier daily cap
  // above actually counts. Cache hits return earlier and are never logged.
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
