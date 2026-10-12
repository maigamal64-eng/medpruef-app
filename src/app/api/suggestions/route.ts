import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { assertReadSucceeded } from "@/lib/admin/read-result";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin, resolveOptionalUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";
import { adminErrorResponse } from "@/lib/admin/error-response";
import { callerIdentity, checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import {
  asksForKeyChange,
  matches,
  parseSubmission,
  planEdit,
  proposedEdit,
  type EditValues,
  type StoredValues,
} from "@/lib/admin/suggestion-edit";
import {
  OUTCOMES_FOR_ACTION,
  parseReporterOutcome,
  reportContextFacts,
  safeParsePath,
  sanitizeReportContext,
} from "@/lib/reports/report-status";
import { notifyReporter, reportEmailEnabled } from "@/lib/reports/notify-reporter";

export const dynamic = "force-dynamic";

// POST — User submits a flag or edit suggestion.
//
// User identity (question_suggestions.user_id): derived ONLY from the
// verified session token (S-1, via resolveOptionalUser), then confirmed
// to exist in `users`. Never the header or a body-supplied userId, both
// client-controlled. Anonymous submissions are still allowed and a
// guest_* tracking id from the body is preserved in context.guest_id.
export async function POST(req: NextRequest) {
  try {
    // ADM-05: the public report endpoint is throttled and size-capped.
    const gate = checkRateLimit({ key: rateKey("/api/suggestions", callerIdentity(req)), limit: 10, windowMs: 10 * 60_000 });
    if (!gate.allowed) {
      return NextResponse.json({ error: "Too many reports. Please try again later." }, { status: 429, headers: rateLimitHeaders(gate, { limit: 10 }) });
    }
    const db = getServiceClient();
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const parsed = parseSubmission(body);
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    // UX-ADM-01: an invalid learner-supplied page URL is dropped, never stored.
    const context = sanitizeReportContext(body?.context && typeof body.context === "object" && !Array.isArray(body.context) ? body.context as Record<string, unknown> : {});
    if (JSON.stringify(context).length > 4000) {
      return NextResponse.json({ error: "context is too large" }, { status: 400 });
    }

    // Authenticated identity (written to question_suggestions.user_id)
    // comes ONLY from the verified session token (S-1) — never the
    // header or a body-supplied userId, both client-controlled. A
    // guest_* tracking id supplied in the body is still preserved in
    // context.guest_id (non-privileged) for triage.
    const bodyId = typeof body?.userId === "string" ? body.userId.slice(0, 80) : null;
    let validUserId: string | null = null;
    let rawId: string | null = null;
    const candidate = resolveOptionalUser(req);
    if (candidate) {
      const { data: userRow } = await db
        .from("users")
        .select("id")
        .eq("id", candidate)
        .maybeSingle();
      if (userRow) validUserId = candidate;
    }
    if (!validUserId && bodyId) rawId = bodyId; // preserve guest_* IDs for triage

    // Enrich context with server-side data
    const enrichedContext = {
      ...context,
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      server_user_agent: req.headers.get("user-agent") || null,
      guest_id: rawId || null, // preserve raw guest_* ID for triage
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await db
      .from("question_suggestions")
      .insert({
        question_id: parsed.questionId,
        user_id: validUserId,
        type: parsed.type,
        reason: parsed.reason,
        details: parsed.details,
        suggested_changes: parsed.suggestedChanges,
        context: enrichedContext,
        status: "pending",
      })
      .select("id")
      .single();

    if (error?.code === "23503") {
      return NextResponse.json({ error: "Unknown question" }, { status: 400 });
    }
    if (error) {
      captureServerError(error, { route: "/api/suggestions", method: "POST", phase: "insert" });
      return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    captureServerError(err, { route: "/api/suggestions", method: "POST" });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — Admin fetches suggestions (with question + user info joined)
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const permissions = await loadAdminPermissionSnapshot(guard.userId);
    if (!canAccessAdminPermission(permissions, "content.read")) {
      return NextResponse.json({ error: "Your admin role cannot read question reports." }, { status: 403 });
    }
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50") || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0") || 0, 0);
    const reportId = Number(url.searchParams.get("id"));

    let query = db
      .from("question_suggestions")
      .select("id, question_id, user_id, type, reason, details, suggested_changes, context, status, admin_note, created_at, resolved_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    // UX-ADM-02: a deep link (?id=) always resolves, whatever page it is on.
    if (url.searchParams.has("id")) {
      if (!Number.isSafeInteger(reportId) || reportId < 1) return NextResponse.json({ error: "Invalid report id" }, { status: 400 });
      query = query.eq("id", reportId);
    }
    if (status && status !== "all") query = query.eq("status", status);
    if (type === "flag" || type === "edit") query = query.eq("type", type);

    const { data: suggestions, count, error } = await query;
    if (error) {
      captureServerError(error, {
        route: "/api/suggestions",
        method: "GET",
        userId: guard.userId,
        phase: "select",
      });
      return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
    }

    const canReadUsers = canAccessAdminPermission(permissions, "users.read");

    // Enrich with question text and user name
    const questionIds = [...new Set((suggestions || []).map((s: { question_id: number }) => s.question_id))];
    const userIds = [...new Set((suggestions || []).filter((s: { user_id: string | null }) => s.user_id).map((s: { user_id: string }) => s.user_id))];

    const [questionsRes, usersRes] = await Promise.all([
      questionIds.length > 0
        ? db.from("questions").select("id, question, topic, choices, answer, explanation, is_active").in("id", questionIds)
        : Promise.resolve({ data: [], error: null }),
      // ADM-Q16: learner identities (and email presence) only with users.read.
      canReadUsers && userIds.length > 0
        ? db.from("users").select("id, first_name, last_name, telegram_username, email").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    assertReadSucceeded(questionsRes);
    assertReadSucceeded(usersRes);
    type QuestionInfo = { question: string; topic: string; choices: unknown; answer: string | null; explanation: string | null; is_active: boolean | null };
    const questionMap: Record<number, QuestionInfo> = {};
    for (const q of (questionsRes.data || []) as ({ id: number } & QuestionInfo)[]) {
      questionMap[q.id] = { question: q.question, topic: q.topic, choices: q.choices, answer: q.answer, explanation: q.explanation, is_active: q.is_active };
    }

    const userMap: Record<string, string> = {};
    const contactable = new Set<string>();
    for (const u of (usersRes.data || []) as { id: string; first_name: string | null; last_name: string | null; telegram_username: string | null; email: string | null }[]) {
      userMap[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.telegram_username || u.email || "Anonymous";
      if (typeof u.email === "string" && u.email.includes("@")) contactable.add(u.id);
    }

    const enriched = (suggestions || []).map((s: Record<string, unknown>) => {
      const { user_id, suggested_changes, context, ...safeSuggestion } = s;
      const live = questionMap[s.question_id as number];
      const proposal = proposedEdit(suggested_changes);
      const applied = (context as { applied_edit?: unknown } | null)?.applied_edit ?? null;
      const facts = reportContextFacts(context);
      const ctx = (context && typeof context === "object" ? context : {}) as Record<string, unknown>;
      const notifyError = ctx.notify_error && typeof ctx.notify_error === "object" ? (ctx.notify_error as { reason?: unknown }).reason : null;
      return {
        ...safeSuggestion,
        // ADM-13: the full question, choices with the key and explanation
        // so a report can be judged without leaving the queue.
        question_full: live?.question ?? "",
        question_answer: live?.answer ?? null,
        question_explanation: live?.explanation ?? null,
        question_active: live?.is_active ?? null,
        question_missing: !live,
        // UX-ADM-01: the stored page URL as a render-safe label only.
        report_page: safeParsePath(ctx.url),
        reporter_outcome: facts.outcome,
        notified_at: facts.notifiedAt,
        notify_error: typeof notifyError === "string" ? notifyError : null,
        // true/false with users.read; null when this admin may not see learner data.
        has_account: typeof user_id === "string",
        reporter_contactable: typeof user_id !== "string" ? false : canReadUsers ? contactable.has(user_id) : null,
        // ADM-05: edit rows carry the full before/after so the admin sees
        // exactly what "Apply edit" would write.
        ...(s.type === "edit" ? {
          proposed: proposal,
          current: live ? planEdit(live as unknown as Record<string, unknown>, proposal).before : {},
          asks_key_change: asksForKeyChange(suggested_changes),
          applied_edit: applied,
        } : {}),
        question_text: questionMap[s.question_id as number]?.question?.slice(0, 200) || "",
        question_topic: questionMap[s.question_id as number]?.topic || "",
        question_choices: questionMap[s.question_id as number]?.choices || null,
        user_name: user_id ? (canReadUsers ? (userMap[user_id as string] || "Learner") : "Learner") : "Anonymous",
        reporter_id: canReadUsers && typeof user_id === "string" ? user_id : null,
      };
    });

    // Counts by status
    const [pendingRes, approvedRes, rejectedRes, revertedRes] = await Promise.all([
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "approved"),
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "rejected"),
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "reverted"),
    ]);

    for (const result of [pendingRes, approvedRes, rejectedRes, revertedRes]) assertReadSucceeded(result);
    return NextResponse.json({
      suggestions: enriched,
      email_enabled: reportEmailEnabled(),
      total: count || 0,
      counts: {
        pending: pendingRes.count || 0,
        approved: approvedRes.count || 0,
        rejected: rejectedRes.count || 0,
        reverted: revertedRes.count || 0,
        total: (count || 0),
      },
    });
  } catch (err) {
    captureServerError(err, { route: "/api/suggestions", method: "GET", userId: guard.userId });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Admin resolves a suggestion (ADM-05, a15).
//   approve            close a flag, or close an edit without changing the question
//   approve+applyEdit  write the shown before/after diff (question/explanation/topic only)
//   reject             dismiss
//   revert             restore the values an applied edit replaced
//   reopen             undo a Confirm/Dismiss within 10 minutes (no applied edit)
//   notify             email the reporter of an already resolved report (flag on)
// Every action needs the row still in the expected status (no double resolve).
// `outcome` is the reporter-facing result (fixed, accepted, not_an_error,
// needs_info) stored in context.reporter_outcome and shown in My reports.
// With SUGGESTION_RESOLVED_EMAIL_ENABLED unset the response shape is unchanged.
const REOPEN_WINDOW_MS = 10 * 60_000;

export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  const route = "/api/suggestions";
  try {
    const db = getServiceClient();
    if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(guard.userId), "content.moderate")) {
      return NextResponse.json({ error: "Your admin role cannot resolve question reports." }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const { suggestionId, action } = body as { suggestionId?: unknown; action?: unknown };
    const adminNote = typeof body?.adminNote === "string" ? body.adminNote.slice(0, 1000) : null;
    const applyEdit = body?.applyEdit === true;
    const adminUserId = guard.userId;

    if (!suggestionId || typeof action !== "string") {
      return NextResponse.json({ error: "suggestionId and action required" }, { status: 400 });
    }
    if (!["approve", "reject", "revert", "reopen", "notify"].includes(action)) {
      return NextResponse.json({ error: "action must be approve, reject, revert, reopen or notify" }, { status: 400 });
    }

    const { data: suggestion, error: fetchErr } = await db
      .from("question_suggestions")
      .select("id, question_id, user_id, type, status, suggested_changes, context, admin_note, created_at, resolved_at")
      .eq("id", suggestionId)
      .maybeSingle();
    if (fetchErr) return adminErrorResponse(fetchErr, route);
    if (!suggestion) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });

    const context = (suggestion.context && typeof suggestion.context === "object" ? suggestion.context : {}) as Record<string, unknown>;
    const nowIso = new Date().toISOString();
    const actorEmail = await resolveActorEmail(adminUserId);

    if (action === "notify") {
      if (!reportEmailEnabled()) return NextResponse.json({ error: "Reporter emails are switched off." }, { status: 409 });
      if (suggestion.status !== "approved" && suggestion.status !== "rejected") {
        return NextResponse.json({ error: "Only a confirmed or dismissed report can be emailed." }, { status: 409 });
      }
      const facts = reportContextFacts(context);
      const result = await notifyReporter(db, { ...suggestion, context }, { outcome: facts.outcome, adminNote: suggestion.admin_note ?? null });
      if (!result.notified) {
        const message = {
          anonymous: "This report was sent without an account, so there is no one to email.",
          no_email: "The reporter's account has no email address.",
          already_notified: "The reporter was already emailed about this report.",
          no_outcome: "Record an outcome for the reporter first.",
          send_failed: "The email could not be sent. Try again later.",
          lookup_failed: "The reporter could not be looked up. Try again.",
          disabled: "Reporter emails are switched off.",
          not_resolved: "Only a confirmed or dismissed report can be emailed.",
        }[result.reason];
        return NextResponse.json({ error: message, reason: result.reason }, { status: result.reason === "send_failed" || result.reason === "lookup_failed" ? 502 : 409 });
      }
      await logAdminAction({
        req, actorId: adminUserId, actorEmail, action: "notify_question_reporter",
        targetType: "question_suggestion", targetId: String(suggestion.id),
        payload: { question_id: suggestion.question_id, outcome: facts.outcome },
      });
      return NextResponse.json({ ok: true, notified: true });
    }

    if (action === "reopen") {
      const facts = reportContextFacts(context);
      if (suggestion.status !== "approved" && suggestion.status !== "rejected") {
        return NextResponse.json({ error: "Only a confirmed or dismissed report can be reopened." }, { status: 409 });
      }
      if (facts.applied) {
        return NextResponse.json({ error: "This report applied an edit. Use Revert edit instead." }, { status: 409 });
      }
      const resolvedAt = suggestion.resolved_at ? Date.parse(suggestion.resolved_at) : NaN;
      if (!Number.isFinite(resolvedAt) || Date.now() - resolvedAt > REOPEN_WINDOW_MS) {
        return NextResponse.json({ error: "Undo is only possible for 10 minutes after a decision." }, { status: 409 });
      }
      const { reporter_outcome: _dropped, ...reopenedContext } = context;
      void _dropped;
      const { data: reopened, error: reopenErr } = await db
        .from("question_suggestions")
        .update({ status: "pending", admin_note: null, resolved_by: null, resolved_at: null, context: reopenedContext })
        .eq("id", suggestion.id)
        .eq("status", suggestion.status)
        .select("id")
        .maybeSingle();
      if (reopenErr) return adminErrorResponse(reopenErr, route);
      if (!reopened) return NextResponse.json({ error: "This report changed in the meantime. Reload the queue." }, { status: 409 });
      await logAdminAction({
        req, actorId: adminUserId, actorEmail, action: "reopen_question_report",
        targetType: "question_suggestion", targetId: String(suggestion.id),
        payload: { question_id: suggestion.question_id, previous_status: suggestion.status, previous_note: suggestion.admin_note ?? null, previous_outcome: facts.outcome, reporter_already_notified: !!facts.notifiedAt },
      });
      return NextResponse.json({ ok: true, status: "pending" });
    }

    if (action === "revert") {
      const applied = context.applied_edit as { before?: StoredValues; after?: EditValues } | undefined;
      if (suggestion.status !== "approved" || !applied?.before || !applied.after) {
        return NextResponse.json({ error: "Only an applied edit can be reverted" }, { status: 409 });
      }
      const { data: live, error: liveErr } = await db
        .from("questions").select("id, question, explanation, topic").eq("id", suggestion.question_id).maybeSingle();
      if (liveErr) return adminErrorResponse(liveErr, route);
      if (!live) return NextResponse.json({ error: "Question not found" }, { status: 404 });
      if (!matches(live, applied.after)) {
        return NextResponse.json({ error: "The question changed after this edit. Revert it by hand in Browse." }, { status: 409 });
      }
      const { data: claimed, error: claimErr } = await db
        .from("question_suggestions")
        .update({ status: "reverted", context: { ...context, reverted_edit: { at: nowIso, by: adminUserId } }, resolved_by: adminUserId, resolved_at: nowIso })
        .eq("id", suggestion.id).eq("status", "approved").select("id").maybeSingle();
      if (claimErr) return adminErrorResponse(claimErr, route);
      if (!claimed) return NextResponse.json({ error: "This report changed in the meantime. Reload the queue." }, { status: 409 });
      const { error: restoreErr } = await db.from("questions").update(applied.before).eq("id", suggestion.question_id);
      if (restoreErr) {
        await db.from("question_suggestions").update({ status: "approved", context }).eq("id", suggestion.id).eq("status", "reverted");
        return adminErrorResponse(restoreErr, route);
      }
      await logAdminAction({
        req, actorId: adminUserId, actorEmail, action: "revert_question_edit",
        targetType: "question_suggestion", targetId: String(suggestion.id),
        payload: { question_id: suggestion.question_id, restored: applied.before, replaced: applied.after },
      });
      return NextResponse.json({ ok: true, status: "reverted" });
    }

    if (suggestion.status !== "pending") {
      return NextResponse.json({ error: `This report is already ${suggestion.status}.` }, { status: 409 });
    }

    const resolveAction = action as "approve" | "reject";
    let outcome = parseReporterOutcome(body?.outcome, resolveAction);
    if (body?.outcome !== undefined && body?.outcome !== null && !outcome) {
      return NextResponse.json({ error: `outcome must be one of ${OUTCOMES_FOR_ACTION[resolveAction].join(", ")}` }, { status: 400 });
    }

    let plan: { before: StoredValues; after: EditValues } | null = null;
    if (action === "approve" && applyEdit) {
      if (suggestion.type !== "edit") return NextResponse.json({ error: "Only edit suggestions can be applied" }, { status: 400 });
      const { data: live, error: liveErr } = await db
        .from("questions").select("id, question, explanation, topic").eq("id", suggestion.question_id).maybeSingle();
      if (liveErr) return adminErrorResponse(liveErr, route);
      if (!live) return NextResponse.json({ error: "Question not found" }, { status: 404 });
      plan = planEdit(live, proposedEdit(suggestion.suggested_changes));
      if (Object.keys(plan.after).length === 0) {
        return NextResponse.json({ error: "Nothing to apply: the question already matches this suggestion." }, { status: 409 });
      }
      // The admin approved the diff they saw; refuse if the live text moved.
      const seen = body?.expectedBefore as StoredValues | undefined;
      if (seen && typeof seen === "object" && !matches(live, seen)) {
        return NextResponse.json({ error: "The question changed since you opened this report. Reload and review again." }, { status: 409 });
      }
      outcome = "fixed";
    }

    const status = action === "approve" ? "approved" : "rejected";
    let nextContext: Record<string, unknown> = plan ? { ...context, applied_edit: { before: plan.before, after: plan.after, at: nowIso, by: adminUserId } } : context;
    if (outcome) nextContext = { ...nextContext, reporter_outcome: outcome };
    const { data: claimed, error: updateErr } = await db
      .from("question_suggestions")
      .update({ status, admin_note: adminNote, resolved_by: adminUserId, resolved_at: nowIso, context: nextContext })
      .eq("id", suggestion.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (updateErr) return adminErrorResponse(updateErr, route);
    if (!claimed) return NextResponse.json({ error: "This report was resolved in the meantime. Reload the queue." }, { status: 409 });

    if (plan) {
      const { error: applyErr } = await db.from("questions").update(plan.after).eq("id", suggestion.question_id);
      if (applyErr) {
        // Undo the claim so the report stays reviewable.
        await db.from("question_suggestions")
          .update({ status: "pending", admin_note: null, resolved_by: null, resolved_at: null, context })
          .eq("id", suggestion.id).eq("status", "approved");
        return adminErrorResponse(applyErr, route);
      }
    }

    await logAdminAction({
      req,
      actorId: adminUserId,
      actorEmail,
      action:
        action === "approve"
          ? suggestion.type === "edit"
            ? plan ? "apply_question_edit" : "approve_question_edit"
            : "approve_question_flag"
          : "reject_question_flag",
      targetType: "question_suggestion",
      targetId: String(suggestion.id),
      payload: {
        suggestion_type: suggestion.type,
        question_id: suggestion.question_id,
        admin_note: adminNote,
        reporter_outcome: outcome,
        ...(plan ? { before: plan.before, after: plan.after } : { applied: false }),
      },
    });

    // TR-10: email the reporter (flag default OFF). Awaited in its own
    // try/catch so a serverless freeze cannot drop it and a mail failure
    // never changes the resolution above.
    if (!reportEmailEnabled()) return NextResponse.json({ ok: true, status, applied: !!plan });
    let notified = false;
    if (body?.notifyReporter !== false) {
      try {
        const result = await notifyReporter(db, { ...suggestion, status, context: nextContext }, { outcome, adminNote });
        notified = result.notified;
        if (result.notified) {
          await logAdminAction({
            req, actorId: adminUserId, actorEmail, action: "notify_question_reporter",
            targetType: "question_suggestion", targetId: String(suggestion.id),
            payload: { question_id: suggestion.question_id, outcome },
          });
        }
      } catch (mailErr) {
        captureServerError(mailErr, { route, method: "PATCH", phase: "notify_reporter" });
      }
    }
    return NextResponse.json({ ok: true, status, applied: !!plan, notified });
  } catch (err) {
    return adminErrorResponse(err, route);
  }
}
