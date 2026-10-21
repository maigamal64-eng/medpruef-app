import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { mirrorSuppressionToIntercom } from "@/lib/mail-suppression/intercom-sync";
import { recordSuppression } from "@/lib/mail-suppression";

let fetchMock: ReturnType<typeof vi.fn>;

function respond(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url}`;
    const r = routes[key];
    if (!r) throw new Error(`unexpected ${key}`);
    return r();
  });
}

beforeEach(() => {
  process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED = "true";
  process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN = "tok_medpruf";
  process.env.INTERCOM_ACCESS_TOKEN = "tok_blink_never_used";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["MEDPRUF_INTERCOM_WEBHOOK_ENABLED", "MEDPRUF_INTERCOM_ACCESS_TOKEN", "INTERCOM_ACCESS_TOKEN", "MEDPRUF_INTERCOM_REGION"]) delete process.env[k];
});

describe("mirrorSuppressionToIntercom", () => {
  it("does nothing while the flag is off or the MedPruef token is missing", async () => {
    delete process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED;
    expect(await mirrorSuppressionToIntercom({ email: "user-0a322b44@example.com", source: "admin" }, fetchMock)).toBe("disabled");
    process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED = "true";
    delete process.env.MEDPRUF_INTERCOM_ACCESS_TOKEN;
    expect(await mirrorSuppressionToIntercom({ email: "user-0a322b44@example.com", source: "admin" }, fetchMock)).toBe("not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never writes back a row that came from Intercom's own global unsubscribe", async () => {
    expect(await mirrorSuppressionToIntercom({ email: "user-0a322b44@example.com", source: "intercom:contact.unsubscribed" }, fetchMock)).toBe("loop_skip");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches by address and unsubscribes every open contact", async () => {
    const f = respond({
      "POST https://api.intercom.io/contacts/search": () =>
        Response.json({ data: [{ id: "c1", unsubscribed_from_emails: false }, { id: "c2", unsubscribed_from_emails: true }] }),
      "PUT https://api.intercom.io/contacts/c1": () => Response.json({ id: "c1" }),
    });
    expect(await mirrorSuppressionToIntercom({ email: " Person@Example.com ", source: "zoho-bounce" }, f)).toBe("updated");
    const [, init] = f.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).query).toEqual({ field: "email", operator: "=", value: "person@example.com" });
    expect((init.headers as Record<string, string>)["Intercom-Version"]).toBe("2.17");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_medpruf");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("reports no contact and already unsubscribed without a write", async () => {
    const none = respond({ "POST https://api.intercom.io/contacts/search": () => Response.json({ data: [] }) });
    expect(await mirrorSuppressionToIntercom({ email: "user-5b69c942@example.com", source: "admin" }, none)).toBe("no_contact");
    const done = respond({ "POST https://api.intercom.io/contacts/search": () => Response.json({ data: [{ id: "c3", unsubscribed_from_emails: true }] }) });
    expect(await mirrorSuppressionToIntercom({ email: "user-5b69c942@example.com", source: "admin" }, done)).toBe("already_unsubscribed");
  });

  it("uses the EU host for an EU workspace and never throws on failure", async () => {
    process.env.MEDPRUF_INTERCOM_REGION = "eu";
    const f = respond({ "PUT https://api.eu.intercom.io/contacts/c4": () => new Response("{}", { status: 500 }) });
    expect(await mirrorSuppressionToIntercom({ email: "user-5b69c942@example.com", source: "admin", contactId: "c4" }, f)).toBe("failed");
    const boom = vi.fn(async () => { throw new TypeError("network"); });
    expect(await mirrorSuppressionToIntercom({ email: "user-5b69c942@example.com", source: "admin" }, boom)).toBe("failed");
  });
});

describe("recordSuppression mirrors every write", () => {
  function db() {
    const calls: FakeCall[] = [];
    const { sb } = createFakeSupabase((c) => {
      calls.push(c);
      return c.table === "rpc:suppress_mail" ? { data: "row-1" } : {};
    });
    return { sb, calls };
  }

  it("PUTs unsubscribed_from_emails when the contact exists, and not at all with the flag off", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Response.json({ data: [{ id: "c5", unsubscribed_from_emails: false }] });
      return Response.json({ id: "c5" });
    });
    const { sb } = db();
    const id = await recordSuppression(sb as never, { email: "learner@example.com", cause: "manual", source: "admin", actor: "admin:1" }, { mirror: "await" });
    expect(id).toBe("row-1");
    expect(fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit).method} ${c[0]}`)).toEqual([
      "POST https://api.intercom.io/contacts/search",
      "PUT https://api.intercom.io/contacts/c5",
    ]);

    fetchMock.mockClear();
    delete process.env.MEDPRUF_INTERCOM_WEBHOOK_ENABLED;
    await recordSuppression(sb as never, { email: "learner@example.com", cause: "manual", source: "admin", actor: "admin:1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failing mirror never fails the suppression", async () => {
    fetchMock.mockImplementation(async () => { throw new TypeError("network"); });
    const { sb } = db();
    await expect(recordSuppression(sb as never, { email: "learner@example.com", cause: "opt_out", scope: "marketing", source: "comms-log", actor: "track-a" })).resolves.toBe("row-1");
  });
});
