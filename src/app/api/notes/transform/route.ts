import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { canFreeUserReadQuestion, logFreeCapHit } from "@/lib/free-access";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import {
  FREE_NOTE_LIMIT,
  NOTE_SELECT_COLUMNS,
  buildNoteRow,
  type NoteSourceType,
} from "@/lib/notes";

export const dynamic = "force-dynamic";

/**
 * POST /api/notes/transform — turn raw study content into structured flash-notes
 * via Haiku (the feature's "edge"). Model: claude-haiku-4-5 (cheap, fast,
 * structured). Mirrors the upstream-call discipline of /api/translate exactly:
 * the AI kill-switch gate, a per-user burst limit, a timed fetch, and graceful
 * degradation (validate → one repair retry → raw fallback so a user's content is
 * NEVER lost to a model hiccup).
 *
 * Body: { kind: 'question'|'user_note'|'ai_explanation',
 *         source_ref?: { question_id?, message_id? },
 *         text?: string,            // required for user_note / free-text ai_explanation
 *         exam_type?, topic? }
 *
 * - kind='question'      → loads the question server-side (stem+answer+expl) and
 *                          is idempotent: re-transforming a question returns the
 *                          existing note instead of re-charging Haiku / duplicating.
 * - kind='user_note'     → transforms the user's note text.
 * - kind='ai_explanation'→ transforms an AI explanation (text, or the question's
 *                          ai_explanation when only question_id is given).
 *
 * Creates 1 note (usual) or 2-4 linked notes for large multi-concept content
 * (note_links, kind='sequence'). Counts toward the 10-note free cap.
 */

const AI_FEATURES_ENABLED =
  (process.env.AI_FEATURES_ENABLED ?? "true") === "true";
type ProviderMode = "auto" | "claude_oauth" | "openai" | "disabled";
const AI_PROVIDER_MODE: ProviderMode =
  (process.env.AI_PROVIDER_MODE as ProviderMode | undefined) ?? "auto";

const UPSTREAM_TIMEOUT_MS = 25_000;
const TRANSFORM_BURST_LIMIT = { limit: 8, windowMs: 60_000 };
const MAX_NOTES_PER_TRANSFORM = 4;
const MAX_INPUT_CHARS = 8000;

type TransformKind = "question" | "user_note" | "ai_explanation";
const KIND_SOURCE_TYPE: Record<TransformKind, NoteSourceType> = {
  question: "bookmark",
  user_note: "user_note",
  ai_explanation: "ai_explanation",
};

// Note output languages the user can pick (superset of the UI's de/en, matching
// the translate route's supported set).
const NOTE_LANGS: Record<string, string> = {
  de: "German",
  en: "English",
  ru: "Russian",
  ar: "Arabic",
  fr: "French",
  tr: "Turkish",
  uk: "Ukrainian",
  sr: "Serbian",
};

