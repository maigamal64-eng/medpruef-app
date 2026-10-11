import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";
import { mentorT } from "../../../src/lib/i18n-mentor";
import { FIXTURE_FINAL_OK } from "../../../src/lib/mentor/fixtures";

test.use({ browserName: "chromium", serviceWorkers: "block", video: "off" });
const USER = "82e7fccc-06b4-4c43-8146-127cf84ed8da";
async function setup(page: Page) {
  await seedSession(page,{userId:USER,email:"mentor-fixture@example.invalid",tier:"pro"});
  await page.addInitScript(() => { localStorage.setItem("medpruef-lang","en"); localStorage.setItem("medpruef_cookies","declined"); });
  await page.context().route("**/*", route => ["localhost","127.0.0.1"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const calls: Array<{path:string;method:string;body:unknown}> = [];
  let erased = false;
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    calls.push({path,method,body:route.request().postDataJSON()});
    if (path === "/api/mentor/usage") return route.fulfill({json:{state:"ok",credits_left:50,messages_left_estimate:30,next_expiry:null,sources:["pro_included"],subscriptions:[],can_buy:false}});
    if (path === "/api/mentor/chat/history" && method === "DELETE") { erased=true; return route.fulfill({json:{ok:true}}); }
    if (path === "/api/mentor/chat/history") return route.fulfill({json:erased ? {conversation_id:null,messages:[]} : {conversation_id:FIXTURE_FINAL_OK.conversation_id,messages:[{id:"u",role:"user",text:"Earlier synthetic message"},{id:"a",role:"assistant",text:"Earlier synthetic answer",final:FIXTURE_FINAL_OK}]}});
    if (path === "/api/mentor/chat") return route.fulfill({contentType:"text/event-stream",body:`data: ${JSON.stringify(FIXTURE_FINAL_OK)}\n\n`});
    return route.fulfill({json:{}});
  });
  return calls;
}
test("MUX-96 bounded URL draft is never sent on arrival and entry is persisted on explicit send",async({page})=>{
  const calls=await setup(page);
  await page.goto("/mentor?mode=study&from=home&q=Discuss%20my%20plan",{waitUntil:"domcontentloaded"});
  await expect(page.getByRole("textbox",{name:mentorT("composer_label","en")})).toHaveValue("Discuss my plan");
  expect(calls.filter(c=>c.path==="/api/mentor/chat")).toHaveLength(0);
  await page.getByRole("button",{name:"Send",exact:true}).click();
  await expect.poll(()=>calls.filter(c=>c.path==="/api/mentor/chat").length).toBe(1);
  expect(calls.find(c=>c.path==="/api/mentor/chat")!.body).toMatchObject({mode:"study",entry:"home",message:"Discuss my plan"});
});
test("MUX-53 deletion confirms with Cancel focus, deletes only the owner and stays empty on reload",async({page})=>{
  const calls=await setup(page);
  await page.goto("/mentor",{waitUntil:"domcontentloaded"});
  await expect(page.getByText("Earlier synthetic message")).toBeVisible();
  await page.getByRole("button",{name:"More",exact:true}).click();
  await expect(page.getByText(/uses your messages and your study progress/)).toBeVisible();
  await expect(page.getByRole("link",{name:"Privacy",exact:true})).toHaveAttribute("href","/privacy");
  await page.getByRole("button",{name:"Delete chat",exact:true}).click();
  await expect(page.getByRole("button",{name:"Cancel",exact:true})).toBeFocused();
  expect(calls.filter(c=>c.method==="DELETE")).toHaveLength(0);
  await page.getByRole("dialog").getByRole("button",{name:"Delete chat",exact:true}).click();
  await expect(page.getByText("Earlier synthetic message")).toHaveCount(0);
  await page.reload({waitUntil:"domcontentloaded"});
  await expect(page.getByText("Earlier synthetic message")).toHaveCount(0);
  expect(calls.filter(c=>c.method==="DELETE")).toEqual([{path:"/api/mentor/chat/history",method:"DELETE",body:null}]);
});
