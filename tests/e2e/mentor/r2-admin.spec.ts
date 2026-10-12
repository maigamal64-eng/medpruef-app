import {expect,test,type Page} from "@playwright/test";
import {seedSession} from "../fixtures/session";
import {expectNoHorizontalScroll} from "../helpers/page-setup";
const ADMIN="00000000-0000-4000-8000-00000000aaaa";
const REQUEST="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONVERSATION="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
test.use({browserName:"chromium",serviceWorkers:"block",video:"off"});
async function setup(page:Page){
 await seedSession(page,{userId:ADMIN,email:"admin-fixture@example.invalid",role:"admin",tier:"admin"});
 await page.context().route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 const writes:Array<{path:string;body:unknown}>=[];
 await page.route("**/api/**",route=>{
 const path=new URL(route.request().url()).pathname;
 if(route.request().method()==="POST"&&path==="/api/track")return route.fulfill({json:{ok:true}});
 if(route.request().method()==="POST"){writes.push({path,body:route.request().postDataJSON()});return route.fulfill({json:{ok:true,paused:true}});}
 if(path==="/api/admin/access/me")return route.fulfill({json:{actor:{userId:ADMIN,email:null},roles:[],permissions:["revenue.read","content.read","content.moderate","system.read","system.manage","users.read"]}});
 if(path==="/api/auth/me")return route.fulfill({json:{user:{id:ADMIN,role:"admin",tier:"admin"}}});
 if(path==="/api/mentor/admin/summary")return route.fulfill({status:503,json:{error:"ledger_not_applied"}});
 if(path==="/api/mentor/admin/operations")return route.fulfill({json:{generated_at:"2026-10-11T12:00:00Z",breaker:{floor_micro:50000000,net_pct:6,resting_until:"2026-11-01T00:00:00Z"},checks:[{key:"ledger",label:"Mentor ledger",ok:false,detail:"Not installed",fix:"Apply the reviewed changeset"}],facts:{total:1,assertable:1,due_7_days:1,expired:0,due_3_days:1,oldest_read_on:"2026-10-10",errors:[],soonest:[{id:"fixture.fact",read_on:"2026-10-10",due_on:"2026-10-17",source_url:"https://example.org",owner_file:"content/mentor-facts/fixture.json",status:"Due"}]},last_turn:null,last_sweep:null,last_whop_event:null,last_eval:null}});
 if(path==="/api/mentor/admin/flags")return route.fulfill({json:{flag:{enabled:false,rollout_pct:100},control:null}});
 if(path==="/api/mentor/admin/review")return route.fulfill({json:{items:[{request_id:REQUEST,conversation_id:CONVERSATION,question_text:"Synthetic question",answer_text:"Synthetic canonical answer",lang:"ru",outcome:"notice_only",created_at:"2026-10-11T12:00:00Z",category:"reported",citations:[{fact_id:"fixture.fact",read_on:"2026-10-10",source_url:"https://example.org"}],verdict:null,user_id:"DO_NOT_DISPLAY_LEARNER_ID"}],retention_days:30}});
 return route.fulfill({json:{}});
 });return writes;
}
for(const width of [390,1440])test(`MUX-101/102 readiness and fact health before installation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await setup(page);await page.goto("/admin/mentor",{waitUntil:"domcontentloaded"});
 await expect(page.getByText("Not installed",{exact:true})).toBeVisible();await expect(page.getByText("DISCONNECTED",{exact:true})).toHaveCount(0);
 await page.getByRole("tab",{name:"Readiness",exact:true}).click();await expect(page.getByText("! Fix",{exact:true})).toBeVisible();await page.getByRole("tab",{name:"Facts",exact:true}).click();await expect(page.getByText(/1 total rows/)).toBeVisible();await expect(page.getByText("Due",{exact:true})).toBeVisible();await expectNoHorizontalScroll(page);
});
test("MUX-103 pause confirmation starts on Cancel and cancellation causes no write",async({page})=>{
 const writes=await setup(page);await page.goto("/admin/mentor?tab=Readiness",{waitUntil:"domcontentloaded"});await page.getByRole("button",{name:"Pause mentor",exact:true}).click();const dialog=page.getByRole("dialog");await expect(dialog.getByRole("button",{name:"Cancel",exact:true})).toBeFocused();await dialog.getByRole("button",{name:"Cancel",exact:true}).click();expect(writes).toEqual([]);await expect(dialog).toHaveCount(0);
});
test("MUX-100 review groups opaque conversations, hides learner identity and saves visible verdict",async({page})=>{
 const writes=await setup(page);await page.goto("/admin/mentor/review",{waitUntil:"domcontentloaded"});await expect(page.getByRole("heading",{name:`Conversation ${CONVERSATION}`})).toBeVisible();await expect(page.getByText("DO_NOT_DISPLAY_LEARNER_ID")).toHaveCount(0);await expect(page.getByText("Synthetic canonical answer",{exact:false})).toBeVisible();const wrong=page.getByRole("button",{name:"Wrong",exact:true});expect((await wrong.boundingBox())!.height).toBeGreaterThanOrEqual(44);await wrong.click();await expect(page.getByText("Verdict: Wrong",{exact:true})).toBeVisible();expect(writes).toEqual([{path:"/api/mentor/admin/review",body:{request_id:REQUEST,verdict:"wrong"}}]);
});
