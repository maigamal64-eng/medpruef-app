/**
 * a-intercom-contact-sync: /api/intercom/identify signs the old payload and
 * reads no users row while the sync is off; with it on, only a proven
 * address and the name are signed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getServiceClient, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const chain = { select: () => chain, eq: () => chain, maybeSingle };
  return { maybeSingle, getServiceClient: vi.fn(() => ({ from: () => chain })) };
});
vi.mock("@/lib/supabase", () => ({ getServiceClient }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: async () => ({ userId: "u-1", role: "user" }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => ({ allowed: true }) }));

import { POST } from "@/app/api/intercom/identify/route";

const NAMES = ["MEDPRUF_INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_ENABLED", "NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED", "NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID", "MEDPRUF_INTERCOM_MESSENGER_SECRET", "MEDPRUF_INTERCOM_REGION", "MEDPRUF_INTERCOM_SYNC_ENABLED", "NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const n of NAMES) saved[n] = process.env[n];
  Object.assign(process.env, {
    MEDPRUF_INTERCOM_ENABLED: "true",
    NEXT_PUBLIC_MEDPRUF_INTERCOM_ENABLED: "true",
    NEXT_PUBLIC_MEDPRUF_INTERCOM_APP_ID: "x1d573f1",
    MEDPRUF_INTERCOM_MESSENGER_SECRET: "s3cret",
    MEDPRUF_INTERCOM_REGION: "us",
  });
  delete process.env.MEDPRUF_INTERCOM_SYNC_ENABLED;
  delete process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC;
  getServiceClient.mockClear();
  maybeSingle.mockReset();
});
afterEach(() => {
  for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
});

async function payload() {
  const res = await POST(new NextRequest("http://localhost/api/intercom/identify", { method: "POST" }));
  expect(res.status).toBe(200);
  const body = await res.json();
  return JSON.parse(Buffer.from(body.intercom_user_jwt.split(".")[1], "base64url").toString());
}

describe("identify route", () => {
  it("sync off: no users read, payload user_id, iat, exp only", async () => {
    const p = await payload();
    expect(Object.keys(p).sort()).toEqual(["exp", "iat", "user_id"]);
    expect(getServiceClient).not.toHaveBeenCalled();
  });

  it("sync flag on but no token: same as off", async () => {
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    delete process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
    expect(Object.keys(await payload()).sort()).toEqual(["exp", "iat", "user_id"]);
    expect(getServiceClient).not.toHaveBeenCalled();
  });

  it("sync on: signs a proven address and the name", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok";
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    maybeSingle.mockResolvedValue({ data: { id: "u-1", email: "user-65abd062@example.com", first_name: "Ana", last_name: "B", email_verified_at: "2026-10-01T00:00:00Z", email_status: "valid" }, error: null });
    expect(await payload()).toMatchObject({ user_id: "u-1", email: "user-65abd062@example.com", name: "Ana B" });
  });

  it("sync on: an unproven address is not signed", async () => {
    process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok";
    process.env.MEDPRUF_INTERCOM_SYNC_ENABLED = "true";
    process.env.NEXT_PUBLIC_MEDPRUF_INTERCOM_SYNC = "true";
    maybeSingle.mockResolvedValue({ data: { id: "u-1", email: "user-a280e8aa@example.com", first_name: "X", last_name: null, email_verified_at: null, email_status: "unverified" }, error: null });
    const p = await payload();
    expect(p).not.toHaveProperty("email");
    expect(p.name).toBe("X");
  });
});
