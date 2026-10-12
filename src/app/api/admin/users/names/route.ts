import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { learnerDisplayName } from "@/lib/admin/learner-names";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/admin/users/names?ids=<uuid>,<uuid> (users.read). UX-ADM-21.
 *
 * Resolves learner ids to a display name on the server so every admin list
 * can link to /admin/users/[id] with a readable label. Lists never show a
 * full email by default: the label is the name, then @telegram, then a
 * masked email. At most 100 ids per call.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = adminRouteShell(
  async ({ req }) => {
    const raw = new URL(req.url).searchParams.get("ids") ?? "";
    const ids = [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > 100 || ids.some((id) => !UUID_RE.test(id))) {
      return NextResponse.json({ error: "Pass 1 to 100 learner ids" }, { status: 400 });
    }
    const { data, error } = await getServiceClient()
      .from("users")
      .select("id, first_name, last_name, telegram_username, email, role")
      .in("id", ids);
    if (error) return adminErrorResponse(error, "/api/admin/users/names");
    const names: Record<string, { label: string; admin: boolean }> = {};
    for (const u of data ?? []) {
      names[u.id as string] = { label: learnerDisplayName(u), admin: u.role === "admin" };
    }
    return NextResponse.json({ names });
  },
  { route: "/api/admin/users/names", rateLimit: { limit: 120, windowMs: 60_000 } }
);
