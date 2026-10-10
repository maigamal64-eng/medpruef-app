import { NextResponse } from 'next/server'
import { adminRouteShell } from '@/lib/admin/shell'

export const dynamic = 'force-dynamic'

/**
 * GET /api/stats/admin/clarity
 *
 * Proxies Microsoft Clarity's live insights API for the admin dashboard.
 * Returns UX quality metrics: dead clicks, rage clicks, scroll depth,
 * popular pages, script errors, etc.
 *
 * The Clarity token is stored server-side — never exposed to the client.
 */
export const GET = adminRouteShell(async () => {
  try {
    const token = process.env.CLARITY_API_TOKEN
    if (!token) {
      return NextResponse.json({ error: 'Clarity token not configured' }, { status: 500 })
    }

    const res = await fetch(
      'https://www.clarity.ms/export-data/api/v1/project-live-insights',
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        // Cache for 5 minutes to avoid hitting Clarity rate limits
        next: { revalidate: 300 },
      }
    )

    if (!res.ok) {
      console.error('[clarity API]', res.status, await res.text())
      return NextResponse.json({ error: 'Clarity API error' }, { status: 502 })
    }

    const raw = await res.json()

    // Transform Clarity's array format into a clean object
    const metrics: Record<string, unknown> = {}
    for (const item of raw) {
      const name = item.metricName
      const info = item.information?.[0] || item.information || {}

      if (name === 'PopularPages') {
        metrics.popularPages = item.information || []
      } else if (name === 'ScrollDepth') {
        metrics.scrollDepth = info.averageScrollDepth
      } else if (name === 'ActiveSessions' || name === 'TotalSessionCount') {
        metrics.totalSessions = info.sessionsCount || info.total
      } else {
        // Standard metric with sessions count + percentage
        metrics[name] = {
          sessions: info.sessionsCount,
          percentage: info.sessionsWithMetricPercentage,
          pageViews: info.pagesViews,
          count: info.subTotal,
        }
      }
    }

    // Also pass total sessions from any metric that has it
    if (!metrics.totalSessions) {
      const firstWithSessions = raw.find((m: { information: Array<{ sessionsCount?: string }> }) =>
        m.information?.[0]?.sessionsCount
      )
      if (firstWithSessions) {
        metrics.totalSessions = firstWithSessions.information[0].sessionsCount
      }
    }

    return NextResponse.json(metrics)
  } catch (err) {
    console.error('[clarity proxy]', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}, { route: "/api/stats/admin/clarity", rateLimit: { limit: 120, windowMs: 60_000 } });
