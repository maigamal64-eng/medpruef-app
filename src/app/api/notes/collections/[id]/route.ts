import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import {
  NOTE_SELECT_COLUMNS,
  normalizeCollectionName,
  noteKindFromMetadata,
} from "@/lib/notes";
import { noteReviewFromMetadata } from "@/lib/notes-review";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Ctx = { params: Promise<{ id: string }> };

/**
 * /api/notes/collections/[id]
 *
 * GET    → the collection's notes (owner-only). Each item is the full note plus
 *          `is_reference` (true = saved from Explore, not authored by the user)
 *          and the derived `curated`/`kind` so the Library reader labels it.
 * PATCH  → rename (owner-only). Body { name }.
 * DELETE → delete the collection (owner-only). The default "Saved" list can be
 *          deleted too; it is recreated lazily on the next save.
 *
 * Membership rows CASCADE with the collection; the referenced notes are untouched.
 */

async function ownCollection(
  sb: ReturnType<typeof getServiceClient>,
  id: string,
  userId: string,
) {
  const { data, error } = await sb
    .from("note_collections")
    .select("id, user_id, name, is_default")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error };
  if (!data || data.user_id !== userId) return { notFound: true as const };
  return { collection: data };
}

// ── GET: items ───────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    const owned = await ownCollection(sb, id, userId);
    if ("error" in owned && owned.error) {
      console.error("[collections/[id] GET] own", owned.error);
      return NextResponse.json({ error: "Failed to load" }, { status: 500 });
    }
    if ("notFound" in owned) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: items, error: itemErr } = await sb
      .from("note_collection_items")
      .select("note_id, is_reference, added_at")
      .eq("collection_id", id)
      .order("added_at", { ascending: false });
    if (itemErr) {
      console.error("[collections/[id] GET] items", itemErr);
      return NextResponse.json({ error: "Failed to load" }, { status: 500 });
    }

    const noteIds = (items ?? []).map((i) => i.note_id as string);
    let notesById = new Map<string, Record<string, unknown>>();
    if (noteIds.length > 0) {
      const { data: notes, error: notesErr } = await sb
        .from("notes")
        .select(NOTE_SELECT_COLUMNS)
        .in("id", noteIds)
        .eq("is_active", true);
      if (notesErr) {
        console.error("[collections/[id] GET] notes", notesErr);
        return NextResponse.json({ error: "Failed to load" }, { status: 500 });
      }
      notesById = new Map(
        (notes ?? []).map((n) => [n.id as string, n]),
      );
    }

    const refMeta = new Map(
      (items ?? []).map((i) => [i.note_id as string, Boolean(i.is_reference)]),
    );

    // Preserve added_at ordering; drop items whose note no longer exists/active.
    const out = noteIds
      .map((nid) => {
        const n = notesById.get(nid);
        if (!n) return null;
        const { curated, kind } = noteKindFromMetadata(
          n.metadata as Record<string, unknown> | null,
        );
        const isReference = refMeta.get(nid) ?? false;
        // Strip raw metadata + user_id for referenced (foreign) notes to keep the
        // anonymous posture; own notes keep their full row.
        const owns = n.user_id === userId;
        return {
          note: owns
            ? n
            : {
                id: n.id,
                title: n.title,
                content: n.content,
                tags: n.tags,
                exam_type: n.exam_type,
                topic: n.topic,
                source_type: n.source_type,
                visibility: n.visibility,
                is_active: n.is_active,
                created_at: n.created_at,
                updated_at: n.updated_at,
              },
          is_reference: isReference,
          is_owner: owns,
          curated,
          kind,
          review: noteReviewFromMetadata(n.metadata as Record<string, unknown> | null, n.source_type),
        };
      })
      .filter(Boolean);

    return NextResponse.json({
      collection: {
        id: owned.collection.id,
        name: owned.collection.name,
        is_default: owned.collection.is_default,
      },
      items: out,
    });
  } catch (err) {
    console.error("[collections/[id] GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── PATCH: rename ────────────────────────────────────────────────────────────
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const name = normalizeCollectionName(body?.name);
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const sb = getServiceClient();
    const { data, error } = await sb
      .from("note_collections")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id, name, is_default, created_at, updated_at")
      .maybeSingle();
    if (error) {
      console.error("[collections/[id] PATCH]", error);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ collection: data });
  } catch (err) {
    console.error("[collections/[id] PATCH]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("note_collections")
      .delete()
      .eq("id", id)
      .eq("user_id", userId)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[collections/[id] DELETE]", error);
      return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("[collections/[id] DELETE]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
