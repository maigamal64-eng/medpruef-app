import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { validActionKey } from "@/lib/puyp-idempotency";
import { ticketRenewalEnabled } from "@/lib/pricing-v2/flag";
import {
  TICKET_PROOF_MAX_BYTES,
  TICKET_PROOF_TYPES,
  safeProofLink,
  sittingAfterTicket,
  type TicketProofKind,
} from "@/lib/pricing-v2/ticket";
import { TICKET_PROOF_BUCKET, loadLearnerTicket, proofExtension } from "@/lib/pricing-v2/ticket-server";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Guarantee Ticket renewal on proof, learner side (a-pricing-v2,
 * TICKET_RENEWAL_ENABLED, default off: 404 while off).
 *
 * GET  the caller's ticket, renewals used, the pending request and history
 *      (own rows only; never another learner's, never the proof itself).
 * POST multipart: idempotency_key (uuid), kind failed_result|booked_sitting,
 *      proof (PDF/PNG/JPEG/WEBP, at most 4 MB) OR proof_link (https),
 *      sitting_date (YYYY-MM-DD, booked_sitting only, after the ticket end),
 *      note (optional, at most 500 characters). Creates one pending request;
 *      the admin queue decides (admin_ticket_renewal_decide).
 */
async function handleGET(req: NextRequest) {
  if (!ticketRenewalEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const state = await loadLearnerTicket(getServiceClient(), guard.userId);
  return NextResponse.json({
    ticket: state.ticket ? { expires_at: state.ticket.expires_at, status: state.ticket.status } : null,
    renewals_used: state.renewalsUsed,
    max_renewals: state.maxRenewals,
    pending: state.pending,
    history: state.history.map((r) => ({ kind: r.kind, status: r.status, created_at: r.created_at, decided_at: r.decided_at, new_expires_at: r.new_expires_at, decision_reason: r.status === "denied" ? r.decision_reason : null })),
    blocker: state.blocker,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function handlePOST(req: NextRequest) {
  if (!ticketRenewalEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const userId = guard.userId;
  const gate = checkRateLimit({ key: rateKey("ticket-renewal", userId), limit: 5, windowMs: 10 * 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(gate, { limit: 5 }) });
  if (!(req.headers.get("content-type") || "").includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Could not read the upload" }, { status: 400 }); }

  const key = form.get("idempotency_key");
  if (!validActionKey(key)) return NextResponse.json({ error: "Valid idempotency_key required" }, { status: 400 });
  const kindRaw = form.get("kind");
  const kind: TicketProofKind | null = kindRaw === "failed_result" || kindRaw === "booked_sitting" ? kindRaw : null;
  if (!kind) return NextResponse.json({ error: "kind must be failed_result or booked_sitting", code: "BAD_KIND" }, { status: 400 });
  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim().slice(0, 500) || null : null;
  const file = form.get("proof");
  const link = safeProofLink(form.get("proof_link"));
  const hasFile = file instanceof File && file.size > 0;
  if (!hasFile && !link) return NextResponse.json({ error: "Upload a file or give an https link", code: "PROOF_REQUIRED" }, { status: 400 });
  if (hasFile) {
    if (file.size > TICKET_PROOF_MAX_BYTES) return NextResponse.json({ error: "File too large (max 4 MB)", code: "FILE_TOO_LARGE" }, { status: 413 });
    if (!(TICKET_PROOF_TYPES as readonly string[]).includes(file.type)) return NextResponse.json({ error: "PDF, PNG, JPEG or WebP only", code: "FILE_TYPE" }, { status: 415 });
  }

  const sb = getServiceClient();
  // A retry with the same key answers the stored request.
  const prior = await sb.from("ticket_renewal_requests").select("id, user_id, status").eq("id", key).maybeSingle();
  if (prior.error) throw prior.error;
  if (prior.data) {
    if (prior.data.user_id !== userId) return NextResponse.json({ error: "Action key already used" }, { status: 409 });
    return NextResponse.json({ ok: true, request_id: prior.data.id, status: prior.data.status, duplicate: true });
  }

  const state = await loadLearnerTicket(sb, userId);
  if (state.blocker || !state.ticket) {
    return NextResponse.json({ error: "No renewal is possible right now", code: "NOT_ELIGIBLE", blocker: state.blocker }, { status: 409 });
  }
  let sittingDate: string | null = null;
  if (kind === "booked_sitting") {
    const raw = form.get("sitting_date");
    sittingDate = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    if (!sittingDate || !state.ticket.expires_at || !sittingAfterTicket(sittingDate, state.ticket.expires_at)) {
      return NextResponse.json({ error: "The booked sitting must be after your ticket ends", code: "SITTING_NOT_AFTER_END" }, { status: 400 });
    }
  }

  let proofPath: string | null = null;
  if (hasFile) {
    const ext = proofExtension(file.type) ?? "bin";
    proofPath = `${userId}/${key}.${ext}`;
    const { error: uploadError } = await sb.storage.from(TICKET_PROOF_BUCKET)
      .upload(proofPath, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    const code = String((uploadError as { statusCode?: string; error?: string } | null)?.statusCode || (uploadError as { error?: string } | null)?.error || "");
    if (uploadError && !["409", "Duplicate"].includes(code)) {
      captureServerError(uploadError, { route: "/api/ticket-renewal", userId, step: "upload" });
      return NextResponse.json({ error: "Upload failed, please try again" }, { status: 500 });
    }
  }

  const { error: insertError } = await sb.from("ticket_renewal_requests").insert({
    id: key, user_id: userId, subscription_id: state.ticket.id, kind,
    proof_path: proofPath, proof_link: hasFile ? null : link, sitting_date: sittingDate, note,
  });
  if (insertError) {
    if (insertError.code === "23505") {
      const again = await sb.from("ticket_renewal_requests").select("id, user_id, status").eq("id", key).maybeSingle();
      if (!again.error && again.data?.user_id === userId) return NextResponse.json({ ok: true, request_id: again.data.id, status: again.data.status, duplicate: true });
      // The one-pending index: another request is already waiting.
      if (proofPath) await sb.storage.from(TICKET_PROOF_BUCKET).remove([proofPath]);
      return NextResponse.json({ error: "A request is already waiting for review", code: "PENDING" }, { status: 409 });
    }
    // The file stays: a retry with the same key re-uses it (a write may also
    // have committed after its deadline).
    captureServerError(insertError, { route: "/api/ticket-renewal", userId, step: "insert" });
    return NextResponse.json({ error: "Could not save the request" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, request_id: key, status: "pending" });
}

export const GET = withDbUnavailable(handleGET);
export const POST = withDbUnavailable(handlePOST);
