import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

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
  const files = [
    path.join(ROOT, "public/llms.txt"),
    path.join(ROOT, "public/llms-full.txt"),
    ...walk(path.join(ROOT, "src/app/openapi.json")),
    ...walk(path.join(ROOT, "src/app/.well-known")),
    ...walk(path.join(ROOT, "public")).filter((f) => f.includes(`${path.sep}.well-known${path.sep}`)),
  ];
  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s", (_rel, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(PRODUCT);
  });
});
