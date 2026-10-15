import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";
import { renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { ANSWER_PAGES, answerPath } from "@/lib/answer-pages/registry";

// sha256 of public/llms.txt at origin/main 2a7cfad5, before it moved into a route.
const PUBLIC_LLMS_SHA = "075058bd1baf493c39e740c6464507c780a37533774a0b1253f0d673d71bcbcd";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("llms.txt route body", () => {
  it("is byte for byte the former static file while the flag is off", () => {
    expect(sha(LLMS_TXT_BASE)).toBe(PUBLIC_LLMS_SHA);
    expect(renderLlmsTxt({})).toBe(LLMS_TXT_BASE);
    expect(renderLlmsTxt({ ANSWER_PAGES_ENABLED: "1" })).toBe(LLMS_TXT_BASE);
  });

  it("lists every answer page except the mentor page when on, before Pricing", () => {
    const on = renderLlmsTxt({ ANSWER_PAGES_ENABLED: "true", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" });
    const listed = ANSWER_PAGES.filter((p) => p.llms !== false);
    expect(listed.length).toBeGreaterThan(0);
    for (const page of listed) expect(on).toContain(`https://medpruf.com${answerPath(page)}`);
    for (const page of ANSWER_PAGES.filter((p) => p.llms === false)) expect(on).not.toContain(answerPath(page));
    expect(on.indexOf("## Short answers")).toBeLessThan(on.indexOf("## Pricing"));
    expect(on).toContain("\n\n## Short answers (exam logistics)\n\n");
    expect(on.replace(/## Short answers[\s\S]*?\n\n(?=## Pricing)/, "")).toBe(LLMS_TXT_BASE);
  });

  it("the route serves the rendered body as text", async () => {
    const { GET } = await import("@/app/llms.txt/route");
    const res = GET();
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe(renderLlmsTxt());
  });
});
