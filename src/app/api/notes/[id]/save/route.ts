import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser, isPaidAccess } from "@/lib/auth-guard";
import { DEFAULT_COLLECTION_NAME } from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/notes/[id]/save — the LIGHTWEIGHT "save to my Library": a reference
 * into one of the caller's collections. No clone, no create-cap hit (EXP-1 §4).
 *
 * Body { collection_id?, lang? }. With no collection_id the note goes into the
 * user's default "Saved" list, lazily created on first save. Saving is idempotent
 * (PK on (collection_id, note_id)); saving twice returns ok.
 *
 * Gating (mirrors the old clone Pro-gate, but only where it makes sense):
 *   - saving your OWN note → always allowed (that is just organizing).
 *   - saving a PUBLIC note you don't own (community/curated) → Pro-gated (402),
 *     the coherent read-free / save-Pro upsell. Admins pass.
 *
 * DELETE /api/notes/[id]/save?collection_id=… — unsave from that collection
 * (or from ALL the caller's collections if collection_id is omitted).
 */

/** Find-or-create the caller's default "Saved" collection. */
async function getDefaultCollection(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  lang: string,
): Promise<{ id: string } | { error: unknown }> {
  const { data: existing, error: findErr } = await sb
    .from("note_collections")
    .select("id")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  if (findErr) return { error: findErr };
  if (existing) return { id: existing.id as string };

  const name = lang === "en" ? DEFAULT_COLLECTION_NAME.en : DEFAULT_COLLECTION_NAME.de;
  const { data: created, error: insErr } = await sb
    .from("note_collections")
    .insert({ user_id: userId, name, is_default: true })
    .select("id")
    .single();
  if (insErr) {
    // Race: another request created it first (partial-unique on default). Re-read.
    if ((insErr as { code?: string }).code === "23505") {
      const { data: again } = await sb
        .from("note_collections")
        .select("id")
        .eq("user_id", userId)
        .eq("is_default", true)
        .maybeSingle();
      if (again) return { id: again.id as string };
    }
    return { error: insErr };
  }
  return { id: created.id as string };
}

/**
 * GET /api/notes/[id]/save — which of the caller's collections already contain
 * this note (for the reader's save-state + toggle). Returns { collection_ids }.
 */
async function handleGET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    const { data: cols, error: colErr } = await sb
      .from("note_collections")
      .select("id")
      .eq("user_id", userId);
    if (colErr) {
      console.error("[notes/[id]/save GET] cols", colErr);
      return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
    const ids = (cols ?? []).map((c) => c.id as string);
    if (ids.length === 0) {
      return NextResponse.json({ collection_ids: [] });
    }
    const { data: items, error } = await sb
      .from("note_collection_items")
      .select("collection_id")
      .eq("note_id", id)
      .in("collection_id", ids);
    if (error) {
      console.error("[notes/[id]/save GET]", error);
      return NextResponse.json({ error: "Failed" }, { status: 500 });
    }
    return NextResponse.json({
      collection_ids: (items ?? []).map((i) => i.collection_id as string),
    });
  } catch (err) {
    console.error("[notes/[id]/save GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handlePOST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const explicitCollectionId =
      typeof body?.collection_id === "string" && UUID_RE.test(body.collection_id)
        ? (body.collection_id as string)
        : null;
    const lang = body?.lang === "en" ? "en" : "de";

    const sb = getServiceClient();

    // Load the note (must exist + be active). Determine ownership + publicness.
    const { data: note, error: noteErr } = await sb
      .from("notes")
      .select("id, user_id, visibility, is_active")
      .eq("id", id)
      .maybeSingle();
    if (noteErr) {
      console.error("[notes/[id]/save] load", noteErr);
      return NextResponse.json({ error: "Failed to load note" }, { status: 500 });
    }
    if (!note || note.is_active !== true) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const owns = note.user_id === userId;
    const isPublic = note.visibility === "public";
    // Can only reference a note you either own or that is public. A foreign
    // private note is invisible (don't leak existence).
    if (!owns && !isPublic) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Pro-gate: saving a foreign public note is the paid upsell.
    if (!owns && !isPaidAccess(guard)) {
      return NextResponse.json(
        { error: "Saving community notes is a Pro feature.", gate: "notes" },
        { status: 402 },
      );
    }

    // Resolve the target collection (explicit + owned, or the default).
    let collectionId: string;
    if (explicitCollectionId) {
      const { data: col, error: colErr } = await sb
        .from("note_collections")
        .select("id, user_id")
        .eq("id", explicitCollectionId)
        .maybeSingle();
      if (colErr) {
        console.error("[notes/[id]/save] collection", colErr);
        return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
      if (!col || col.user_id !== userId) {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 },
        );
      }
      collectionId = col.id as string;
    } else {
      const def = await getDefaultCollection(sb, userId, lang);
      if ("error" in def) {
        console.error("[notes/[id]/save] default", def.error);
        return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
      collectionId = def.id;
    }

    const { error: insErr } = await sb.from("note_collection_items").insert({
      collection_id: collectionId,
      note_id: id,
      is_reference: !owns,
    });
    if (insErr) {
      // Already in this collection → idempotent success.
      if ((insErr as { code?: string }).code === "23505") {
        return NextResponse.json({
          ok: true,
          already_saved: true,
          collection_id: collectionId,
        });
      }
      console.error("[notes/[id]/save] insert", insErr);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }

    return NextResponse.json(
      { ok: true, collection_id: collectionId },
      { status: 201 },
    );
  } catch (err) {
    console.error("[notes/[id]/save]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

async function handleDELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  try {
    const url = new URL(req.url);
    const collectionId = url.searchParams.get("collection_id");

    const sb = getServiceClient();
    // Collect the caller's collection ids so a user can never unsave from
    // someone else's collection.
    const { data: cols, error: colErr } = await sb
      .from("note_collections")
      .select("id")
      .eq("user_id", userId);
    if (colErr) {
      console.error("[notes/[id]/save DELETE] cols", colErr);
      return NextResponse.json({ error: "Failed to unsave" }, { status: 500 });
    }
    let ids = (cols ?? []).map((c) => c.id as string);
    if (collectionId && UUID_RE.test(collectionId)) {
      ids = ids.filter((c) => c === collectionId);
    }
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, removed: 0 });
    }

    const { data, error } = await sb
      .from("note_collection_items")
      .delete()
      .eq("note_id", id)
      .in("collection_id", ids)
      .select("collection_id");
    if (error) {
      console.error("[notes/[id]/save DELETE]", error);
      return NextResponse.json({ error: "Failed to unsave" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, removed: (data ?? []).length });
  } catch (err) {
    console.error("[notes/[id]/save DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
export const DELETE = withDbUnavailable(handleDELETE);
