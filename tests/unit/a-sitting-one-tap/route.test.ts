import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall, type FakeResult } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ client: vi.fn(), optin: vi.fn(), suppression: vi.fn(), claim: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-limit")>()), checkRateLimit: m.rate }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock("@/lib/reminders/exam-optin", async (orig) => ({ ...(await orig<typeof import("@/lib/reminders/exam-optin")>()), startExamOptIn: m.optin }));
vi.mock("@/lib/mail-suppression", async (orig) => ({ ...(await orig<typeof import("@/lib/mail-suppression")>()), checkSuppression: m.suppression }));
vi.mock("@/lib/trial-claim/server", async (orig) => ({ ...(await orig<typeof import("@/lib/trial-claim/server")>()), claimStatus: m.claim }));

import { handleSittingLinkGet, handleSittingLinkPost, resetSittingLinkMemo } from "@/lib/sitting-link/server";
import { GET } from "@/app/api/sitting-link/route";
import { signSittingToken } from "@/lib/sitting-link/token";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { candidateSittings } from "@/lib/sitting-link/candidates";

const UID = "11111111-2222-4333-8444-555555555555";
const SECRET = "s".repeat(40);
const EMAIL = "user-610e28c1@example.com";
const now = new Date("2026-11-01T10:00:00Z");

type World = { user: Record<string, unknown> | null; userError?: boolean; subs: unknown[]; updateError?: boolean };
const world = (over: Partial<World> = {}): World => ({
  user: { id: UID, email: EMAIL, email_status: null, role: "user", tier: "free", tier_expires_at: null, is_banned: false, active_exam: "kenntnispruefung", exam_date: null, session_invalidated_at: null },
  subs: [],
  ...over,
});

let calls: FakeCall[] = [];
function install(w: World) {
  const fake = createFakeSupabase((c: FakeCall): FakeResult => {
    if (c.table === "users" && c.op === "select") return w.userError ? { error: { message: "timeout" } } : { data: w.user };
    if (c.table === "users" && c.op === "update") return w.updateError ? { error: { message: "x" } } : { data: null };
    if (c.table === "subscriptions") return { data: w.subs };
    return { data: null };
  });
  calls = fake.calls;
  m.client.mockReturnValue(fake.sb);
  return fake.sb;
}

const token = (over: { emailKey?: string | null; issued?: Date } = {}) =>
  signSittingToken({ userId: UID, emailKey: over.emailKey === undefined ? trialEmailKey(EMAIL) : over.emailKey, now: over.issued ?? new Date("2026-10-30T10:00:00Z") });
const get = (t: string, lang = "de", ua = "Mozilla/5.0") => new NextRequest(`https://medpruf.com/api/sitting-link?t=${encodeURIComponent(t)}&lang=${lang}`, { headers: { "user-agent": ua } });
const post = (fields: Record<string, string>) => new NextRequest("https://medpruf.com/api/sitting-link", {
  method: "POST",
  body: new URLSearchParams(fields).toString(),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});
const writes = () => calls.filter((c) => c.op !== "select");
const userWrites = () => calls.filter((c) => c.table === "users" && c.op === "update");
const events = (type: string) => calls.filter((c) => c.table === "user_events" && c.op === "insert" && (c.payload as { event_type: string }).event_type === type).map((c) => (c.payload as { event_data: Record<string, unknown> }).event_data);

