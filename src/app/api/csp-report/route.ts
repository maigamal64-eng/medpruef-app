/**
 * /api/csp-report
 *
 * Receives CSP violation reports from browsers.
 * Accepts both:
 *   - application/csp-report  (legacy Content-Security-Policy report-uri directive)
 *   - application/reports+json (modern Reporting API, report-to directive)
 *
 * Stores one row per violation in the `csp_violations` table via service-role.
 * IPs are one-way hashed (sha256 + server-side salt) — raw IPs never persisted.
 * Always returns 204 — browsers ignore the response body.
 *
 * Rate limit: ~100 reports/min per ip-hash, best-effort via in-memory token bucket.
 * (Vercel functions are stateless; warm instances share the bucket within a region.)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// Supabase service-role client (bypasses RLS)
// ---------------------------------------------------------------------------
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---------------------------------------------------------------------------
// In-memory rate limiter — token bucket per ip-hash
// (best-effort; resets when the Vercel function cold-starts)
// ---------------------------------------------------------------------------
const RATE_LIMIT_RPM = 100;
const buckets = new Map<string, { tokens: number; lastRefill: number }>();

function isRateLimited(ipHash: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(ipHash) ?? { tokens: RATE_LIMIT_RPM, lastRefill: now };

  // Refill: 1 token per (60000 / RATE_LIMIT_RPM) ms
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor(elapsed / (60_000 / RATE_LIMIT_RPM));
  if (refill > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_RPM, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  if (bucket.tokens <= 0) {
    buckets.set(ipHash, bucket);
    return true;
  }

  bucket.tokens -= 1;
  buckets.set(ipHash, bucket);
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const SALT = process.env.CSP_REPORT_IP_SALT ?? "dev-local-salt";

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + SALT).digest("hex").slice(0, 32);
}

function truncate(s: string | undefined, len: number): string | null {
  if (!s) return null;
  return s.length <= len ? s : s.slice(0, len);
}

interface ViolationRow {
  blocked_uri: string | null;
  document_uri: string | null;
  effective_directive: string | null;
  original_policy: string | null;
  referrer: string | null;
  status_code: number | null;
  violated_directive: string | null;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
  script_sample: string | null;
  user_agent: string | null;
  ip_hash: string;
}

function parseBody(ct: string, raw: unknown): ViolationRow[] {
  // Modern Reporting API: array of report objects
  if (ct.includes("application/reports+json") && Array.isArray(raw)) {
    return raw.flatMap((report: Record<string, unknown>) => {
      const body = (report.body ?? {}) as Record<string, unknown>;
      return [{
        blocked_uri:         String(body["blockedURL"] ?? body["blocked-uri"] ?? ""),
        document_uri:        String(body["documentURL"] ?? body["document-uri"] ?? report["url"] ?? ""),
        effective_directive: String(body["effectiveDirective"] ?? body["effective-directive"] ?? ""),
        original_policy:     String(body["originalPolicy"] ?? body["original-policy"] ?? ""),
        referrer:            String(body["referrer"] ?? ""),
        status_code:         Number(body["statusCode"] ?? body["status-code"] ?? 0) || null,
        violated_directive:  String(body["violatedDirective"] ?? body["violated-directive"] ?? ""),
        source_file:         String(body["sourceFile"] ?? body["source-file"] ?? ""),
        line_number:         Number(body["lineNumber"] ?? body["line-number"] ?? 0) || null,
        column_number:       Number(body["columnNumber"] ?? body["column-number"] ?? 0) || null,
        script_sample:       truncate(String(body["sample"] ?? body["script-sample"] ?? ""), 200),
        user_agent:          null, // set by caller
        ip_hash:             "",   // set by caller
      }];
    });
  }

  // Legacy csp-report envelope: { "csp-report": { ... } }
  const legacyEnvelope = raw as Record<string, unknown>;
  const r = (legacyEnvelope?.["csp-report"] ?? {}) as Record<string, unknown>;
  return [{
    blocked_uri:         String(r["blocked-uri"] ?? ""),
    document_uri:        String(r["document-uri"] ?? ""),
    effective_directive: String(r["effective-directive"] ?? ""),
    original_policy:     String(r["original-policy"] ?? ""),
    referrer:            String(r["referrer"] ?? ""),
    status_code:         Number(r["status-code"] ?? 0) || null,
    violated_directive:  String(r["violated-directive"] ?? ""),
    source_file:         String(r["source-file"] ?? ""),
    line_number:         Number(r["line-number"] ?? 0) || null,
    column_number:       Number(r["column-number"] ?? 0) || null,
    script_sample:       truncate(String(r["script-sample"] ?? ""), 200),
    user_agent:          null,
    ip_hash:             "",
  }];
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = hashIp(ip);

    if (isRateLimited(ipHash)) {
      // Drop silently — return 204 so browser doesn't retry
      return new NextResponse(null, { status: 204 });
    }

    const ct = req.headers.get("content-type") ?? "";
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return new NextResponse(null, { status: 204 });
    }

    const ua = req.headers.get("user-agent");
    const rows = parseBody(ct, raw).map((row) => ({
      ...row,
      user_agent: ua,
      ip_hash: ipHash,
    }));

    if (rows.length === 0) {
      return new NextResponse(null, { status: 204 });
    }

    // Fire-and-forget insert — don't block the 204 response
    supabase.from("csp_violations").insert(rows).then(({ error }) => {
      if (error) {
        console.error("[csp-report] insert error:", error.message);
      }
    });
  } catch (err) {
    // Never surface errors to the browser
    console.error("[csp-report] unexpected error:", err);
  }

  return new NextResponse(null, { status: 204 });
}
