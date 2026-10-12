import { csvCell } from "@/lib/csv-cell";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/non-crypto-waitlist
 *
 * Admin-gated read of the non_crypto_waitlist table. Surfaces the
 * users who tapped "Ich habe keine Krypto" on the pre-checkout trust
 * dialog so [name] can email them as soon as Stripe Atlas clears.
 *
 * Returns:
 *   { items: [...], count: number, by_provider: { binance: N, ... } }
 *
 * Optional query params:
 *   ?contacted=false       — only un-contacted (default)
 *   ?contacted=all         — every row
 *   ?limit=N               — cap (default 200, max 1000)
 *   ?format=csv            — text/csv response (audit-logged via the
 *                            adminRouteShell middleware)
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    try {
      const url = new URL(req.url);
      const contactedFilter = url.searchParams.get("contacted") || "false";
      const limitRaw = parseInt(url.searchParams.get("limit") || "200", 10);
      const limit = Math.min(Math.max(limitRaw || 200, 1), 1000);
      const format = url.searchParams.get("format") || "json";

      const sb = getServiceClient();
      let q = sb
        .from("non_crypto_waitlist")
        .select("id, email, user_id, tier_interest, current_provider, notes, created_at, contacted_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (contactedFilter === "false") {
        q = q.is("contacted_at", null);
      }
      const { data, error } = await q;
      if (error) {
        captureServerError(error, {
          route: "/api/admin/non-crypto-waitlist",
          phase: "select",
        });
        return adminErrorResponse(error, "/api/admin/non-crypto-waitlist");
      }

      const items = data ?? [];
      const byProvider: Record<string, number> = {};
      for (const row of items) {
        const k = (row.current_provider as string) || "unspecified";
        byProvider[k] = (byProvider[k] || 0) + 1;
      }

      if (format === "csv") {
        const headers = [
          "id",
          "email",
          "user_id",
          "tier_interest",
          "current_provider",
          "notes",
          "created_at",
          "contacted_at",
        ];
        const lines = [
          headers.join(","),
          ...items.map((row) =>
            headers.map((h) => csvCell((row as Record<string, unknown>)[h])).join(",")
          ),
        ];
        return new NextResponse(lines.join("\n"), {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="non-crypto-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        });
      }

      return NextResponse.json({
        count: items.length,
        by_provider: byProvider,
        items,
      });
    } catch (err) {
      captureServerError(err, {
        route: "/api/admin/non-crypto-waitlist",
      });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  },
  { route: "/api/admin/non-crypto-waitlist" }
);
