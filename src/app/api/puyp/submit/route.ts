import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { isPuypEligibleTier } from "@/lib/nowpayments";
import {
  computeQbankCompletion,
  meetsPuypCompletionGate,
  PUYP_COMPLETION_THRESHOLD_PCT,
  PUYP_MAX_EXTENSIONS,
  type PuypExamType,
} from "@/lib/puyp";

export const dynamic = "force-dynamic";

/**
 * POST /api/puyp/submit — upload proof of a failed exam attempt.
 *
 * The whole "Pass-Until-You-Pass" mechanic gates on four checks:
 *
 *   1. User has an active subscription on a PUYP-eligible tier
 *      (`premium_pass_guaranteed` or `twelve_month`).
 *   2. `subscriptions.puyp_extensions_used < 2` (max 2 per sub).
 *   3. User's Qbank completion for the exam type is ≥70%.
 *   4. A proof file is attached (≤10MB, image/* or PDF).
 *
 * On success the handler:
 *   - uploads the file to `exam-proofs/<user_id>/<uuid>.<ext>` via
 *     the service-role supabase client (bypasses RLS),
 *   - inserts an `exam_attempts` row with `result='fail'`,
 *     `verified_at=null` (the pending-queue signal),
 *     `qbank_completion_pct=<snapshot>`,
 *     `proof_url=<storage path>`,
 *     `subscription_id=<active sub id>`.
 *
 * The admin dashboard then surfaces the row and resolves it via
 * /api/puyp/admin/approve|reject.
 *
 * Request: multipart/form-data
 *   proof: File (required, ≤10MB, image/png|jpeg|webp|application/pdf)
 *   exam_type: string (optional, defaults to users.active_exam)
 *   attempt_date: YYYY-MM-DD (optional, defaults to users.exam_date)
 *
 * Response 200 on success:
 *   { ok: true, attempt_id, qbank_completion_pct, message }
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  try {
    // 1. Parse the multipart body.
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Expected multipart/form-data" },
        { status: 400 }
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      captureServerError(err, {
        route: "/api/puyp/submit",
        userId,
        step: "parse_formdata",
      });
      return NextResponse.json(
        { error: "Could not parse upload body" },
        { status: 400 }
      );
    }

    const file = form.get("proof");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing `proof` file field" },
        { status: 400 }
      );
    }

    // File-size guard (the storage bucket also enforces 10MB, but
    // rejecting early saves the upload round-trip).
    const MAX_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 10MB)" },
        { status: 413 }
      );
    }

    // MIME-type allow-list (mirrored in the bucket config).
    const ALLOWED = new Set([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ]);
    if (!ALLOWED.has(file.type)) {
      return NextResponse.json(
        {
          error:
            "File type not accepted. Upload a PNG, JPEG, WebP image, or a PDF.",
        },
        { status: 415 }
      );
    }

    const examTypeRaw = form.get("exam_type");
    const attemptDateRaw = form.get("attempt_date");

    const sb = getServiceClient();

    // 2. Pull user defaults for exam_type / attempt_date.
    const { data: user, error: userErr } = await sb
      .from("users")
      .select("active_exam, exam_date")
      .eq("id", userId)
      .maybeSingle();

    if (userErr || !user) {
      captureServerError(userErr, {
        route: "/api/puyp/submit",
        userId,
        step: "user_lookup",
      });
      return NextResponse.json(
        { error: "User lookup failed" },
        { status: 500 }
      );
    }

    const examType =
      (typeof examTypeRaw === "string" && examTypeRaw
        ? examTypeRaw.toLowerCase()
        : (user.active_exam as string | null)) || null;

    if (
      !examType ||
      !["kenntnispruefung", "kmp_innsbruck", "pharma"].includes(examType)
    ) {
      return NextResponse.json(
        { error: "Unknown exam_type. Set your active exam in settings first." },
        { status: 400 }
      );
    }

    const attemptDate =
      typeof attemptDateRaw === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(attemptDateRaw)
        ? attemptDateRaw
        : (user.exam_date as string | null);

    if (!attemptDate) {
      return NextResponse.json(
        { error: "attempt_date required. Set your exam date or pass attempt_date in the form." },
        { status: 400 }
      );
    }

    // 3. Find the user's most-recent active subscription. PUYP is
    //    scoped per subscription — if they've renewed, the counter
    //    starts fresh on the new sub.
    const { data: activeSub, error: subErr } = await sb
      .from("subscriptions")
      .select("id, tier, status, puyp_extensions_used")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subErr) {
      captureServerError(subErr, {
        route: "/api/puyp/submit",
        userId,
        step: "subscription_lookup",
      });
      return NextResponse.json(
        { error: "Subscription lookup failed" },
        { status: 500 }
      );
    }

    if (!activeSub) {
      return NextResponse.json(
        {
          error:
            "You need an active subscription on the Kenntnisprüfung Cohort or 12-month plan to submit a Pass-Until-You-Pass claim.",
        },
        { status: 403 }
      );
    }

    if (!isPuypEligibleTier(activeSub.tier as string | null)) {
      return NextResponse.json(
        {
          error:
            "Your current tier is not eligible for Pass-Until-You-Pass. The guarantee applies to the Kenntnisprüfung Cohort and 12-month tiers only.",
        },
        { status: 403 }
      );
    }

    const used = Number(activeSub.puyp_extensions_used) || 0;
    if (used >= PUYP_MAX_EXTENSIONS) {
      return NextResponse.json(
        {
          error: `You've already used ${PUYP_MAX_EXTENSIONS} Pass-Until-You-Pass extensions on this subscription — the maximum.`,
        },
        { status: 409 }
      );
    }

    // 4. Qbank completion gate (≥70%).
    const completion = await computeQbankCompletion(
      userId,
      examType as PuypExamType
    );

    if (!meetsPuypCompletionGate(completion)) {
      return NextResponse.json(
        {
          error: `You need to answer at least ${PUYP_COMPLETION_THRESHOLD_PCT}% of the ${examType} question bank before submitting a Pass-Until-You-Pass claim.`,
          details: {
            answered: completion.answered,
            total: completion.total,
            pct: completion.pct,
            threshold_pct: PUYP_COMPLETION_THRESHOLD_PCT,
          },
        },
        { status: 422 }
      );
    }

    // 5. Upload the proof file. Storage path:
    //    exam-proofs/<userId>/<timestamp>-<random>.<ext>
    //    Tying the path to userId means the admin signed-URL stays
    //    tightly scoped: no way to guess someone else's proof path.
    const ext = fileExtensionFor(file.type) || extFromName(file.name) || "bin";
    const filename = `${Date.now()}-${cryptoRandomHex(12)}.${ext}`;
    const storagePath = `${userId}/${filename}`;

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await sb.storage
      .from("exam-proofs")
      .upload(storagePath, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      captureServerError(uploadErr, {
        route: "/api/puyp/submit",
        userId,
        step: "storage_upload",
      });
      return NextResponse.json(
        { error: "Upload failed — please try again." },
        { status: 500 }
      );
    }

    // 6. Insert the pending exam_attempts row.
    const { data: inserted, error: insertErr } = await sb
      .from("exam_attempts")
      .insert({
        user_id: userId,
        subscription_id: activeSub.id,
        exam_type: examType,
        attempt_date: attemptDate,
        result: "fail",
        proof_url: storagePath, // relative path; API signs on demand
        verified_at: null, // pending admin review
        qbank_completion_pct: completion.pct,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      // If the DB insert fails, clean up the uploaded object so we
      // don't leave orphan files in the bucket.
      try {
        await sb.storage.from("exam-proofs").remove([storagePath]);
      } catch {
        /* best-effort cleanup */
      }
      captureServerError(insertErr, {
        route: "/api/puyp/submit",
        userId,
        step: "db_insert",
      });
      return NextResponse.json(
        { error: "Failed to record submission" },
        { status: 500 }
      );
    }

    // 7. Telemetry.
    await sb.from("user_events").insert({
      user_id: userId,
      event_type: "puyp_submission_received",
      event_data: {
        exam_type: examType,
        attempt_date: attemptDate,
        qbank_completion_pct: completion.pct,
        subscription_id: activeSub.id,
        attempt_id: inserted.id,
      },
    });

    return NextResponse.json({
      ok: true,
      attempt_id: inserted.id,
      qbank_completion_pct: completion.pct,
      message:
        "Submitted — an admin will review your proof within 72 hours. We'll email you when it's done.",
    });
  } catch (err) {
    captureServerError(err, { route: "/api/puyp/submit", userId });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function fileExtensionFor(mime: string): string | null {
  switch (mime) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "application/pdf":
      return "pdf";
    default:
      return null;
  }
}

function extFromName(name: string): string | null {
  const idx = name.lastIndexOf(".");
  if (idx === -1 || idx === name.length - 1) return null;
  const ext = name.slice(idx + 1).toLowerCase();
  if (ext.length > 5) return null;
  return ext.replace(/[^a-z0-9]/g, "") || null;
}

function cryptoRandomHex(bytes: number): string {
  // Web Crypto is available in Edge and Node runtimes. Falls back to
  // Math.random in the (very unlikely) environment without it — not
  // cryptographically perfect but good enough for a filename suffix.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let s = "";
  for (let i = 0; i < bytes * 2; i++) {
    s += Math.floor(Math.random() * 16).toString(16);
  }
  return s;
}
