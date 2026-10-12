import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireMentorAdmin } from "@/lib/mentor/admin/guard";
import { loadMentorOperations } from "./load";
export const dynamic="force-dynamic";
export async function GET(req:NextRequest){const gate=await requireMentorAdmin(req);if(!gate.ok)return gate.response;
 try {return NextResponse.json(await loadMentorOperations(getServiceClient(),new Date()),{headers:{"Cache-Control":"no-store"}});}
 catch {return NextResponse.json({error:"operations_unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});}
}
