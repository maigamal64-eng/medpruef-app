import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { captureServerError } from "@/lib/sentry-capture";

export function adminErrorResponse(error: unknown, route: string): NextResponse {
  const requestId = randomUUID();
  captureServerError(error, { route, requestId });
  return NextResponse.json({ error: "Could not load or save admin data. Please retry.", requestId }, { status: 500 });
}
