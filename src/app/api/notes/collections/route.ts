import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import {
  MAX_COLLECTIONS,
  normalizeCollectionName,
} from "@/lib/notes";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/notes/collections — the user's own lists/collections for organizing
 * notes (owned + saved-from-Explore).
 *
 * GET  → list the caller's collections, each with an item_count.
 * POST → create a named collection. Body { name }.
 *
 * Auth: requireUser. RLS deny-all; service-role only. Every row scoped to the
 * caller. NOT flag-gated — collections are a plain Library-organization feature
 * for a signed-in user, independent of Explore.
 */

// ── GET: list collections (with counts) ──────────────────────────────────────
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const sb = getServiceClient();
    const { data: cols, error } = await sb
      .from("note_collections")
      .select("id, name, is_default, created_at, updated_at")
      .eq("user_id", userId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[notes/collections GET]", error);
      return NextResponse.json(
        { error: "Failed to load collections" },
        { status: 500 },
      );
    }

    const ids = (cols ?? []).map((c) => c.id as string);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: items, error: itemErr } = await sb
        .from("note_collection_items")
        .select("collection_id")
        .in("collection_id", ids);
      if (itemErr) {
        console.error("[notes/collections GET] counts", itemErr);
      } else {
        for (const it of items ?? []) {
          const cid = it.collection_id as string;
          counts.set(cid, (counts.get(cid) ?? 0) + 1);
        }
      }
    }

    return NextResponse.json({
      collections: (cols ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        is_default: c.is_default,
        item_count: counts.get(c.id as string) ?? 0,
        created_at: c.created_at,
        updated_at: c.updated_at,
      })),
    });
  } catch (err) {
    console.error("[notes/collections GET]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// ── POST: create a collection ────────────────────────────────────────────────
async function handlePOST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;

  try {
    const body = await req.json().catch(() => ({}));
    const name = normalizeCollectionName(body?.name);
    if (!name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    const sb = getServiceClient();

    // Runaway guard.
    const { count } = await sb
      .from("note_collections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    if ((count ?? 0) >= MAX_COLLECTIONS) {
      return NextResponse.json(
        { error: "Too many collections", limit: MAX_COLLECTIONS },
        { status: 400 },
      );
    }

    const { data, error } = await sb
      .from("note_collections")
      .insert({ user_id: userId, name, is_default: false })
      .select("id, name, is_default, created_at, updated_at")
      .single();

    if (error) {
      console.error("[notes/collections POST]", error);
      return NextResponse.json(
        { error: "Failed to create collection" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { collection: { ...data, item_count: 0 } },
      { status: 201 },
    );
  } catch (err) {
    console.error("[notes/collections POST]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