beforeEach(() => {
  vi.clearAllMocks();
  resetSittingLinkMemo();
  vi.stubEnv("SITTING_LINK_ENABLED", "true");
  vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", SECRET);
  m.rate.mockReturnValue({ allowed: true });
  m.suppression.mockResolvedValue("clear");
  m.claim.mockResolvedValue({ eligible: true, reason: "eligible", endsAt: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/sitting-link", () => {
  it("off: neutral 404, no database read", async () => {
    vi.stubEnv("SITTING_LINK_ENABLED", "");
    install(world());
    const res = await GET(get(token()));
    expect(res.status).toBe(404);
    expect(m.client).not.toHaveBeenCalled();
  });

  it("shows the choice and writes nothing but the open event", async () => {
    install(world());
    const res = await handleSittingLinkGet(get(token()), now);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await res.text();
    expect(html).toContain('<html lang="de">');
    expect(html).toContain("SIP4a");
    expect(html).toContain("Stichprobentest Innsbruck");
    expect(html).toContain("Einreichungsfrist laut MedUni Wien Merkblatt");
    expect(html).toContain("Anmeldefrist laut i-med");
    expect(html).toContain('value="open"');
    expect(html).not.toMatch(/10\. März 2027/);
    expect(html).not.toMatch(/€|EUR/);
    expect(userWrites()).toHaveLength(0);
    expect(writes().map((c) => c.table)).toEqual(["user_events"]);
    expect(events("sitting_link_open")[0]).toMatchObject({ ua_class: "browser", had_date: false });
  });

  it("counts one open per account in 10 minutes and marks automation", async () => {
    install(world());
    await handleSittingLinkGet(get(token(), "de", "HeadlessChrome"), now);
    await handleSittingLinkGet(get(token()), now);
    expect(events("sitting_link_open")).toEqual([expect.objectContaining({ ua_class: "automation" })]);
  });

  it("marks the saved sitting", async () => {
    install(world({ user: { ...world().user!, exam_date: "2026-11-18" } }));
    const html = await (await handleSittingLinkGet(get(token()), now)).text();
    expect(html).toMatch(/value="kenntnispruefung:2026-11-18" checked/);
  });

  it("refuses forged, expired, revoked, banned and readdressed links", async () => {
    install(world());
    expect((await handleSittingLinkGet(get("sl1.x.y"), now)).status).toBe(400);
    expect((await handleSittingLinkGet(get(signSittingToken({ userId: UID, emailKey: null, days: 1, now: new Date("2026-10-01T00:00:00Z") })), now)).status).toBe(410);
    install(world({ user: { ...world().user!, session_invalidated_at: "2026-10-31T00:00:00Z" } }));
    expect((await handleSittingLinkGet(get(token()), now)).status).toBe(400);
    install(world({ user: { ...world().user!, is_banned: true } }));
    expect((await handleSittingLinkGet(get(token()), now)).status).toBe(400);
    install(world({ user: { ...world().user!, email: "user-80613e77@example.com" } }));
    expect((await handleSittingLinkGet(get(token()), now)).status).toBe(400);
  });

  it("database stall: retry page, 503", async () => {
    install(world({ userError: true }));
    const res = await handleSittingLinkGet(get(token()), now);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it("date-watch freeze: official pages only, no read, no date", async () => {
    vi.stubEnv("DATE_WATCH_FREEZE", "true");
    install(world());
    const html = await (await handleSittingLinkGet(get(token()), now)).text();
    expect(html).toContain("meduniwien.ac.at");
    expect(html).toContain("i-med.ac.at");
    expect(html).not.toMatch(/<form|\b20\d\d\b.*(Jänner|Januar|Februar|November|Dezember)/);
    expect(calls).toHaveLength(0);
  });
});

describe("POST /api/sitting-link", () => {
  it("a day1 token tags the open and the set with source day1_mail (a-day1-sitting-ask)", async () => {
    install(world({ user: { ...world().user!, active_exam: "kmp_innsbruck" } }));
    const day1 = signSittingToken({ userId: UID, emailKey: trialEmailKey(EMAIL), source: "day1", now: new Date("2026-10-30T10:00:00Z") });
    await handleSittingLinkGet(get(day1), now);
    expect(events("sitting_link_open")[0]).toMatchObject({ source: "day1_mail" });
    const choice = candidateSittings("kmp_innsbruck", now)[0].options[0];
    await handleSittingLinkPost(post({ t: day1, choice: choice.id, lang: "de" }), now);
    expect(events("sitting_set")[0]).toMatchObject({ source: "day1_mail", choice: "sitting" });
    expect(userWrites()[0].payload).toEqual({ active_exam: "kmp_innsbruck", exam_date: "2027-02-03" });
  });

  it("saves a sitting through the picker write and reports weeks", async () => {
    install(world({ user: { ...world().user!, active_exam: "kmp_innsbruck" } }));
    const choice = candidateSittings("kmp_innsbruck", now)[0].options[0];
    const res = await handleSittingLinkPost(post({ t: token(), choice: choice.id, lang: "de" }), now);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(userWrites()).toHaveLength(1);
    expect(userWrites()[0].payload).toEqual({ active_exam: "kmp_innsbruck", exam_date: "2027-02-03" });
    expect(userWrites()[0].filters).toEqual([{ kind: "eq", column: "id", value: UID }]);
    expect(html).toContain("Gespeichert: Stichprobentest Innsbruck");
    expect(html).toContain("noch 13 Wochen");
    expect(events("sitting_set")[0]).toMatchObject({ source: "mail_link", choice: "sitting", bank: "kmp_innsbruck", date: "2027-02-03", days_to_sitting: 94, bank_switched: false });
  });

  it("switches the bank when another exam's sitting is chosen", async () => {
    install(world());
    const choice = candidateSittings("kenntnispruefung", now).find((b) => b.bank === "pharma")!.options[0];
    await handleSittingLinkPost(post({ t: token(), choice: choice.id, lang: "en" }), now);
    expect(userWrites()[0].payload).toEqual({ active_exam: "pharma", exam_date: "2026-11-23" });
    expect(events("sitting_set")[0]).toMatchObject({ bank_switched: true });
  });

  it("'noch offen' clears the date and keeps the bank", async () => {
    install(world({ user: { ...world().user!, exam_date: "2026-11-18" } }));
    const html = await (await handleSittingLinkPost(post({ t: token(), choice: "open", lang: "de" }), now)).text();
    expect(userWrites()[0].payload).toEqual({ exam_date: null });
    expect(html).toContain("Ihr Termin ist noch offen");
    expect(html).not.toContain("Tarif");
    expect(events("sitting_set")[0]).toMatchObject({ choice: "open", date: null });
  });

  it("a stale or forged choice writes nothing and asks again", async () => {
    install(world());
    const html = await (await handleSittingLinkPost(post({ t: token(), choice: "kenntnispruefung:2027-03-10", lang: "de" }), now)).text();
    expect(userWrites()).toHaveLength(0);
    expect(html).toContain("nicht mehr auswählbar");
    expect(html).toContain("<form");
  });

  it("a refreshed POST counts once and an oversized body never writes", async () => {
    install(world());
    const sip = candidateSittings("kenntnispruefung", now)[0].options[0];
    await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now);
    await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now);
    expect(events("sitting_set")).toHaveLength(1);
    install(world());
    const big = post({ t: token(), choice: sip.id, lang: "de", pad: "x".repeat(5000) });
    expect((await handleSittingLinkPost(big, now)).status).toBe(400);
    expect(userWrites()).toHaveLength(0);
  });

  it("a GET-shaped or JSON request never writes", async () => {
    install(world());
    const json = new NextRequest("https://medpruf.com/api/sitting-link", { method: "POST", body: JSON.stringify({ t: token(), choice: "open" }), headers: { "content-type": "application/json" } });
    expect((await handleSittingLinkPost(json, now)).status).toBe(400);
    expect(userWrites()).toHaveLength(0);
  });

  it("freeze: no write on POST", async () => {
    vi.stubEnv("DATE_WATCH_FREEZE", "true");
    install(world());
    const choice = candidateSittings("kenntnispruefung", now)[0].options[0];
    await handleSittingLinkPost(post({ t: token(), choice: choice.id, lang: "de" }), now);
    expect(calls).toHaveLength(0);
  });

  it("starts the double opt-in only when asked and for a bank with reminders", async () => {
    install(world());
    m.optin.mockResolvedValue({ ok: true, mail: "sent", view: { available: true, email: EMAIL, exam: "kenntnispruefung", state: "pending" } });
    const sip = candidateSittings("kenntnispruefung", now)[0].options[0];
    const html = await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, reminder: "1", lang: "de" }), now)).text();
    expect(m.optin).toHaveBeenCalledWith(expect.anything(), UID);
    expect(html).toContain("Bestätigungslink geschickt");
    expect(events("reminder_optin_from_link")[0]).toMatchObject({ result: "sent", bank: "kenntnispruefung" });

    vi.clearAllMocks();
    install(world());
    const stp = candidateSittings("kmp_innsbruck", now)[0].options[0];
    const html2 = await (await handleSittingLinkPost(post({ t: token(), choice: stp.id, reminder: "1", lang: "de" }), now)).text();
    expect(m.optin).not.toHaveBeenCalled();
    expect(html2).toContain("Für den Stichprobentest verschicken wir keine Fristerinnerungen");

    vi.clearAllMocks();
    install(world());
    await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now);
    expect(m.optin).not.toHaveBeenCalled();
    expect(events("reminder_optin_from_link")).toHaveLength(0);
  });

  it("offers: none while pricing v2 and the claim are off", async () => {
    install(world());
    const sip = candidateSittings("kenntnispruefung", now)[0].options[0];
    const html = await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now)).text();
    expect(html).not.toMatch(/Tarif|freischalten|€/);
    expect(calls.some((c) => c.table === "subscriptions")).toBe(false);
  });

  describe("with pricing v2 and the claim on", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_PRICING_V2", "true");
      vi.stubEnv("TRIAL_CLAIM_ENABLED", "true");
      vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
      vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
      vi.stubEnv("REVERSE_TRIAL_SINCE", "2026-10-20T10:00:00Z");
    });

    it("never-paid: the fitting plan (price last) and the claim link", async () => {
      // 94 days out the Sitting Pass (at most 3 months) does not reach the sitting: Monthly, 4 charges.
      install(world());
      const stp = candidateSittings("kenntnispruefung", now).find((b) => b.bank === "kmp_innsbruck")!.options[0];
      expect(await (await handleSittingLinkPost(post({ t: token(), choice: stp.id, lang: "de" }), now)).text())
        .toContain("Am günstigsten deckt Ihren Termin dieser Tarif ab: Monatsabo. Bis zu Ihrem Termin insgesamt 96 €.");
      // 86 days out the pass covers it and is cheaper than 3 monthly charges.
      install(world());
      const later = new Date("2026-11-10T10:00:00Z");
      const html = await (await handleSittingLinkPost(post({ t: token(), choice: stp.id, lang: "de" }), later)).text();
      expect(html).toContain("Am günstigsten deckt Ihren Termin dieser Tarif ab: Prüfungspass. Bis zu Ihrem Termin insgesamt 59 €.");
      expect(html).toContain("/pricing?bank=kmp_innsbruck&amp;sitting=2027-02-03&amp;sitting_end=2027-02-03");
      expect(html).toContain("/trial/claim?t=tc1.");
      expect(m.claim).toHaveBeenCalledWith(expect.anything(), UID, expect.objectContaining({ tokenEmailKey: trialEmailKey(EMAIL) }));
      expect(events("sitting_set")[0]).toMatchObject({ offer_fit: true, offer_trial: true });
    });

    it("current payer, do-not-contact and staff see no offer", async () => {
      const sip = candidateSittings("kenntnispruefung", now)[0].options[0];
      install(world({ user: { ...world().user!, tier: "pro", tier_expires_at: "2026-12-01T00:00:00Z" }, subs: [{ tier: "first_month_19", status: "active", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: "2026-12-01T00:00:00Z" }] }));
      expect(await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now)).text()).not.toMatch(/Tarif|freischalten/);
      install(world());
      m.suppression.mockResolvedValue("suppressed");
      expect(await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now)).text()).not.toMatch(/Tarif|freischalten/);
      m.suppression.mockRejectedValue(new Error("down"));
      expect(await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "de" }), now)).text()).not.toMatch(/Tarif|freischalten/);
      m.suppression.mockResolvedValue("clear");
      install(world({ user: { ...world().user!, email: "user-b7e46e80@example.com" } }));
      const staffToken = signSittingToken({ userId: UID, emailKey: trialEmailKey("user-b7e46e80@example.com"), now: new Date("2026-10-30T10:00:00Z") });
      expect(await (await handleSittingLinkPost(post({ t: staffToken, choice: sip.id, lang: "de" }), now)).text()).not.toMatch(/Tarif|freischalten/);
    });

    it("an ineligible claim keeps the plan line only", async () => {
      install(world());
      m.claim.mockResolvedValue({ eligible: false, reason: "trial_used", endsAt: null });
      const sip = candidateSittings("kenntnispruefung", now)[0].options[0];
      const html = await (await handleSittingLinkPost(post({ t: token(), choice: sip.id, lang: "en" }), now)).text();
      expect(html).toContain("The plan that covers your sitting at the lowest cost");
      expect(html).not.toContain("/trial/claim");
    });
  });
});