interface PromptOpts {
  langLabel?: string | null;
  focus?: string;
  answerContext?: string;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    console.error("[notes/transform] upstream error:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt(sourceText: string, opts: PromptOpts = {}): string {
  const langLine = opts.langLabel
    ? `- Write the note ENTIRELY in ${opts.langLabel}. Keep medical terms (drug names, Latin anatomy, eponyms, guideline names, units) in their standard German/international form even when translating.`
    : "- Write in the SAME language as the source (German stays German).";
  return [
    "You convert medical exam study content into structured flash-note cards for a doctor revising for the Austrian Kenntnisprüfung.",
    "",
    "Return ONLY raw JSON, no markdown fences, no preamble. Exact shape:",
    '{"notes":[{"title":"string","blocks":[{"type":"concept","front":"recall prompt","back":"answer"},{"type":"keyfact","text":"..."},{"type":"pitfall","text":"a common trap"},{"type":"mnemonic","text":"..."}],"tags":["..."],"refs":[{"label":"ERC 2021","kind":"guideline"}]}]}',
    "",
    "RULES:",
    "- Usually return ONE note. Split into 2-4 linked notes ONLY when the source clearly covers several distinct concepts AND is long.",
    "- Each note: a short clear title and 2-6 blocks. Lead with a `concept` block (front = a recall question, back = the answer), then key facts / pitfalls / an optional mnemonic.",
    "- Block types are EXACTLY: concept (needs front+back), keyfact (needs text), pitfall (needs text), mnemonic (needs text). Use no other type.",
    langLine,
    opts.focus
      ? `- The user specifically wants this note to focus on: "${opts.focus}". Prioritise that angle.`
      : "",
    opts.answerContext
      ? `- Learner context: ${opts.answerContext} Shape the note (especially the pitfall) to address exactly that.`
      : "",
    "- PRESERVE medical terminology verbatim: drug names (Acetylsalicylsäure, Metoprolol), Latin anatomy (Arteria carotis), eponyms (Morbus Crohn), guideline names (ERC 2021, ESC, ÖDG), units (mg/dl, mmol/l).",
    "- NEVER invent facts that are not supported by the source. 3-6 tags, lowercase.",
    "",
    "SOURCE CONTENT:",
    sourceText.slice(0, MAX_INPUT_CHARS),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Strip code fences and parse; return the notes array or null. */
function parseNotesJson(raw: string): unknown[] | null {
  if (!raw) return null;
  let s = raw.trim();
  // Remove ```json ... ``` fences if the model added them.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  // Fall back to the outermost {...} if there's stray prose.
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const brace = s.indexOf("{");
    if (brace >= 0) s = s.slice(brace);
  }
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).notes)) {
      return (parsed as { notes: unknown[] }).notes;
    }
    // A single bare note object.
    if (parsed && typeof parsed === "object") return [parsed];
    return null;
  } catch {
    return null;
  }
}

async function callHaiku(prompt: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) return "";
  const model = process.env.ANTHROPIC_NOTES_MODEL || "claude-haiku-4-5";
  const resp = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp?.ok) return "";
  const data = await resp.json();
  return data.content?.[0]?.text || "";
}

