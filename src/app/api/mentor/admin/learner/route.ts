import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { loadMentorLearnerPanel } from "@/lib/mentor/admin-learner";
import { requireMentorAdmin } from "../summary/guard";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const gate = await requireMentorAdmin(req); if (!gate.ok) return gate.response;
  const users = await requireMentorAdmin(req, "users.read"); if (!users.ok) return users.response;
  const userId = req.nextUrl.searchParams.get("user_id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return NextResponse.json({error:"invalid_user"},{status:400});
  try { return NextResponse.json(await loadMentorLearnerPanel(getServiceClient(), userId, new Date()), {headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"mentor_learner_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}}); }
}
