import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { C1_ASK, C1_PLAN_CTA, C1_ROWS, C1_ROWS_ONE_LEFT, C1_TITLE } from "@/lib/stp-deadline-card/copy";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * sha256 of every approved C1 string, DE then EN, taken from
 * reports/growth-weekly/2026-11-16/approved/in-app-lines.json (file sha256
 * efc8b8338fe2363756c69da614f047145b09f98fe1469ae1acc47d1c26886fa8).
 * Change a string only with a new Lektor APPROVE.
 */
const APPROVED: Record<string, [string, string, () => [string, string]]> = {
  title: ["f42f35e4dd2c847e978e37dcf3c129d4aa76cdae5012a81a74339811b8f9d49a", "5b4c4cd97c4606f1793ee1069b788cee7667189228692b0d6efe8128debf1f0e", () => [C1_TITLE.de, C1_TITLE.en]],
  rows: ["a24fe89c4c29235e0f9dcf42d1cd9fde66215899d78d9196a5343616675d9a75", "1c0f36d25a913985129430f40ded480c84cd8de9c97ea62443cba2ba1c67c580", () => [C1_ROWS.de, C1_ROWS.en]],
  rows_one_left: ["ec534e9daae7269b91b23bb099773d687abeb70fe64dc525e791cc97d1e002b6", "f5a9efb708f6fe05e5eec14c927efcc722245d1393e27ce3dbf3371ac249100c", () => [C1_ROWS_ONE_LEFT.de, C1_ROWS_ONE_LEFT.en]],
  plan_cta: ["c3ca239103f94d92d44fc4b90f41ca4bf56732dfb30807627afb26c27ca06d8c", "eb81ce9b9a1f952b48b14d0dbe9fdb9129ad0932e0daa887eb947f36fb3d0e42", () => [C1_PLAN_CTA.de, C1_PLAN_CTA.en]],
  ask_body: ["7b74cb7f0c63d439a4ef8944263cbcbbdf9a60d779011c6d4af320eb7022f431", "a73ed80535b3db10ab899b641f8bac43e603f6edeaf444409a64da4a99ad05c0", () => [C1_ASK.de.body, C1_ASK.en.body]],
  ask_cta: ["a0deadeef6e46675fbb15b0d83e85d1e8adc55e2e47ed92ba371eb16858c9421", "58cb96d1b3495519dce70ed4898958c68e1ca4d89da9b460ff1c6166b8bb3cd2", () => [C1_ASK.de.cta, C1_ASK.en.cta]],
};

describe("C1 copy (16 Nov growth pass)", () => {
  for (const [id, [de, en, get]] of Object.entries(APPROVED)) {
    it(`${id} equals the approved line byte for byte`, () => {
      const [gotDe, gotEn] = get();
      expect(sha(gotDe)).toBe(de);
      expect(sha(gotEn)).toBe(en);
    });
  }
  it("has no dash characters, no exclamation mark, no typed price", () => {
    const all = Object.values(APPROVED).flatMap(([, , get]) => get());
    for (const s of all) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toContain("!");
      expect(s).not.toMatch(/€|EUR/);
    }
  });
});
