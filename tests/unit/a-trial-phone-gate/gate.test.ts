/**
 * a-trial-phone-gate ([name] 17 Oct, decision trial-phone-backed): the 3-day
 * reverse trial and the one-time claim start only with a linked Telegram id,
 * and the link-Telegram path (TELEGRAM_LINK_ENABLED, default off) binds a
 * Telegram to a signed-in email account through a signed bot deep link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFakeSupabase, type FakeCall } from "../helpers/fake-supabase";

const m = vi.hoisted(() => ({ guard: vi.fn(), client: vi.fn(), forget: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/mail-suppression", () => ({ sendUnlessSuppressed: m.send }));
vi.mock("@/lib/auth-guard", () => ({ requireUser: m.guard, forgetGuardUser: m.forget, isGuardFailure: (g: { error?: unknown }) => !!g.error }));
vi.mock("@/lib/supabase", () => ({ getServiceClient: m.client }));
vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { signTelegramLinkToken, verifyTelegramLinkToken, isTelegramLinkParam, TELEGRAM_LINK_TTL_S } from "@/lib/telegram-link/token";
import { telegramLinkEnabled } from "@/lib/telegram-link/flag";
import { bindTelegramFromStart } from "@/lib/telegram-link/server";
import { botLinkReply, telegramLinkCopy } from "@/lib/telegram-link/copy";
import { ensureReverseTrial, resetReverseTrialCache } from "@/lib/pricing-v2/reverse-trial-server";
import { claimEligibility, type ClaimInput } from "@/lib/trial-claim/rules";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/constants";
import { GET as linkGET, POST as linkPOST } from "@/app/api/telegram/link/route";

const SECRET = "a".repeat(40);
const UID = "11111111-2222-4333-8444-555555555555";
const DAY = 86_400_000;
const NOW = new Date("2026-10-21T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  m.send.mockResolvedValue({ ok: true });
  resetReverseTrialCache();
  vi.stubEnv("REMINDER_LINK_SIGNING_SECRET", SECRET);
});
afterEach(() => vi.unstubAllEnvs());

describe("signed deep link", () => {
  it("fits Telegram's start parameter (64 chars of A-Za-z0-9_-) and round-trips", () => {
    const t = signTelegramLinkToken({ userId: UID, now: NOW });
    expect(t).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(t.length).toBe(46);
    expect(isTelegramLinkParam(t)).toBe(true);
    expect(verifyTelegramLinkToken(t, { now: new Date(NOW.getTime() + 60_000) })).toEqual({ ok: true, userId: UID, issuedAt: new Date(Math.floor(NOW.getTime() / 1000) * 1000) });
  });
  it("refuses tampered, expired, future, foreign-key and unconfigured tokens", () => {
    const t = signTelegramLinkToken({ userId: UID, now: NOW });
    const flipped = t.slice(0, 10) + (t[10] === "A" ? "B" : "A") + t.slice(11);
    expect(verifyTelegramLinkToken(flipped, { now: NOW })).toEqual({ ok: false, error: "invalid" });
    expect(verifyTelegramLinkToken(t, { now: new Date(NOW.getTime() + (TELEGRAM_LINK_TTL_S + 1) * 1000) })).toEqual({ ok: false, error: "expired" });
    expect(verifyTelegramLinkToken(t, { now: new Date(NOW.getTime() - 5 * 60_000) })).toEqual({ ok: false, error: "invalid" });
    expect(verifyTelegramLinkToken(t, { now: NOW, env: { REMINDER_LINK_SIGNING_SECRET: "b".repeat(40) } })).toEqual({ ok: false, error: "invalid" });
    expect(verifyTelegramLinkToken(t, { now: NOW, env: {} })).toEqual({ ok: false, error: "unconfigured" });
    expect(verifyTelegramLinkToken(`auth_${UID}`, { now: NOW })).toEqual({ ok: false, error: "invalid" });
    expect(verifyTelegramLinkToken(null, { now: NOW })).toEqual({ ok: false, error: "invalid" });
  });
  it("the flag is off by default, needs the literal true and the signing secret", () => {
    expect(telegramLinkEnabled({})).toBe(false);
    expect(telegramLinkEnabled({ TELEGRAM_LINK_ENABLED: "true" })).toBe(false);
    expect(telegramLinkEnabled({ TELEGRAM_LINK_ENABLED: "1", REMINDER_LINK_SIGNING_SECRET: SECRET })).toBe(false);
    expect(telegramLinkEnabled({ TELEGRAM_LINK_ENABLED: "true", REMINDER_LINK_SIGNING_SECRET: SECRET })).toBe(true);
  });
});

type U = { telegram_id: number | null; is_banned?: boolean; session_invalidated_at?: string | null; role?: string; tier?: string; email?: string | null };
function bindDb(user: U | null, opts: { holder?: boolean; writeError?: { code: string }; writeRows?: number; after?: number | null } = {}) {
  const calls: FakeCall[] = [];
  let reads = 0;
  const f = createFakeSupabase((c) => {
    calls.push(c);
    if (c.table !== "users") return { data: null };
    if (c.op === "update") return opts.writeError ? { error: opts.writeError } : { data: Array.from({ length: opts.writeRows ?? 1 }, () => ({ id: UID })) };
    if (c.filters.some((x) => x.column === "telegram_id")) return { data: opts.holder ? [{ id: "other" }] : [] };
    reads += 1;
    if (reads > 1) return { data: { telegram_id: opts.after ?? null } };
    return { data: user ? { id: UID, is_banned: false, session_invalidated_at: null, role: "user", tier: "free", email: "user-610e28c1@example.com", language_code: "de", ...user } : null };
  });
  return { sb: f.sb, calls };
}

describe("bot binds the Telegram that presses Start", () => {
  const on = () => vi.stubEnv("TELEGRAM_LINK_ENABLED", "true");
  const token = () => signTelegramLinkToken({ userId: UID, now: NOW });
  const run = (db: ReturnType<typeof bindDb>, from = 777) => bindTelegramFromStart(db.sb as never, { token: token(), from: { id: from, username: "doc" }, now: NOW });

  it("off: nothing is read or written", async () => {
    const db = bindDb({ telegram_id: null });
    expect(await run(db)).toBe("off");
    expect(db.calls).toHaveLength(0);
  });
  it("links an email-only account with one compare-and-set on an empty telegram_id", async () => {
    on();
    const db = bindDb({ telegram_id: null });
    expect(await run(db)).toBe("linked");
    const write = db.calls.find((c) => c.op === "update")!;
    expect(write.payload).toMatchObject({ telegram_id: 777, telegram_username: "doc" });
    expect(write.filters).toContainEqual({ kind: "is", column: "telegram_id", value: null });
    expect(db.calls.find((c) => c.table === "user_events")?.payload).toMatchObject({ event_type: "telegram_linked" });
    expect(m.forget).toHaveBeenCalledWith(UID);
    // Reviewer P2: the account's address is told, transactional, in its language.
    expect(m.send).toHaveBeenCalledTimes(1);
    expect(m.send.mock.calls[0][1]).toBe("transactional");
    expect(m.send.mock.calls[0][2]).toMatchObject({ to: "user-610e28c1@example.com", subject: "MedPrüf: Telegram wurde mit Ihrem Konto verknüpft" });
    expect(m.send.mock.calls[0][2].htmlBody).not.toMatch(/[–—]/);
  });
  it("a failed notice never undoes the link", async () => {
    on();
    m.send.mockResolvedValue({ ok: false, reason: "provider_error" });
    expect(await run(bindDb({ telegram_id: null }))).toBe("linked");
  });
  it.each([
    ["the same Telegram again", { telegram_id: 777 }, {}, "already"],
    ["an account that already has another Telegram (never replaced)", { telegram_id: 555 }, {}, "account_has_other"],
    ["a Telegram that another account holds (reused on a new account)", { telegram_id: null }, { holder: true }, "telegram_in_use"],
    ["a race on the users.telegram_id unique index", { telegram_id: null }, { writeError: { code: "23505" } }, "telegram_in_use"],
    ["a banned account", { telegram_id: null, is_banned: true }, {}, "invalid"],
    ["an admin account (no password-free way in)", { telegram_id: null, role: "admin" }, {}, "invalid"],
    ["a staff or test account", { telegram_id: null, email: "user-727b339e@example.com" }, {}, "invalid"],
    ["a token minted in the same second as a revocation", { telegram_id: null, session_invalidated_at: new Date(Math.floor(NOW.getTime() / 1000) * 1000 + 500).toISOString() }, {}, "invalid"],
    ["a token minted before the sessions were revoked", { telegram_id: null, session_invalidated_at: new Date(NOW.getTime() + 60_000).toISOString() }, {}, "invalid"],
    ["a compare-and-set miss where this Telegram landed first", { telegram_id: null }, { writeRows: 0, after: 777 }, "already"],
  ] as const)("refuses or reports: %s", async (_l, user, opts, want) => {
    on();
    const db = bindDb(user as U, opts as never);
    expect(await run(db)).toBe(want);
    if (want !== "already" || !("writeRows" in opts)) expect(db.calls.some((c) => c.op === "update" && want !== "telegram_in_use")).toBe(false);
  });
  it("an unknown account or a forged token writes nothing", async () => {
    on();
    const db = bindDb(null);
    expect(await run(db)).toBe("invalid");
    const forged = await bindTelegramFromStart(bindDb({ telegram_id: null }).sb as never, { token: "lk_" + "A".repeat(43), from: { id: 777 }, now: NOW });
    expect(forged).toBe("invalid");
  });
  it("bot replies are Sie, without dashes, and silent while off", () => {
    expect(botLinkReply("off", "de")).toBeNull();
    for (const r of ["linked", "already", "account_has_other", "telegram_in_use", "expired", "invalid", "error"] as const) {
      expect(botLinkReply(r, "de")).not.toMatch(/[–—]|\bdu\b|\bdein/i);
      expect(botLinkReply(r, "en-US")).not.toMatch(/[–—]/);
    }
    expect(JSON.stringify([telegramLinkCopy("de"), telegramLinkCopy("en")])).not.toMatch(/[–—]/);
    expect(telegramLinkCopy("de").title).toBe("Telegram verbinden, um Ihre 3 Tage Pro zu starten");
    expect(telegramLinkCopy("en").title).toBe("Link Telegram to start your 3-day trial");
    expect(telegramLinkCopy("ar").title).toBe(telegramLinkCopy("en").title);
    expect(REVERSE_TRIAL_DAYS).toBe(3); // the titles and the confirmation mail line say 3
  });
});

describe("eligibility matrix: reverse trial start (new accounts)", () => {
  const cand = { createdAt: new Date(Date.now() - DAY / 2).toISOString(), role: "user", tier: "free", tierExpiresAt: null };
  const trialOn = () => {
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
    vi.stubEnv("REVERSE_TRIAL_SINCE", new Date(Date.now() - 2 * DAY).toISOString());
  };
  const db = (user: Record<string, unknown>, rpc: Record<string, unknown> = { started: true, expires_at: "2026-10-24T10:00:00Z" }) => {
    const calls: FakeCall[] = [];
    const f = createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { email: "n@example.com", email_verified_at: null, telegram_id: null, is_banned: false, ...user } } : c.table === "rpc:start_reverse_trial" ? { data: rpc } : { data: null }; });
    return { sb: f.sb as never, calls };
  };
  const rpcOf = (calls: FakeCall[]) => calls.find((c) => c.table === "rpc:start_reverse_trial")?.payload as Record<string, unknown> | undefined;

  it("email-only (unconfirmed): no trial, no database call, the link prompt state", async () => {
    trialOn();
    const d = db({});
    expect(await ensureReverseTrial(d.sb, { userId: "a1", candidate: cand, headers: new Headers() })).toMatchObject({ active: false, needsTelegram: true });
    expect(rpcOf(d.calls)).toBeUndefined();
  });
  it("email-only (confirmed): still no trial (fresh email accounts every 3 days were the abuse)", async () => {
    trialOn();
    const d = db({ email_verified_at: new Date().toISOString() });
    expect(await ensureReverseTrial(d.sb, { userId: "a2", candidate: cand, headers: new Headers() })).toMatchObject({ active: false, needsTelegram: true });
    expect(rpcOf(d.calls)).toBeUndefined();
  });
  it("Telegram-linked: starts, sends the Telegram id and (when confirmed) the address key", async () => {
    trialOn();
    const d = db({ telegram_id: 4242, email_verified_at: new Date().toISOString() });
    expect(await ensureReverseTrial(d.sb, { userId: "a3", candidate: cand, headers: new Headers({ "x-forwarded-for": "9.9.9.9" }) })).toMatchObject({ active: true, started: true });
    const rpc = rpcOf(d.calls)!;
    expect(rpc.p_telegram_id).toBe(4242);
    expect(String(rpc.p_email_key)).toMatch(/^[0-9a-f]{64}$/);
    expect(rpc.p_max_per_ip).toBe(3);
  });
  it.each([
    ["Telegram id reused on a new account (trials telegram_id wall)", "telegram_used"],
    ["Telegram id of a deleted account (its trials row keeps the id)", "telegram_used"],
    ["network cap (3 per 24 h)", "ip_limit"],
    ["address already used", "email_used"],
  ])("the database refuses: %s, and the prompt does not come back", async (_l, reason) => {
    trialOn();
    const d = db({ telegram_id: 4242 }, { started: false, reason });
    const r = await ensureReverseTrial(d.sb, { userId: "a4", candidate: cand, headers: new Headers() });
    expect(r).toEqual({ active: false, endsAt: null, started: false });
  });
  it("fresh (after the bot linked on another instance) skips this instance's remembered no", async () => {
    trialOn();
    const first = db({});
    expect(await ensureReverseTrial(first.sb, { userId: "a5", candidate: cand, headers: new Headers() })).toMatchObject({ needsTelegram: true });
    const linked = db({ telegram_id: 4242 });
    expect(await ensureReverseTrial(linked.sb, { userId: "a5", candidate: cand, headers: new Headers() })).toMatchObject({ needsTelegram: true });
    expect(linked.calls).toHaveLength(0);
    expect(await ensureReverseTrial(linked.sb, { userId: "a5", candidate: cand, headers: new Headers(), fresh: true })).toMatchObject({ active: true });
  });
});

describe("eligibility matrix: one-time claim (older accounts)", () => {
  const since = new Date("2026-10-20T10:00:00Z");
  const base = (o: Partial<ClaimInput> = {}): ClaimInput => ({
    user: { role: "user", tier: "free", tierExpiresAt: null, createdAt: "2026-08-01T00:00:00Z", isBanned: false },
    subs: [], ownTrial: null, identityUsed: false, verified: true, telegramLinked: true, since, now: NOW, ...o,
  });
  it.each([
    ["Telegram-linked", base(), { eligible: true, reason: "eligible" }],
    ["email-only, confirmed", base({ telegramLinked: false }), { eligible: false, reason: "telegram_required" }],
    ["email-only, unconfirmed", base({ telegramLinked: false, verified: false }), { eligible: false, reason: "telegram_required" }],
    ["Telegram id used by another or a deleted account", base({ identityUsed: true }), { eligible: false, reason: "trial_used" }],
    ["a payer without Telegram keeps the payer reason", base({ telegramLinked: false, subs: [{ tier: "first_month_19", status: "expired", payment_provider: "whop", amount_cents: 1900, provider_payment_id: "pay_1", expires_at: null } as never] }), { eligible: false, reason: "paid" }],
  ])("%s", (_l, input, want) => {
    expect(claimEligibility(input)).toEqual(want);
  });
});

describe("/api/telegram/link", () => {
  const post = () => new NextRequest("https://medpruf.com/api/telegram/link", { method: "POST", body: "{}" });
  const get = () => new NextRequest("https://medpruf.com/api/telegram/link", { headers: { "x-forwarded-for": "8.8.8.8" } });
  beforeEach(() => m.guard.mockResolvedValue({ userId: UID }));

  it("off: 404 for the mint and enabled:false for the status, no session or database read", async () => {
    expect((await linkPOST(post())).status).toBe(404);
    expect(await (await linkGET(get())).json()).toEqual({ enabled: false });
    expect(m.guard).not.toHaveBeenCalled();
  });
  it("mints a 15-minute bot link for an account without Telegram; 409 once linked", async () => {
    vi.stubEnv("TELEGRAM_LINK_ENABLED", "true");
    m.client.mockReturnValue(createFakeSupabase(() => ({ data: { telegram_id: null } })).sb);
    const d = await (await linkPOST(post())).json();
    expect(d.url).toMatch(/^https:\/\/t\.me\/MedPruefBot\?start=lk_[A-Za-z0-9_-]{43}$/);
    const tok = verifyTelegramLinkToken(new URL(d.url).searchParams.get("start"));
    expect(tok).toMatchObject({ ok: true, userId: UID });
    m.client.mockReturnValue(createFakeSupabase(() => ({ data: { telegram_id: 777 } })).sb);
    expect((await linkPOST(post())).status).toBe(409);
    m.client.mockReturnValue(createFakeSupabase(() => ({ data: { telegram_id: null, role: "admin", tier: "admin", email: "user-360bb8f2@example.com" } })).sb);
    expect((await linkPOST(post())).status).toBe(403);
  });
  it("status: not linked starts nothing; linked starts the trial from the learner's request", async () => {
    vi.stubEnv("TELEGRAM_LINK_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_REVERSE_TRIAL", "true");
    vi.stubEnv("REVERSE_TRIAL_ENABLED", "true");
    vi.stubEnv("REVERSE_TRIAL_SINCE", new Date(Date.now() - 2 * DAY).toISOString());
    const row = { created_at: new Date(Date.now() - DAY / 2).toISOString(), role: "user", tier: "free", tier_expires_at: null, email: "n@example.com", email_verified_at: null, is_banned: false };
    const calls: FakeCall[] = [];
    m.client.mockReturnValue(createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { ...row, telegram_id: null } } : { data: null }; }).sb);
    expect(await (await linkGET(get())).json()).toEqual({ enabled: true, linked: false });
    expect(calls.some((c) => c.table.startsWith("rpc:"))).toBe(false);

    calls.length = 0;
    m.client.mockReturnValue(createFakeSupabase((c) => { calls.push(c); return c.table === "users" ? { data: { ...row, telegram_id: 4242 } } : c.table === "rpc:start_reverse_trial" ? { data: { started: true, expires_at: "2026-10-24T10:00:00Z" } } : { data: null }; }).sb);
    expect(await (await linkGET(get())).json()).toEqual({ enabled: true, linked: true, trial: { ends_at: "2026-10-24T10:00:00Z", started: true } });
    const rpc = calls.find((c) => c.table === "rpc:start_reverse_trial")!.payload as Record<string, unknown>;
    expect(rpc.p_telegram_id).toBe(4242);
    expect(String(rpc.p_ip_hash ?? "")).not.toContain("8.8.8.8");
  });
});
