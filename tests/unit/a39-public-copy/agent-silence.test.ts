import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { renderLlmsFullTxt, renderLlmsTxt } from "@/lib/agent-docs/render-llms";

const ROOT = path.resolve(__dirname, "../../..");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Agent-facing discovery files stay silent about the KI-Mentor until launch.
 * The referral skill uses "mentor" for a human adviser, so the check targets
 * the product: KI-Mentor / AI mentor, the /mentor route, mentor credits and
 * the package names.
 */
const PRODUCT = /KI-Mentor|AI[- ]mentor|\/mentor\b|mentor[- ]credit|Mentor-Credit|Mentor (Basis|Plus)|mentor_(basis|plus|topup)/i;

describe("llms, openapi and .well-known stay silent about the mentor product", () => {
  // a-pricing-v2: llms-full.txt is served by a route; both offers are checked.
  it.each([["v1", false], ["v2", true]] as const)("llms-full.txt (%s)", (_name, v2) => {
    expect(renderLlmsFullTxt(v2)).not.toMatch(PRODUCT);
  });
  const files = [
    ...walk(path.join(ROOT, "src/app/openapi.json")),
    ...walk(path.join(ROOT, "src/app/.well-known")),
    ...walk(path.join(ROOT, "public")).filter((f) => f.includes(`${path.sep}.well-known${path.sep}`)),
  ];
  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s", (_rel, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(PRODUCT);
  });
  // llms.txt is served by a route since a-answer-pages; check it with every
  // flag combination that could list the mentor answer page.
  it.each([
    ["flags off", {}],
    ["answer pages on", { ANSWER_PAGES_ENABLED: "true" }],
    ["answer pages and mentor copy on", { ANSWER_PAGES_ENABLED: "true", NEXT_PUBLIC_MENTOR_PUBLIC_COPY: "true" }],
  ] as const)("llms.txt (%s)", (_name, env) => {
    expect(renderLlmsTxt(env)).not.toMatch(PRODUCT);
    // a-pricing-v2: the v2 pricing sentence stays silent too.
    expect(renderLlmsTxt(env, true)).not.toMatch(PRODUCT);
  });
});
