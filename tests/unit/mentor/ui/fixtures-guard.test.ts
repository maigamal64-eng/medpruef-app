import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../../../src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

describe("synthetic fixtures cannot reach production code", () => {
  const files = walk(SRC);

  it("only fixture-client.ts imports the contract fixtures", () => {
    const offenders = files.filter((f) => /mentor\/fixtures["']/.test(readFileSync(f, "utf8")) && !f.endsWith("fixture-client.ts") && !f.includes(`${path.sep}lib${path.sep}mentor${path.sep}`));
    expect(offenders).toEqual([]);
  });

  it("only client.ts imports fixture-client, and only through a dynamic import behind the build flag", () => {
    const users = files.filter((f) => /fixture-client/.test(readFileSync(f, "utf8")) && !f.endsWith("fixture-client.ts"));
    expect(users.map((f) => path.basename(f))).toEqual(["client.ts"]);
    const src = readFileSync(users[0], "utf8");
    expect(src).toMatch(/process\.env\.NODE_ENV !== "production" && process\.env\.NEXT_PUBLIC_MENTOR_FIXTURES === "true"/);
    expect(src).toMatch(/import\("\.\/fixture-client"\)/);
    expect(src).not.toMatch(/^import .*fixture-client/m);
  });

  it("no screen shows raw dollars or reads a micro-USD field", () => {
    const ui = files.filter((f) => f.includes(`${path.sep}components${path.sep}mentor${path.sep}`) && !f.endsWith("fixture-client.ts"));
    for (const f of ui) expect(readFileSync(f, "utf8"), f).not.toMatch(/_micro|micro_|MICRO|CREDIT_MICRO|creditsFromMicro|\bUSD\b/);
  });
});
