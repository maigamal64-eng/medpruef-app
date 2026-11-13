import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { unavailableResponse } from "./guard";

/** 503 DE_KP_UNAVAILABLE for a missing table, else Sentry plus a plain 500. Never echoes the error. */
export function readFailure(r: { unavailable: boolean; error: unknown }, route: string, step: string): NextResponse {
  if (r.unavailable) return unavailableResponse();
  Sentry.captureException(r.error, { tags: { route: `de-kp/${route}`, step } });
  return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
}

export function badRequest(message = "Bad request"): NextResponse {
  return NextResponse.json({ error: message, code: "BAD_REQUEST" }, { status: 400 });
}

export function notFound(code = "CASE_NOT_FOUND"): NextResponse {
  return NextResponse.json({ error: "Not found", code }, { status: 404 });
}

export function notSubmitted(): NextResponse {
  return NextResponse.json({ error: "Submit this step first", code: "NOT_SUBMITTED" }, { status: 409 });
}

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
