import { expect, test } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { expectNoHorizontalScroll } from "../helpers/page-setup";
const ADMIN="00000000-0000-4000-8000-00000000aaaa";
const LEARNER="00000000-0000-4000-8000-00000000bbbb";
const summary={generated_at:"2026-10-11T12:00:00Z",month:"2026-10",timezone:"Europe/Vienna",projection:{projected_month_micro:31000000,cap_in_days:20},spend:{mentor_micro:10000000,legacy_micro:0,total_micro:10000000,cap_micro:30000000,pct_of_cap:33.3},by_day:Array.from({length:11},(_,i)=>({day:`2026-10-${String(i+1).padStart(2,"0")}`,mentor_micro:1000,calls:5,house_micro:0})),by_model:[],lots_by_package:[],stale_reservations:[],clawbacks:[],top_users:[{user_id:LEARNER,spent_micro:10000,messages:5,available_micro:50000}],overruns:1,debt_total_micro:0,state:{ai_features_enabled:false,mentor_enabled:false,packages_enabled:false,topups_enabled:false,db_flag:{enabled:false,env:"all",rollout_pct:0},resting:false,beta_allowlist_size:0}};
test.use({browserName:"chromium",serviceWorkers:"block",video:"off"});
for(const width of [390,1440])test(`R4 admin header, projection, navigation and trends at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:844});await seedSession(page,{userId:ADMIN,email:"admin-fixture@example.invalid",role:"admin",tier:"admin"});
 await page.context().route("**/*",route=>["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
 let timezone="";
 await page.route("**/api/**",route=>{const url=new URL(route.request().url()),path=url.pathname;
  if(path==="/api/admin/access/me")return route.fulfill({json:{actor:{userId:ADMIN,email:null},roles:[],permissions:["revenue.read","content.read","system.read","users.read"]}});
  if(path==="/api/auth/me")return route.fulfill({json:{user:{id:ADMIN,role:"admin",tier:"admin"}}});
  if(path==="/api/mentor/admin/summary"){timezone=url.searchParams.get("timezone")??"";return route.fulfill({json:{...summary,timezone}});}
  return route.fulfill({json:{}});
 });
 await page.goto("/admin/mentor",{waitUntil:"domcontentloaded"});
 await expect(page.getByRole("heading",{name:"AI Mentor",exact:true})).toBeVisible();
 await expect(page.getByTestId("mentor-phone-header")).toBeVisible();
 for(const label of ["Spend","Cap used","Margin","Alert categories"])await expect(page.getByTestId("mentor-phone-header").getByText(label,{exact:true})).toBeVisible();
 await expect(page.getByText(/Projected month end/)).toBeVisible();await expect(page.getByText(/Cap reached in 20 days at this pace/)).toBeVisible();
 await expect(page.locator(`a[href="/admin/users/${LEARNER}#mentor"]`).first()).toBeVisible();
 await page.getByLabel("Daily timezone").selectOption("UTC");await expect.poll(()=>timezone).toBe("UTC");
 await page.getByLabel("Trend range").selectOption("7");await expect(page.getByRole("tablist")).toBeVisible();
 for(const name of ["Cost","Quality","Review","Facts","Readiness"])await expect(page.getByRole("tab",{name,exact:true})).toHaveCount(1);
 await expect(page.getByRole("button",{name:/refresh/i})).toHaveCount(1);
 await expectNoHorizontalScroll(page);
});
