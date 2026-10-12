import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { loadAdminPermissionSnapshot } from "@/lib/admin/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adminRouteShell(async ({ actor }) => {
  const snapshot = await loadAdminPermissionSnapshot(actor.userId);
  if (!snapshot) return NextResponse.json({ error: "Admin membership is not configured" }, { status: 403 });
  return NextResponse.json({
    actor: { userId: actor.userId, email: actor.email },
    roles: snapshot.roles,
    permissions: snapshot.permissions,
  });
}, { route: "/api/admin/access/me" });
