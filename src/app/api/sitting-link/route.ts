import type { NextRequest } from "next/server";
import { handleSittingLinkGet, handleSittingLinkPost } from "@/lib/sitting-link/server";

// a-sitting-one-tap: the page behind the one-tap sitting link in learner
// mails. GET shows the choice and writes nothing; only the form POST saves.
// Behind SITTING_LINK_ENABLED (default off).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  return handleSittingLinkGet(req);
}

export async function POST(req: NextRequest) {
  return handleSittingLinkPost(req);
}
