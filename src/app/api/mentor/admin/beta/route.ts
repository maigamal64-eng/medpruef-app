import {NextRequest,NextResponse} from "next/server";
import {getServiceClient} from "@/lib/supabase";
import {requireMentorAdmin} from "@/lib/mentor/admin/guard";
export const dynamic="force-dynamic";
export const maxDuration = 30;
const headers={"Cache-Control":"no-store"};
export async function GET(req:NextRequest){const g=await requireMentorAdmin(req,["users.read"]);if(!g.ok)return g.response;
 const q=req.nextUrl.searchParams.get("q")??"";
 if(!/^[\p{L}\p{N} ]{2,60}$/u.test(q))return NextResponse.json({items:[]},{headers});
 try{const db=getServiceClient();const {data,error}=await db.from("users").select("id,first_name,last_name").or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%`).limit(10);if(error)throw new Error();
 const ids=(data??[]).map(row=>row.id);const overrides=ids.length?await db.from("ai_mentor_beta_override").select("user_id,allowed").in("user_id",ids):{data:[],error:null};if(overrides.error)throw new Error();
 return NextResponse.json({items:(data??[]).map(row=>({...row,allowed:overrides.data?.find(o=>o.user_id===row.id)?.allowed??null}))},{headers});}
 catch{return NextResponse.json({error:"beta_unavailable"},{status:503,headers});}
}
export async function POST(req:NextRequest){const g=await requireMentorAdmin(req);if(!g.ok)return g.response;
 const raw=await req.text();if(raw.length>256)return NextResponse.json({error:"invalid_input"},{status:400,headers});
 let b:{user_id?:unknown;allowed?:unknown};try{b=JSON.parse(raw);}catch{return NextResponse.json({error:"invalid_input"},{status:400,headers});}
 if(!b||typeof b!=="object"||typeof b.user_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(b.user_id)||typeof b.allowed!=="boolean")return NextResponse.json({error:"invalid_input"},{status:400,headers});
 try{const {error}=await getServiceClient().rpc("mentor_set_beta",{p_user:b.user_id,p_allowed:b.allowed,p_actor:g.userId});if(error)throw new Error();return NextResponse.json({ok:true},{headers});}
 catch{return NextResponse.json({error:"beta_unavailable"},{status:503,headers});}
}
