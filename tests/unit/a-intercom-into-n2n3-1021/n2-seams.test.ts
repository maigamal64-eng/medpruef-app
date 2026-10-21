/**
 * a-intercom-into-n2n3-1021, N2 seams between contact sync and marketing
 * consent: mp_marketing_opt_in follows the sender rule, a users read falls
 * back when the consent column is missing, a fresh contact gets its opt-in
 * mirrored once, and one Intercom privacy row covers every flag mix.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServiceClient } = vi.hoisted(() => ({
  getServiceClient: vi.fn(() => {
    throw new Error("database must not be read in these tests");
  }),
}));
vi.mock("@/lib/supabase", () => ({ getServiceClient }));

import { buildContactPayload, contactMarketingOptIn, isMissingConsentColumn } from "@/lib/intercom/contact-payload";
import { resetIntercomSyncDebounce, syncIntercomContact } from "@/lib/intercom/sync";
import {
  INTERCOM_CONTACT_SYNC_ENTRY,
  INTERCOM_MESSENGER_ENTRY,
  INTERCOM_SYNC_NEWS_SENTENCE,
  intercomPrivacyEntry,
} from "@/lib/intercom/privacy-copy";
import { PRIVACY_INTERCOM_NEWS } from "@/lib/marketing-consent/copy";
import { fakeIntercom, LEARNER } from "../a-intercom-contact-sync/fake-intercom";

const NOW = new Date("2026-10-21T12:00:00Z");
const ENV = ["MEDPRUF_INTERCOM_SYNC_ENABLED", "NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC", "MEDPRUF_INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_REGION"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const n of ENV) { saved[n] = process.env[n]; delete process.env[n]; }
  resetIntercomSyncDebounce();
});
afterEach(() => {
  for (const n of ENV) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});

function on() {
  process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
  process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok-medpruf";
}

describe("mp_marketing_opt_in", () => {
  const attr = (patch: Record<string, unknown>) =>
    buildContactPayload({ ...LEARNER, ...patch }, { now: NOW, lastActiveAt: null }).custom_attributes.mp_marketing_opt_in;

  it("is true only for a recorded opt-in on a proven, not bounced address", () => {
    expect(attr({ marketing_opt_in: true })).toBe(true);
    expect(attr({ marketing_opt_in: false })).toBe(false);
    expect(attr({})).toBe(false);
    expect(attr({ marketing_opt_in: true, email_verified_at: null })).toBe(false);
    expect(attr({ marketing_opt_in: true, email_status: "unverified" })).toBe(false);
    expect(attr({ marketing_opt_in: true, email_status: "bounced" })).toBe(false);
    expect(contactMarketingOptIn({ ...LEARNER, marketing_opt_in: "true" as unknown as boolean })).toBe(false);
  });

  it("recognises a missing consent column, nothing else", () => {
    expect(isMissingConsentColumn({ code: "42703", message: "column users.marketing_opt_in does not exist" })).toBe(true);
    expect(isMissingConsentColumn({ code: "PGRST204", message: "Could not find the 'marketing_opt_in' column" })).toBe(true);
    expect(isMissingConsentColumn({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(false);
    expect(isMissingConsentColumn({ code: "PGRST204", message: "Could not find the 'other' column" })).toBe(false);
    expect(isMissingConsentColumn(null)).toBe(false);
  });
});

describe("consent mirror after a contact CREATE", () => {
  const created = () =>
    fakeIntercom({
      [`GET /contacts/find_by_external_id/${LEARNER.id}`]: [{ status: 404, body: { type: "error.list" } }],
      "POST /contacts": [{ status: 200, body: { id: "c_new" } }],
    });

  it("mirrors once when the new contact belongs to an opted-in learner", async () => {
    on();
    const mirror = vi.fn(async () => "attached");
    const { fetchImpl } = created();
    const r = await syncIntercomContact(LEARNER.id, "register", { now: NOW, fetchImpl, mirror, loadUser: async () => ({ ...LEARNER, marketing_opt_in: true }) });
    expect(r.outcome).toBe("created");
    expect(mirror).toHaveBeenCalledTimes(1);
    expect(mirror).toHaveBeenCalledWith(LEARNER.id);
  });

  it("does not mirror for an update or without an opt-in", async () => {
    on();
    const mirror = vi.fn(async () => "attached");
    const { fetchImpl } = created();
    await syncIntercomContact(LEARNER.id, "register", { now: NOW, fetchImpl, mirror, loadUser: async () => ({ ...LEARNER, marketing_opt_in: false }) });
    resetIntercomSyncDebounce();
    const upd = fakeIntercom({
      [`GET /contacts/find_by_external_id/${LEARNER.id}`]: [{ status: 200, body: { id: "c_old", external_id: LEARNER.id } }],
      "PUT /contacts/c_old": [{ status: 200, body: { id: "c_old" } }],
    });
    await syncIntercomContact(LEARNER.id, "login", { now: NOW, fetchImpl: upd.fetchImpl, mirror, loadUser: async () => ({ ...LEARNER, marketing_opt_in: true }) });
    expect(mirror).not.toHaveBeenCalled();
  });

  it("a failing mirror never fails the sync", async () => {
    on();
    const { fetchImpl } = created();
    const r = await syncIntercomContact(LEARNER.id, "register", {
      now: NOW,
      fetchImpl,
      mirror: async () => { throw new Error("boom"); },
      loadUser: async () => ({ ...LEARNER, marketing_opt_in: true }),
    });
    expect(r.outcome).toBe("created");
  });
});

describe("one Intercom privacy row", () => {
  it("composes messenger, contact sync and marketing consent", () => {
    expect(intercomPrivacyEntry({ messenger: false, sync: false })).toBeNull();
    expect(intercomPrivacyEntry({ messenger: true, sync: false })).toEqual(INTERCOM_MESSENGER_ENTRY);
    expect(intercomPrivacyEntry({ messenger: true, sync: true })).toEqual(INTERCOM_CONTACT_SYNC_ENTRY);
    const syncNews = intercomPrivacyEntry({ messenger: true, sync: true, news: true })!;
    expect(syncNews.purpose.de).toBe(`${INTERCOM_CONTACT_SYNC_ENTRY.purpose.de} ${INTERCOM_SYNC_NEWS_SENTENCE.de}`);
    expect(syncNews.purpose.en).toBe(`${INTERCOM_CONTACT_SYNC_ENTRY.purpose.en} ${INTERCOM_SYNC_NEWS_SENTENCE.en}`);
    expect(syncNews.jurisdiction).toEqual(INTERCOM_CONTACT_SYNC_ENTRY.jurisdiction);
    expect(intercomPrivacyEntry({ messenger: true, sync: false, news: true })!.purpose).toEqual(PRIVACY_INTERCOM_NEWS.purpose);
    expect(intercomPrivacyEntry({ messenger: false, sync: false, news: true })!.purpose).toEqual(PRIVACY_INTERCOM_NEWS.purposeNoChat);
  });

  it("the added sentence has no dashes and uses Sie", () => {
    for (const t of [INTERCOM_SYNC_NEWS_SENTENCE.de, INTERCOM_SYNC_NEWS_SENTENCE.en]) expect(t).not.toMatch(/[–—]/);
    expect(INTERCOM_SYNC_NEWS_SENTENCE.de).toMatch(/\bSie\b/);
    expect(INTERCOM_SYNC_NEWS_SENTENCE.de).not.toMatch(/\b(du|dir|dein)\b/i);
  });
});
