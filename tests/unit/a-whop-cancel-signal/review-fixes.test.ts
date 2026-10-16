/**
 * a-whop-cancel-signal reviewer fixes: switch-aware card, Telegram token
 * scrub, daily-read rotation, stale-claim takeover, category allowlist.
 */
import { describe, expect, it } from "vitest";
import { createFakeSupabase, eqVal, type FakeCall, type FakeResult } from "../helpers/fake-supabase";
import { decideRenewalOff } from "@/lib/renewal-off";
import { scrubSentryPayload, scrubTelegramToken } from "@/lib/sentry-scrub";
import { classifyWhopSignal, rotateForDay, type WhopSignal } from "@/lib/whop-signal";
import { recordWhopSignal, SIGNAL_STALE_CLAIM_MS } from "@/lib/whop-signal-server";
import type { SupabaseClient } from "@supabase/supabase-js";

const FUTURE = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const sig = (mem: string, flag: boolean) => ({ created_at: "2026-10-16T08:00:00Z", event_data: { membership_id: mem, cancel_at_period_end: flag } });

describe("P2-1 renewal-off card after a plan switch", () => {
  it("hides when a newer pinned membership runs longer", () => {
    const pins = [{ whop_membership_id: "mem_old", expires_at: FUTURE(10) }, { whop_membership_id: "mem_new", expires_at: FUTURE(190) }];
    expect(decideRenewalOff(pins, [sig("mem_old", true)]).show).toBe(false);
    expect(decideRenewalOff(pins.slice(0, 1), [sig("mem_old", true)]).show).toBe(true);
  });
});

describe("P2-2 Telegram token scrub", () => {
  it("redacts bot tokens anywhere in a Sentry payload", () => {
    const url = "https://api.telegram.org/bot123456789:AAH-abcdefghijklmnop_xyz/sendMessage";
    expect(scrubTelegramToken(url)).toBe("https://api.telegram.org/bot<redacted>/sendMessage");
    const crumb = scrubSentryPayload({ category: "fetch", data: { url, nested: [url] } });
    expect(JSON.stringify(crumb)).not.toContain("AAH-abcdefghijklmnop");
  });
});

describe("P2-3 daily read covers every membership over days", () => {
  it("rotates a long list by day", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const seen = new Set<number>();
    for (let d = 0; d < 3; d += 1) rotateForDay(items, 40, d * 86_400_000).slice(0, 40).forEach((i) => seen.add(i));
    expect(seen.size).toBe(100);
    expect(rotateForDay([1, 2], 40, 0)).toEqual([1, 2]);
  });
});

describe("P2-4 / P3-6 stale claim takeover", () => {
  function sb(existing: { processed_at: string; payload: Record<string, unknown> } | null) {
    const rows = new Map<string, { processed_at: string; payload: Record<string, unknown> }>();
    if (existing) rows.set("k", existing);
    const writes: string[] = [];
    const fake = createFakeSupabase((c: FakeCall): FakeResult | undefined => {
      if (c.table === "processed_webhook_events") {
        if (c.op === "insert") {
          const r = c.payload as { event_id: string; payload: Record<string, unknown> };
          if (rows.has(r.event_id)) return { error: { code: "23505" } };
          rows.set(r.event_id, { processed_at: new Date().toISOString(), payload: r.payload });
          return {};
        }
        if (c.op === "select") return { data: rows.get(eqVal(c, "event_id") as string) ?? null };
        if (c.op === "delete") {
          const k = eqVal(c, "event_id") as string;
          const row = rows.get(k);
          if (row && row.processed_at === eqVal(c, "processed_at")) { rows.delete(k); return { data: [{ event_id: k }] }; }
          return { data: [] };
        }
        if (c.op === "update") return {};
      }
      if (c.table === "user_events" && c.op === "insert") writes.push("log");
      if (c.table === "subscriptions") return { data: [] };
      return {};
    });
    return { client: fake.sb as unknown as SupabaseClient, writes };
  }
  const signal = classifyWhopSignal("resolution_center_case.created", { data: { id: "reso_1" } }) as WhopSignal;

  it("takes over a claim a killed run left without its log row", async () => {
    const t = sb({ processed_at: new Date(Date.now() - SIGNAL_STALE_CLAIM_MS - 1000).toISOString(), payload: { logged: false } });
    expect((await recordWhopSignal(t.client, signal, { claimKey: "k", source: "webhook", webhookId: "k" })).status).toBe("logged");
    expect(t.writes).toEqual(["log"]);
  });

  it("a young unlogged claim answers unavailable (503) so Whop keeps retrying", async () => {
    const t = sb({ processed_at: new Date().toISOString(), payload: { logged: false } });
    expect(await recordWhopSignal(t.client, signal, { claimKey: "k", source: "webhook", webhookId: "k" })).toEqual({ status: "unavailable", step: "claim" });
    expect(t.writes).toEqual([]);
  });

  it("a logged claim or a state key stays a duplicate", async () => {
    for (const existing of [
      { processed_at: new Date(Date.now() - 10 * SIGNAL_STALE_CLAIM_MS).toISOString(), payload: { logged: true } },
      { processed_at: new Date(Date.now() - 10 * SIGNAL_STALE_CLAIM_MS).toISOString(), payload: { kind: "state" } },
    ]) {
      const t = sb(existing);
      expect((await recordWhopSignal(t.client, signal, { claimKey: "k", source: "webhook", webhookId: "k" })).status).toBe("duplicate");
      expect(t.writes).toEqual([]);
    }
  });
});

describe("P3-5 categories only", () => {
  it("never copies free text into the cancel or case reason", () => {
    const r = classifyWhopSignal("membership.cancel_at_period_end_changed", { data: { id: "mem_a", cancel_option: "Max Mustermann hates it" } });
    expect(r?.kind === "renewal" && r.cancelOption).toBe("other");
    const c = classifyWhopSignal("resolution_center_case.created", { data: { id: "reso_1", reason: "product_not_received" } });
    expect(c?.kind === "case" && c.reason).toBe("product_not_received");
  });

  it("P3-11 reads previous_attributes from data too", () => {
    expect(classifyWhopSignal("membership.updated", { data: { id: "mem_a", cancel_at_period_end: true, previous_attributes: { cancel_at_period_end: false } } })?.kind).toBe("renewal");
  });
});
