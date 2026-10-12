import { describe, expect, it } from "vitest";
import { CHANGELOG, getPublicChangelogEntries } from "@/lib/changelog";

describe("getPublicChangelogEntries", () => {
  it("excludes the expired no-card trial and admin-only webhook details", () => {
    const publicEntries = getPublicChangelogEntries();
    const noCardTrial = CHANGELOG.find((entry) => entry.title.en.includes("no-card Pro trial"));
    const webhookRecovery = CHANGELOG.find((entry) => entry.title.en.includes("Whop v1 webhook"));

    expect(noCardTrial?.tag).toBe("admin");
    expect(webhookRecovery?.tag).toBe("admin");
    expect(publicEntries).not.toContain(noCardTrial);
    expect(publicEntries).not.toContain(webhookRecovery);
    expect(publicEntries.every((entry) => entry.tag !== "admin")).toBe(true);
  });

  it("keeps customer-facing updates visible", () => {
    const publicEntries = getPublicChangelogEntries();
    const currentPublicUpdate = CHANGELOG.find((entry) => entry.date === "2026-09-25");

    expect(currentPublicUpdate).toBeDefined();
    expect(publicEntries).toContain(currentPublicUpdate);
  });

  it("public entries never name internal systems (track-A audit 12 Oct 2026)", () => {
    const internal = /\b(Sentry|webhooks?|cron|migrations?|Supabase|Vercel|RPC|CSP|PostgREST|ClickHouse|Codex|Claude Code|Lane [AB]|admin|Datenbank|database|deploys?|endpoints?|API|feature flags?|Feature-Flags?)\b/i;
    const leaks = getPublicChangelogEntries()
      .map((e) => ({ e, text: [e.title.de, e.title.en, e.description.de, e.description.en].join(" ") }))
      .filter(({ text }) => internal.test(text))
      .map(({ e }) => `${e.date} ${e.title.en}`);
    expect(leaks).toEqual([]);
  });
});
