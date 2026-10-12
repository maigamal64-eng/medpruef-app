import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isFreeAccess } from "@/lib/auth-guard";
import { NoteAllowanceError, readNoteAllowance, remainingNotes } from "@/lib/notes-cap";
import {
  MAX_IMPORT_BATCH,
  NOTE_SELECT_COLUMNS,
  normalizeContent,
  buildSearchText,
  deriveTitle,
} from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/notes/import — one-time localStorage → server migration.
 *
 * The legacy per-question notes live only in localStorage (notes-store.ts,
 * key `medpruef_notes_<id>`, a JSON array of {id, text, updatedAt}). On first
 * Library load (Phase 4) the client reads every such key and POSTs them here so
 * a user's existing notes move server-side and sync cross-device.
 *
 * Body: { items: [ { question_id: number, entries: [{id, text, updatedAt}] } ] }
 *
 * Idempotent: each created note carries metadata.import_key
 * ('localStorage:<qid>:<entryId>'); a unique partial index + a pre-filter mean
 * a retried / double-fired import never duplicates. Imports BYPASS the 10-note
 * free cap (never lose a user's existing content) but the imported notes DO
 * count toward the cap for future creates.
 */

/** Convert an epoch-ms value to an ISO string, or undefined if implausible. */
function isoFromEpochMs(ms: unknown): string | undefined {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return undefined;
  // Reject absurd futures (> ~now + 1y) so a bad client clock can't poison ordering.
  const maxPlausible = Date.now() + 365 * 24 * 60 * 60 * 1000;
  if (ms > maxPlausible) return undefined;
  const d = new Date(ms);
  const t = d.getTime();
  if (!Number.isFinite(t)) return undefined;
  return d.toISOString();
}

interface Candidate {
  importKey: string;
  row: Record<string, unknown>;
}

async function handlePOST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    if (items.length === 0) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        skipped_existing: 0,
        skipped_over_limit: 0,
      });
    }

    // ── Flatten (question, entry) pairs into candidate note rows ──────────────
    const candidates: Candidate[] = [];
    let overLimit = 0;
    for (const item of items) {
      const qidRaw = (item as Record<string, unknown>)?.question_id;
      const questionId =
        typeof qidRaw === "number" && Number.isFinite(qidRaw) ? qidRaw : null;
      const entries = Array.isArray((item as Record<string, unknown>)?.entries)
        ? ((item as Record<string, unknown>).entries as unknown[])
        : [];
      for (const e of entries) {
        const entry = (e ?? {}) as Record<string, unknown>;
        const text = typeof entry.text === "string" ? entry.text.trim() : "";
        if (!text) continue;
        if (candidates.length >= MAX_IMPORT_BATCH) {
          overLimit++;
          continue;
        }
        const entryId =
          typeof entry.id === "string" && entry.id ? entry.id : `i${candidates.length}`;
        const importKey = `localStorage:${questionId ?? "none"}:${entryId}`;
        const content = normalizeContent({
          blocks: [{ type: "keyfact", text }],
        });
        content.title = deriveTitle(content);
        const createdAt = isoFromEpochMs(entry.updatedAt);
        const row: Record<string, unknown> = {
          user_id: userId,
          source_type: "user_note",
          source_ref: questionId !== null ? { question_id: questionId } : null,
          title: content.title,
          content,
          tags: content.tags,
          metadata: { import_key: importKey, created_from: "localStorage_import" },
          search_text: buildSearchText(content),
        };
        if (createdAt) row.created_at = createdAt;
        candidates.push({ importKey, row });
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        skipped_existing: 0,
        skipped_over_limit: overLimit,
      });
    }

    const sb = getServiceClient();

    // ── Skip already-imported keys (idempotency) ──────────────────────────────
    const { data: existing, error: existErr } = await sb
      .from("notes")
      .select("metadata")
      .eq("user_id", userId)
      .not("metadata->>import_key", "is", null);
    if (existErr) {
      console.error("[notes/import] existing-key lookup", existErr);
      return NextResponse.json(
        { error: "Failed to prepare import" },
        { status: 500 },
      );
    }
    const existingKeys = new Set<string>();
    for (const r of existing ?? []) {
      const k = (r as { metadata?: { import_key?: string } })?.metadata?.import_key;
      if (typeof k === "string") existingKeys.add(k);
    }

    // Also de-dupe within the batch itself (two entries colliding on a key).
    const seenInBatch = new Set<string>();
    const fresh = candidates
      .filter((c) => {
        if (existingKeys.has(c.importKey) || seenInBatch.has(c.importKey)) return false;
        seenInBatch.add(c.importKey);
        return true;
      })
      .map((c) => c.row);

    const skippedExisting = candidates.length - fresh.length;

    // a25 (pick-ux-stu-51 B): free accounts import only into the slots left
    // in their lifetime allowance; the rest is reported, never inserted.
    let toInsert = fresh;
    if (isFreeAccess(guard) && fresh.length > 0) {
      let left: number;
      try {
        left = remainingNotes(await readNoteAllowance(sb, userId));
      } catch (err) {
        if (!(err instanceof NoteAllowanceError)) throw err;
        console.error("[notes/import] allowance read", err.detail);
        return NextResponse.json({ error: "Failed to prepare import" }, { status: 500 });
      }
      if (fresh.length > left) {
        overLimit += fresh.length - left;
        toInsert = fresh.slice(0, left);
      }
    }

    if (toInsert.length === 0) {
      return NextResponse.json({
        ok: true,
        imported: 0,
        skipped_existing: skippedExisting,
        skipped_over_limit: overLimit,
      });
    }

    const { data: inserted, error: insErr } = await sb
      .from("notes")
      .insert(toInsert)
      .select(NOTE_SELECT_COLUMNS);

    if (insErr) {
      // 23505 = unique_violation: a concurrent import already wrote some keys.
      // Treat as idempotent success — the rows exist, which is the goal.
      if ((insErr as { code?: string }).code === "23505") {
        return NextResponse.json({
          ok: true,
          imported: 0,
          skipped_existing: candidates.length,
          skipped_over_limit: overLimit,
          note: "Concurrent import already applied",
        });
      }
      console.error("[notes/import] insert", insErr);
      return NextResponse.json({ error: "Failed to import notes" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      imported: inserted?.length ?? 0,
      skipped_existing: skippedExisting,
      skipped_over_limit: overLimit,
      notes: inserted ?? [],
    });
  } catch (err) {
    console.error("[notes/import]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const POST = withDbUnavailable(handlePOST);
