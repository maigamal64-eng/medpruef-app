import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { staffOnlyGate } from "@/lib/sim-server/gate";
import { handleGet, handlePost, type SimApiDeps } from "@/lib/sim-server/session-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// S10 replaces `staffOnlyGate` with the real access rule; nothing else here changes.
const deps: SimApiDeps = { db: () => getServiceClient(), gate: staffOnlyGate, now: () => Date.now(), newId: () => randomUUID() };

export const GET = withDbUnavailable((req: NextRequest) => handleGet(req, deps));
export const POST = withDbUnavailable((req: NextRequest) => handlePost(req, deps));
