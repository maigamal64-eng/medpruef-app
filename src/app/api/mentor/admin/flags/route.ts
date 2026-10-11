import { NextRequest,NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { invalidateFlagCache } from "@/lib/admin/flags";
import { requireMentorAdmin } from "../summary/guard";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
export async function GET(req:NextRequest){const g=await requireMentorAdmin(req,"system.read");if(!g.ok)return g.response;
 try {const db=getServiceClient();const [f,c]=await Promise.all([db.from("flags").select("enabled,rollout_pct").eq("key","mentor").maybeSingle(),db.from("ai_mentor_control").select("paused_rollout_pct,paused_at").eq("key","mentor").maybeSingle()]);if(f.error||c.error)throw new Error();return NextResponse.json({flag:f.data,control:c.data},{headers});}
 catch{return NextResponse.json({error:"control_unavailable"},{status:503,headers});}
}
export async function POST(req:NextRequest){const g=await requireMentorAdmin(req,"system.manage");if(!g.ok)return g.response;
 const raw=await req.text();if(raw.length>128)return NextResponse.json({error:"invalid_input"},{status:400,headers});
 let pause:unknown;try{pause=JSON.parse(raw).pause;}catch{return NextResponse.json({error:"invalid_input"},{status:400,headers});}
 if(typeof pause!=="boolean")return NextResponse.json({error:"invalid_input"},{status:400,headers});
 try{const {data,error}=await getServiceClient().rpc("mentor_set_pause",{p_pause:pause,p_actor:g.userId});if(error)return NextResponse.json({error:"control_rejected"},{status:409,headers});invalidateFlagCache("mentor");return NextResponse.json(data,{headers});}
 catch{return NextResponse.json({error:"control_unavailable"},{status:503,headers});}
}
