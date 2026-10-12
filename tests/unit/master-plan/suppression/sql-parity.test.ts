import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { suppressionKey } from "@/lib/mail-suppression";

// parity-fixture.json is written by scripts/sql/master-plan/suppression/proof/run-local-pg16.sh
// from public.mail_suppression_key() on a real Postgres 16.
const fixture = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../scripts/sql/master-plan/suppression/proof/parity-fixture.json"), "utf8"),
) as Array<{ input: string; key: string }>;

describe("TypeScript key equals the Postgres key", () => {
  it("covers whitespace, case and the letter v at the edges", () => {
    expect(fixture.length).toBeGreaterThanOrEqual(6);
    expect(fixture.some((f) => f.input.includes("\u000b"))).toBe(true);
    expect(fixture.some((f) => /^v/i.test(f.input))).toBe(true);
  });
  it.each(fixture.map((f) => [JSON.stringify(f.input), f]))("%s", (_label, f) => {
    expect(suppressionKey(f.input)).toBe(f.key);
  });
});