export async function POST(req: NextRequest) {
  // GATE 1: AI kill-switch — same contract as /api/translate + /api/ai-chat.
  if (!AI_FEATURES_ENABLED || AI_PROVIDER_MODE === "disabled") {
    return NextResponse.json(
      { error: "ai_disabled", message: "AI features are temporarily paused." },
      { status: 503 },
    );
  }

  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const burst = checkRateLimit({
    key: rateKey("notes-transform", userId),
    ...TRANSFORM_BURST_LIMIT,
  });
  if (!burst.allowed) {
    return NextResponse.json(
      { error: "Too many requests, please wait a moment.", retryAfter: burst.retryAfterSec },
      { status: 429, headers: rateLimitHeaders(burst, TRANSFORM_BURST_LIMIT) },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kind = body?.kind as TransformKind;
    if (kind !== "question" && kind !== "user_note" && kind !== "ai_explanation") {
      return NextResponse.json(
        { error: "Invalid kind. Must be question | user_note | ai_explanation" },
        { status: 400 },
      );
    }

    const sb = getServiceClient();
    const sourceType = KIND_SOURCE_TYPE[kind];

    const sourceRefIn =
      body?.source_ref && typeof body.source_ref === "object" ? body.source_ref : {};
    const qidRaw = (sourceRefIn as Record<string, unknown>).question_id;
    const questionId =
      typeof qidRaw === "number" && Number.isInteger(qidRaw) && qidRaw > 0
        ? qidRaw
        : null;
    const clientText = typeof body?.text === "string" ? body.text.trim() : "";
    // Optional creation controls (one-tap default = none of these set).
    const noteLang =
      typeof body?.lang === "string" && NOTE_LANGS[body.lang] ? body.lang : null;
    const focus =
      typeof body?.focus === "string" ? body.focus.trim().slice(0, 300) : "";
    const userAnswer =
      typeof body?.user_answer === "string"
        ? body.user_answer.trim().slice(0, 500)
        : "";
    const wasCorrect =
      typeof body?.was_correct === "boolean" ? body.was_correct : null;

    // ── Idempotency / cache: a question already turned into a note returns the
    //    existing note (no re-charge, no duplicate). ───────────────────────────
    if (kind === "question" && questionId !== null) {
      const { data: existingNote } = await sb
        .from("notes")
        .select(NOTE_SELECT_COLUMNS)
        .eq("user_id", userId)
        .eq("source_type", "bookmark")
        .eq("source_ref->>question_id", String(questionId))
        .eq("is_active", true)
        .maybeSingle();
      if (existingNote) {
        return NextResponse.json({ notes: [existingNote], created: 0, cached: true });
      }
    }

    // ── Assemble the source text + the note's exam_type/topic ─────────────────
    let sourceText = "";
    let examType: string | null =
      typeof body?.exam_type === "string" ? body.exam_type : null;
    let topic: string | null = typeof body?.topic === "string" ? body.topic : null;
    const sourceRef: Record<string, unknown> = {};
    if (questionId !== null) sourceRef.question_id = questionId;
    if (typeof (sourceRefIn as Record<string, unknown>).message_id === "string") {
      sourceRef.message_id = (sourceRefIn as Record<string, unknown>).message_id;
    }

    // 2026-10-02 paywall: building a note from a question reads its full
    // stem + answer + explanation server-side, so a free caller may only do
    // it for questions inside their free allowance.
    if (
      isFreeAccess(guard) &&
      questionId !== null &&
      (kind === "question" || (kind === "ai_explanation" && !clientText)) &&
      !(await canFreeUserReadQuestion(sb, userId, questionId))
    ) {
      await logFreeCapHit(sb, {
        userId,
        gate: "qbank_limit",
        route: "/api/notes/transform",
        questionId,
      });
      return NextResponse.json(
        { error: "upgrade_required", upgradeRequired: true, gate: "qbank_limit" },
        { status: 402 },
      );
    }

    if (kind === "question") {
      if (questionId === null) {
        return NextResponse.json(
          { error: "source_ref.question_id required for kind=question" },
          { status: 400 },
        );
      }
      const { data: q, error: qErr } = await sb
        .from("questions")
        .select("id, question, answer, explanation, ai_explanation, topic, exam_type, image_url")
        .eq("id", questionId)
        .maybeSingle();
      if (qErr) {
        console.error("[notes/transform] question load", qErr);
        return NextResponse.json({ error: "Failed to load question" }, { status: 500 });
      }
      if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });
      examType = examType || (q.exam_type as string | null);
      topic = topic || (q.topic as string | null);
      if (q.image_url) sourceRef.image_url = q.image_url as string;
      // Keep a short excerpt of the question stem so the note's references can
      // show what it came from without re-fetching.
      if (q.question) sourceRef.question_excerpt = String(q.question).slice(0, 240);
      const expl =
        (q.explanation as string | null)?.trim() ||
        (q.ai_explanation as string | null)?.trim() ||
        "";
      sourceText = [
        `Question: ${q.question ?? ""}`,
        `Answer: ${q.answer ?? ""}`,
        expl ? `Explanation: ${expl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    } else if (kind === "ai_explanation") {
      if (clientText) {
        sourceText = clientText;
        sourceRef.message_excerpt = clientText.slice(0, 240);
      } else if (questionId !== null) {
        const { data: q } = await sb
          .from("questions")
          .select("ai_explanation, explanation, topic, exam_type")
          .eq("id", questionId)
          .maybeSingle();
        examType = examType || (q?.exam_type as string | null) || null;
        topic = topic || (q?.topic as string | null) || null;
        sourceText =
          (q?.ai_explanation as string | null)?.trim() ||
          (q?.explanation as string | null)?.trim() ||
          "";
      }
    } else {
      // user_note
      sourceText = clientText;
    }

    if (!sourceText || sourceText.trim().length < 3) {
      return NextResponse.json(
        { error: "No content to transform." },
        { status: 400 },
      );
    }

    // ── Free-cap pre-check (transform creates notes; they count) ──────────────
    let remaining = Infinity;
    if (isFreeAccess(guard)) {
      const { count, error: cErr } = await sb
        .from("notes")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_active", true);
      if (cErr) {
        console.error("[notes/transform] cap count", cErr);
        return NextResponse.json({ error: "Failed to check note allowance" }, { status: 500 });
      }
      remaining = FREE_NOTE_LIMIT - (count ?? 0);
      if (remaining <= 0) {
        return NextResponse.json(
          { error: "Free note limit reached", gate: "notes", limit: FREE_NOTE_LIMIT },
          { status: 402 },
        );
      }
    }

    // Learner context (only for a question, when the client passes the answer).
    let answerContext = "";
    if (kind === "question" && userAnswer) {
      answerContext =
        wasCorrect === false
          ? `the student answered "${userAnswer}" and got it WRONG — make clear why that is wrong and why the correct answer is right.`
          : wasCorrect === true
            ? `the student answered "${userAnswer}" correctly — reinforce the key reasoning and the most testable details.`
            : `the student's answer was "${userAnswer}".`;
    }

    // ── Haiku transform with validate → repair → fallback ─────────────────────
    const prompt = buildPrompt(sourceText, {
      langLabel: noteLang ? NOTE_LANGS[noteLang] : null,
      focus,
      answerContext,
    });
    let notesRaw = parseNotesJson(await callHaiku(prompt));
    if (!notesRaw || notesRaw.length === 0) {
      // one repair retry with an explicit nudge
      notesRaw = parseNotesJson(
        await callHaiku(
          prompt +
            '\n\nReturn ONLY the JSON object {"notes":[...]} and nothing else.',
        ),
      );
    }

    // Build candidate rows (normalized). Fallback to a single raw note so the
    // user's content is never lost if the model failed entirely.
    let candidateRows: Record<string, unknown>[] = [];
    if (notesRaw && notesRaw.length > 0) {
      candidateRows = notesRaw
        .slice(0, MAX_NOTES_PER_TRANSFORM)
        .map((n) =>
          buildNoteRow(userId, {
            source_type: sourceType,
            source_ref: sourceRef,
            rawContent: n,
            exam_type: examType,
            topic,
            metadata: { created_from: "haiku_transform", source_model: process.env.ANTHROPIC_NOTES_MODEL || "claude-haiku-4-5", note_lang: noteLang },
          }),
        )
        // drop any note that normalized to zero blocks
        .filter((row) => {
          const c = row.content as { blocks?: unknown[] };
          return Array.isArray(c?.blocks) && c.blocks.length > 0;
        });
    }
    if (candidateRows.length === 0) {
      candidateRows = [
        buildNoteRow(userId, {
          source_type: sourceType,
          source_ref: sourceRef,
          rawContent: { blocks: [{ type: "keyfact", text: sourceText }] },
          exam_type: examType,
          topic,
          metadata: { created_from: "haiku_transform_fallback", note_lang: noteLang },
        }),
      ];
    }

    // Trim to the free user's remaining allowance.
    let capped = false;
    if (candidateRows.length > remaining) {
      candidateRows = candidateRows.slice(0, remaining);
      capped = true;
    }

    // ── Insert sequentially (preserves order so links wire parent→children) ───
    const created: Record<string, unknown>[] = [];
    for (const row of candidateRows) {
      const { data, error } = await sb
        .from("notes")
        .insert(row)
        .select(NOTE_SELECT_COLUMNS)
        .single();
      if (error) {
        console.error("[notes/transform] insert", error);
        break;
      }
      created.push(data);
    }

    if (created.length === 0) {
      return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
    }

    // Wire sequence links for a multi-note split (parent = first).
    if (created.length > 1) {
      const parentId = (created[0] as { id: string }).id;
      const links = created.slice(1).map((c) => ({
        parent_note_id: parentId,
        child_note_id: (c as { id: string }).id,
        kind: "sequence",
      }));
      const { error: linkErr } = await sb.from("note_links").insert(links);
      if (linkErr) console.error("[notes/transform] link", linkErr);
    }

    return NextResponse.json(
      { notes: created, created: created.length, capped },
      { status: 201 },
    );
  } catch (err) {
    console.error("[notes/transform]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
