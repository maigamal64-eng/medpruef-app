import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { LLMS_TXT_BASE } from "@/lib/agent-docs/llms-txt";
import { renderLlmsTxt } from "@/lib/agent-docs/render-llms";
import { ANSWER_PAGES, answerPath } from "@/lib/answer-pages/registry";

// sha256 of the flag-off llms.txt body. Moved from public/llms.txt (origin/main 2a7cfad5,
// 075058bd...) by a-answer-pages; re-pinned by a-lektor-copy-1a F01 (15 Oct 2026), which
// corrected the provenance, exam-name and free-sample claims. Change it only with a Lektor read.
const PUBLIC_LLMS_SHA = "d372e9c62c3d393da4743b07bf5f3c1e532cd2cf71805299a5485e8673aa9ebc";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("llms.txt route body", () => {
  it("is the pinned body while the flag is off", () => {
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
