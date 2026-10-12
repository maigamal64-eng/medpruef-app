import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// a-db-timeouts: every route function has an explicit maxDuration so a stuck
// call can never hold a function for the 300 s platform default again. The
// default is 30 s; a longer limit (60 s, the most every Vercel plan allows)
// needs a reason here. Next.js only reads a literal in the route file.
const DEFAULT_MAX = 30;
const LONGER: Record<string, string> = {
  "api/ai-chat": "Anthropic primary (25 s) plus fallback model (20 s)",
  "api/mentor/chat": "up to three tool rounds inside MENTOR_TURN_BUDGET",
  "api/translate": "20 s provider call plus a fallback provider",
  "api/notes/transform": "25 s Haiku call plus a repair call",
  "api/notes/[id]/visibility": "15 s PII and quality scan before publishing",
  "api/cron/admin-action-alert": "cron batch with Telegram sends",
  "api/cron/checkout-failure-watch": "cron batch",
  "api/cron/daily-digest": "cron batch",
  "api/cron/mentor-health": "cron batch",
  "api/cron/mentor-sweep": "cron sweep of stale mentor holds",
  "api/cron/trial-reminder": "cron sweep with email sends",
  "api/cron/exam-reminders": "cron batch with email sends (b19 senders)",
  "api/cron/study-nudge": "cron batch with email sends (b19 senders)",
  "api/webhooks/whop": "Whop membership lookup plus grant; a kill after the idempotency claim would lose the grant",
  "api/webhooks/nowpayments": "payment grant after the idempotency claim",
  "api/whop/checkout": "Whop API checkout creation (money path)",
  "api/whop/checkout/verify": "Whop ledger paging plus grant (money path)",
  "api/whop/trial": "Whop API trial checkout (money path)",
  "api/whop/trial/verify": "Whop ledger paging plus grant (money path)",
  "api/mentor/checkout": "Whop API checkout creation (money path)",
  "api/mentor/checkout/verify": "Whop ledger read plus credit grant (money path)",
  "api/admin/payments/resolve": "manual payment link grant through Whop",
  "api/offline/questions": "bulk question download for offline study",
  "api/stats/admin/payments": "admin: paged money reads past the 1000-row cap",
  "api/stats/admin/payments/trace": "admin: one payment across several ledgers",
  "api/stats/admin/growth": "admin: paged funnel reads",
  "api/stats/admin/duplicates": "admin: pages through the whole bank",
  "api/stats/admin/users/[id]": "admin: every answer of one learner, paged",
  "api/stats/admin/users": "admin: learner directory and segment counts (heavy RPCs, 25 s deadline)",
  "api/admin/overview": "admin: independent blocks incl. money ledger paging",
  "api/admin/subscriptions": "admin: paged roster with money totals",
  "api/admin/audit": "admin: newest-first audit scan",
  "api/mentor/admin/revenue": "admin: mentor money ledger paging",
};

const files = globSync("src/app/**/route.ts").concat(globSync("src/app/.well-known/**/route.ts"));
const unique = [...new Set(files)].sort();
const key = (file: string) => file.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");

describe("route maxDuration", () => {
  it("finds the route files", () => {
    expect(unique.length).toBeGreaterThan(150);
  });
  for (const file of unique) {
    it(`${key(file)} declares a bounded maxDuration`, () => {
      const match = readFileSync(file, "utf8").match(/^export const maxDuration = (\d+);$/m);
      expect(match, `${file} has no literal maxDuration`).not.toBeNull();
      const value = Number(match![1]);
      const reason = LONGER[key(file)];
      if (reason) expect(value).toBe(60);
      else expect(value).toBeLessThanOrEqual(DEFAULT_MAX);
    });
  }
  it("every longer limit points at a real route", () => {
    for (const route of Object.keys(LONGER)) expect(unique).toContain(`src/app/${route}/route.ts`);
  });
  it("the force-dynamic coverage page with a database read is bounded too", () => {
    expect(readFileSync("src/app/graz-innsbruck/abdeckung/page.tsx", "utf8")).toMatch(/^export const maxDuration = 30;$/m);
  });
});
