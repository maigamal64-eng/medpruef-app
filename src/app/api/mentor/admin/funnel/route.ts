import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { buildMentorFunnel, type FunnelEvent } from "@/lib/mentor/funnel";
import type { MentorTurnRow } from "@/lib/mentor/outcomes";
import { requireMentorAdmin } from "@/lib/mentor/admin/guard";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const LIMIT = 10_000;
const HEADERS = {"Cache-Control":"no-store"};
export async function GET(req: NextRequest) {
  const gate = await requireMentorAdmin(req);
  if (!gate.ok) return gate.response;
  try {
    const db = getServiceClient();
    const since = new Date(Date.now()-30*86_400_000).toISOString();
    const [events,turns] = await Promise.all([
      db.from("user_events").select("event_type,event_data",{count:"exact"}).like("event_type","mentor_%").gte("created_at",since).order("created_at",{ascending:false}).limit(LIMIT+1),
      db.from("ai_mentor_turn").select("mode,outcome,charged_micro,house_micro",{count:"exact"}).gte("created_at",since).order("created_at",{ascending:false}).limit(LIMIT+1),
    ]);
    if(events.error || turns.error) throw new Error("funnel unavailable");
    // PostgREST may cap rows below the requested limit. Refuse shortened totals.
    if(events.count === null || turns.count === null || events.count>LIMIT || turns.count>LIMIT || events.data?.length!==events.count || turns.data?.length!==turns.count) return NextResponse.json({error:"row_cap_reached"},{status:503,headers:HEADERS});
    return NextResponse.json(buildMentorFunnel((events.data ?? []) as FunnelEvent[],(turns.data ?? []) as MentorTurnRow[]),{headers:HEADERS});
  } catch { return NextResponse.json({error:"funnel_unavailable"},{status:503,headers:HEADERS}); }
}
