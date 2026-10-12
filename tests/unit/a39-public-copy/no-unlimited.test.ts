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

describe("MUX-87/88: no unlimited claims on /pricing or in the claims register", () => {
  const files = [
    ...walk(path.join(ROOT, "src/app/pricing")).filter((f) => /\.(tsx?|json)$/.test(f)),
    path.join(ROOT, "src/lib/guidance-data/learning-claims.copy.json"),
    path.join(ROOT, "src/lib/mentor-public/copy.ts"),
  ];
  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s", (_rel, file) => {
    expect(readFileSync(file, "utf8")).not.toMatch(/unbegrenzt|unlimited/i);
  });
});
