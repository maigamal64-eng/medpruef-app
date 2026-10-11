import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { PRESENCE_CHANNELS } from "@/lib/admin/growthChannels";
import {
  CHANNEL_LABEL,
  CHANNEL_STRATEGY,
  PUBLISHED,
  PUBLISHED_LAST_UPDATED,
} from "@/lib/admin/publishedContent";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats/admin/growth/content — the static channel strategy, published
 * log and presence list behind /admin/growth (ADM-04/ADM-08, 2026-10-11).
 *
 * These consts name outreach targets and internal accounts, so they stay
 * server-side: the client page must never import publishedContent or
 * growthChannels (they would ship in a public JS chunk). Kept separate from the
 * funnel route so a DB failure there cannot hide this read.
 */
export const GET = adminRouteShell(
  async () =>
    NextResponse.json({
      strategy: CHANNEL_STRATEGY,
      published: PUBLISHED,
      publishedLastUpdated: PUBLISHED_LAST_UPDATED,
      channelLabels: CHANNEL_LABEL,
      presence: PRESENCE_CHANNELS,
    }),
  {
    route: "/api/stats/admin/growth/content",
    rateLimit: { limit: 120, windowMs: 60_000 },
  }
);
