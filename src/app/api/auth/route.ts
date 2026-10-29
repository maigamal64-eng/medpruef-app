import { NextRequest, NextResponse } from "next/server";
import { validateLoginWidget, verifyInitData } from "@/lib/telegram";
import { getServiceClient } from "@/lib/supabase";
import { sendRedditConversion } from "@/lib/reddit-capi";
import { attributionForEvent, sanitizeAttribution } from "@/lib/attribution";
import bcrypt from "bcryptjs";
import {
  checkRateLimit,
  callerIdentity,
  rateKey,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { signSession } from "@/lib/session";
import { emailConfirmEnabled } from "@/lib/email-confirm/flag";
import { requestMailLang, sendConfirmMail, trialCanStart } from "@/lib/email-confirm/server";
import { deriveFirstTouch, initDataStartParam } from "@/lib/first-touch";
import { recordSignup } from "@/lib/first-touch/server";
import { deriveSignupSource } from "@/lib/signup-source";
import { writeSignupSource } from "@/lib/signup-source/server";
import { afterResponse } from "@/lib/after-response";
import { scheduleIntercomContactSync } from "@/lib/intercom/sync";
import { marketingConsentEnabled, parseOptIn, setMarketingConsent } from "@/lib/marketing-consent";
import { mirrorMarketingConsent } from "@/lib/intercom/marketing-subscription";

/** user_activity_log metadata for the signup's first-touch campaign (utm only). */
function withCampaign(attr: ReturnType<typeof sanitizeAttribution>) {
  const campaign = attributionForEvent(attr);
  return campaign ? { attribution: campaign } : {};
}

/**
 * A users row the upsert inserted (not updated): created_at no earlier than
 * this request's start (5 s clock allowance). Used only when the newness
 * lookup failed, so a returning learner is never counted as a signup.
 */
function createdByThisRequest(createdAt: unknown, startedAtMs: number): boolean {
  const t = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  return Number.isFinite(t) && t >= startedAtMs - 5_000;
}

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Rate limits — review-2026-04-24-C-15. The auth endpoint had no
// throttle of any kind, so a brute-force attempt against an 8-char
// bcrypt password was bound only by Vercel's request concurrency.
//
// 10 attempts per minute per identity (header user-id when available,
// else x-forwarded-for IP). The 10 covers a genuine user fat-fingering
// their password three times + the legitimate retry pattern after a
// browser autofill collision; the 11th onward returns 429.
//
// Register has its own bucket so a malicious registration loop doesn't
// burn through the login bucket and lock out a real user.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 60_000 };
const REGISTER_RATE_LIMIT = { limit: 5, windowMs: 60_000 };
// Telegram deep-link token exchange. Historically unthrottled — fine
// when the token only arrived via a bot-issued deep-link URL. The
// mobile-PWA fix (FB-08) also lets a user PASTE the code into the app,
// so the branch is now reachable by hand. A full random UUIDv4 (122
// bits) is not brute-forceable, but a light cap stops paste-field abuse
// / token enumeration attempts cheaply. 20/min/IP is far above any real
// user (who exchanges exactly one token, once).
const TOKEN_EXCHANGE_RATE_LIMIT = { limit: 20, windowMs: 60_000 };

/**
 * /api/auth — the single auth endpoint for MedPrüf (email/password,
 * Telegram Mini App initData, Telegram bot deep-link token).
 *
 * 2026-04-15 audit hardening:
 *   - Removed the initData HMAC bypass that parsed the raw `user`
 *     field when HMAC validation failed (SEC-P0). Previously an
 *     attacker could craft an unsigned initData string with any
 *     telegram_id and get a session.
 *   - Removed the dev-mode [name] backdoor that created a session for
 *     telegram_id 100008 when NODE_ENV=development AND no auth was
 *     supplied (BE-P2-020).
 *   - Bumped min password length 6 -> 8 (BE-P2-021).
 *   - Strips password_hash (and other sensitive fields) from every
 *     response (BE-P2-022 / SEC).
 *   - Returns { user, gamification } with a sanitized `user` object.
 *   - Logs every error path with a tag so the structured-logging work
 *     can grep them later.
 */

type PublicUser = {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_id: number | null;
  telegram_username: string | null;
  photo_url: string | null;
  role: "user" | "admin";
  tier: "free" | "pro" | "admin";
  active_exam: string | null;
  language_code: string | null;
  created_at: string | null;
  email_status: "valid" | "bounced" | "unverified" | null;
};

function sanitizeUser(raw: Record<string, unknown> | null): PublicUser | null {
  if (!raw) return null;
  return {
    id: raw.id as string,
    email: (raw.email as string | null) || null,
    first_name: (raw.first_name as string | null) || null,
    last_name: (raw.last_name as string | null) || null,
    telegram_id: (raw.telegram_id as number | null) || null,
    telegram_username: (raw.telegram_username as string | null) || null,
    photo_url: (raw.photo_url as string | null) || null,
    role: ((raw.role as string) || "user") as "user" | "admin",
    tier: ((raw.tier as string) || "free") as "free" | "pro" | "admin",
    active_exam: (raw.active_exam as string | null) || null,
    language_code: (raw.language_code as string | null) || null,
    created_at: (raw.created_at as string | null) || null,
    email_status: (raw.email_status as string | null) as PublicUser["email_status"] || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { initData, widgetData, tokenExchange, emailLogin, emailRegister } = body;
    const botToken = process.env.TELEGRAM_BOT_TOKEN!;
    const sb = getServiceClient();

    // ── EMAIL/PASSWORD LOGIN ──
    if (emailLogin) {
      const { email, password } = emailLogin;
      if (!email || !password) {
        return NextResponse.json(
          { error: "Email and password required" },
          { status: 400 },
        );
      }

      // Rate limit per IP (review-2026-04-24-C-15). Without this, an
      // attacker could enumerate valid emails by brute-forcing the
      // login route — the route returns "Invalid credentials" for
      // both unknown email + wrong password, but timing differs.
      const id = callerIdentity(req);
      const gate = checkRateLimit({
        key: rateKey("auth-login", id),
        ...LOGIN_RATE_LIMIT,
      });
      if (!gate.allowed) {
        return NextResponse.json(
          {
            error: "Too many login attempts. Please wait before trying again.",
            retryAfter: gate.retryAfterSec,
          },
          {
            status: 429,
            headers: rateLimitHeaders(gate, LOGIN_RATE_LIMIT),
          },
        );
      }

      const { data: user, error } = await sb
        .from("users")
        .select("*")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (error || !user) {
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }
      if (!user.password_hash) {
        return NextResponse.json(
          { error: "This account uses Telegram login" },
          { status: 401 },
        );
      }

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
      }

      // Ensure gamification record
      await sb.from("user_gamification").upsert(
        { user_id: user.id },
        { onConflict: "user_id" },
      );
      const { data: gamification } = await sb
        .from("user_gamification")
        .select("*")
        .eq("user_id", user.id)
        .single();

      // Log activity (fire-and-forget; log errors instead of silent drop)
      sb.from("user_activity_log")
        .insert({
          user_id: user.id,
          event_type: "login",
          action: "email_login",
          metadata: { method: "email" },
          ip_address:
            req.headers.get("x-forwarded-for") ||
            req.headers.get("x-real-ip") ||
            "unknown",
          user_agent: req.headers.get("user-agent") || "unknown",
        })
        .then(({ error: logErr }) => {
          if (logErr) console.error("[auth] activity insert:", logErr);
        });

      // Mint a server-signed session token. This is the credential the
    // client sends back on `x-session-token`; `requireUser` verifies the
    // signature, so a forged `x-user-id` can no longer authenticate (S-1).
    scheduleIntercomContactSync(user.id as string, "login");
    return NextResponse.json({
      user: sanitizeUser(user),
      gamification,
      sessionToken: signSession(user.id as string),
    });
    }

    // ── EMAIL/PASSWORD REGISTER ──
    if (emailRegister) {
      const { email, password, firstName, lastName, attribution, marketingOptIn } = emailRegister;
      const attr = sanitizeAttribution(attribution);
      if (!email || !password || !firstName) {
        return NextResponse.json(
          { error: "Email, password, and name required" },
          { status: 400 },
        );
      }
      // Bumped from 6 -> 8 per BE-P2-021. NIST recommends 8 minimum.
      if (typeof password !== "string" || password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 },
        );
      }

      // Rate limit per IP — review-2026-04-24-C-15. Stricter than the
      // login bucket because legitimate register attempts are rare
      // (one per real user, ever). 5/min/IP catches automated signups
      // without inconveniencing a person registering one account.
      const id = callerIdentity(req);
      const gate = checkRateLimit({
        key: rateKey("auth-register", id),
        ...REGISTER_RATE_LIMIT,
      });
      if (!gate.allowed) {
        return NextResponse.json(
          {
            error: "Too many registration attempts. Please wait before trying again.",
            retryAfter: gate.retryAfterSec,
          },
          {
            status: 429,
            headers: rateLimitHeaders(gate, REGISTER_RATE_LIMIT),
          },
        );
      }

      // Check if email already exists
      const { data: existing } = await sb
        .from("users")
        .select("*")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        // UX-ONB-13: a register retried after a lost response, with the
        // matching password, is a sign-in rather than "already registered".
        // The 409 already reveals that the address exists, so this adds no
        // enumeration surface; the comparison spends the LOGIN rate-limit
        // bucket, so it never adds password-guessing budget.
        if (existing.password_hash && typeof password === "string") {
          const loginGate = checkRateLimit({ key: rateKey("auth-login", id), ...LOGIN_RATE_LIMIT });
          if (!loginGate.allowed) {
            return NextResponse.json(
              { error: "Too many login attempts. Please wait before trying again.", retryAfter: loginGate.retryAfterSec },
              { status: 429, headers: rateLimitHeaders(loginGate, LOGIN_RATE_LIMIT) },
            );
          }
          if (await bcrypt.compare(password, existing.password_hash)) {
            await sb.from("user_gamification").upsert({ user_id: existing.id }, { onConflict: "user_id" });
            const { data: gamification } = await sb
              .from("user_gamification")
              .select("*")
              .eq("user_id", existing.id)
              .single();
            sb.from("user_activity_log")
              .insert({
                user_id: existing.id,
                event_type: "login",
                action: "email_register_retry",
                metadata: { method: "email" },
                ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown",
                user_agent: req.headers.get("user-agent") || "unknown",
              })
              .then(({ error: logErr }) => {
                if (logErr) console.error("[auth] activity insert:", logErr);
              });
            scheduleIntercomContactSync(existing.id as string, "login");
            return NextResponse.json({
              user: sanitizeUser(existing),
              gamification,
              sessionToken: signSession(existing.id as string),
              existing: true,
            });
          }
        }
        return NextResponse.json(
          { error: "Email already registered" },
          { status: 409 },
        );
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const { data: user, error } = await sb
        .from("users")
        .insert({
          email: email.toLowerCase().trim(),
          password_hash: passwordHash,
          first_name: firstName.trim(),
          last_name: lastName?.trim() || null,
          language_code: "de",
          role: "user",
        })
        .select()
        .single();

      if (error) {
        console.error("[auth] Register error:", error);
        return NextResponse.json({ error: "Registration failed" }, { status: 500 });
      }

      // Create gamification record
      await sb.from("user_gamification").insert({ user_id: user.id });
      const { data: gamification } = await sb
        .from("user_gamification")
        .select("*")
        .eq("user_id", user.id)
        .single();

      sb.from("user_activity_log")
        .insert({
          user_id: user.id,
          event_type: "register",
          action: "email_register",
          metadata: { method: "email", ...(attr ? { attribution: attr } : {}) },
          ip_address:
            req.headers.get("x-forwarded-for") ||
            req.headers.get("x-real-ip") ||
            "unknown",
          user_agent: req.headers.get("user-agent") || "unknown",
        })
        .then(({ error: logErr }) => {
          if (logErr) console.error("[auth] activity insert:", logErr);
        });

      // Tracking only: one user_events row per new signup, carrying its source
      // (a-first-touch: the only writer). Run after the response, kept alive
      // by Next `after`, so neither a Vercel freeze nor a slow database can
      // drop the row or hold the sign-in. Never throws.
      await afterResponse("first-touch", async () => {
        await recordSignup(sb, {
          userId: user.id as string,
          source: "email",
          method: "email",
          attribution: attr,
          firstTouch: deriveFirstTouch({ attribution: attr }),
        });
        // a-signup-source-1029: every new account names a source (SIGNUP_SOURCE_ENABLED).
        await writeSignupSource(sb, user.id as string, deriveSignupSource({
          attribution: attr,
          pendingReferral: body.pendingReferral,
          refHost: body.refHost,
          userAgent: req.headers.get("user-agent"),
        }));
      });

      // a-email-confirm-trial: one confirmation mail with a signed link, sent
      // after the response (EMAIL_CONFIRM_ENABLED, default off: nothing here
      // runs while off). Never a login gate; the free sample stays open.
      if (emailConfirmEnabled()) {
        const created = user as { id: string; email: string; created_at: string | null; role: string | null; tier: string | null; tier_expires_at: string | null };
        const mailLang = requestMailLang(req.headers);
        await afterResponse("email-confirm", async () => {
          await sendConfirmMail(sb, {
            userId: created.id,
            email: created.email,
            lang: mailLang,
            source: "register",
            trial: trialCanStart(created, new Date()),
          });
        });
      }

      // Reddit Conversions API, server-side SignUp (the campaign's conversion
      // goal). Dormant until REDDIT_CAPI_TOKEN is set; deduped against the
      // client pixel SignUp on the user id. Fire-and-forget, never blocks.
      void sendRedditConversion({
        trackingType: "SignUp",
        conversionId: user.id as string,
        externalId: user.id as string,
        email,
        ip:
          req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          req.headers.get("x-real-ip") ||
          null,
        userAgent: req.headers.get("user-agent") || null,
        clickId: attr?.rdt_cid ?? null,
      });

      // a-intercom-marketing-consent: the unticked register checkbox. Only a
      // real `true` while the flag is on records an opt-in, on this fresh
      // insert only (never on the retry sign-in above or a Telegram signup).
      // A failed write leaves the account at the default false and never
      // fails the registration; the learner can opt in from Settings.
      if (marketingConsentEnabled() && parseOptIn(marketingOptIn) === true) {
        const consent = await setMarketingConsent(sb, user.id as string, true, "register").catch(() => null);
        if (consent?.ok && consent.changed) {
          const newUserId = user.id as string;
          await afterResponse("marketing-consent-mirror", async () => {
            await mirrorMarketingConsent(getServiceClient(), newUserId);
          });
        } else {
          console.warn("[auth] register consent not recorded", String(user.id).slice(0, 8));
        }
      }

      // Mint a server-signed session token. This is the credential the
    // client sends back on `x-session-token`; `requireUser` verifies the
    // signature, so a forged `x-user-id` can no longer authenticate (S-1).
    scheduleIntercomContactSync(user.id as string, "register");
    return NextResponse.json({
      user: sanitizeUser(user),
      gamification,
      sessionToken: signSession(user.id as string),
    });
    }

    // ── TELEGRAM AUTH FLOWS ──
    // a-first-touch: the signed start_param of a Mini App launch (initData only).
    let startParam: string | null = null;
    let telegramUser:
      | {
          id: number;
          first_name: string;
          last_name?: string;
          username?: string;
          photo_url?: string;
          language_code?: string;
          is_premium?: boolean;
        }
      | null = null;

    if (initData) {
      // Strict HMAC validation only. The prior fallback that parsed
      // the raw `user` field when validation failed was an auth
      // bypass (SEC P0) — anyone could craft an unsigned initData
      // with any telegram_id.
      // a-tg-miniapp-welcome: initData older than 24 hours is a replay
      // (Telegram signs a fresh one on every launch). The code lets an open
      // Mini App keep its signed session instead of signing the learner out.
      const check = typeof initData === "string" ? verifyInitData(initData, botToken) : ({ ok: false, reason: "invalid" } as const);
      if (!check.ok) {
        return NextResponse.json(
          check.reason === "stale"
            ? { error: "Telegram initData expired", code: "INITDATA_STALE" }
            : { error: "Invalid Telegram initData signature" },
          { status: 401 },
        );
      }
      telegramUser = check.user;
      startParam = initDataStartParam(initData);
    } else if (widgetData) {
      telegramUser = validateLoginWidget(widgetData as Record<string, unknown>, botToken);
      if (!telegramUser) {
        return NextResponse.json(
          { error: "Invalid Telegram widget signature" },
          { status: 401 },
        );
      }
    } else if (tokenExchange) {
      // Rate-limit the exchange (FB-08): the token is now paste-able into
      // the app, not only delivered via a bot-issued URL. Throttle per IP
      // to stop enumeration/abuse of the exchange endpoint.
      const id = callerIdentity(req);
      const gate = checkRateLimit({
        key: rateKey("auth-token-exchange", id),
        ...TOKEN_EXCHANGE_RATE_LIMIT,
      });
      if (!gate.allowed) {
        return NextResponse.json(
          {
            error: "Too many attempts. Please wait before trying again.",
            retryAfter: gate.retryAfterSec,
          },
          {
            status: 429,
            headers: rateLimitHeaders(gate, TOKEN_EXCHANGE_RATE_LIMIT),
          },
        );
      }

      const { data: row, error: e } = await sb
        .from("telegram_login_tokens")
        .select("*")
        .eq("token", tokenExchange)
        .maybeSingle();
      if (e) {
        console.error("[auth] Token lookup error:", e);
        return NextResponse.json({ error: "Token lookup failed" }, { status: 500 });
      }
      if (!row) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
      if (row.used_at)
        return NextResponse.json({ error: "Token already used" }, { status: 401 });
      if (new Date(row.expires_at).getTime() < Date.now()) {
        return NextResponse.json({ error: "Token expired" }, { status: 401 });
      }
      await sb
        .from("telegram_login_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("token", tokenExchange);
      telegramUser = {
        id: Number(row.telegram_id),
        first_name: row.first_name || "User",
        last_name: row.last_name || undefined,
        username: row.username || undefined,
        photo_url: row.photo_url || undefined,
        language_code: row.language_code || "de",
      };
    }

    if (!telegramUser) {
      return NextResponse.json({ error: "Invalid auth" }, { status: 401 });
    }

    // Tracking only: is this the first time we see this telegram_id? The
    // upsert below cannot tell insert from update, so look first. A failed
    // lookup (error result or throw) is decided after the upsert from the
    // row's created_at instead (a-first-touch); auth is unaffected.
    const authStartedAt = Date.now();
    let isNewTelegramUser = false;
    let lookupFailed = false;
    try {
      const { data: existing, error: lookupErr } = await sb
        .from("users")
        .select("id")
        .eq("telegram_id", telegramUser.id)
        .maybeSingle();
      if (lookupErr) lookupFailed = true;
      else isNewTelegramUser = !existing;
    } catch {
      lookupFailed = true;
    }

    // Upsert Telegram user
    const { data: user, error } = await sb
      .from("users")
      .upsert(
        {
          telegram_id: telegramUser.id,
          first_name: telegramUser.first_name,
          last_name: telegramUser.last_name || null,
          telegram_username: telegramUser.username || null,
          language_code: telegramUser.language_code || "de",
          photo_url: telegramUser.photo_url || null,
          is_premium: telegramUser.is_premium || false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "telegram_id" },
      )
      .select()
      .single();

    if (error) {
      console.error("[auth] Upsert error:", error);
      return NextResponse.json({ error: "DB error" }, { status: 500 });
    }
    if (lookupFailed) isNewTelegramUser = createdByThisRequest(user?.created_at, authStartedAt);

    await sb
      .from("user_gamification")
      .upsert({ user_id: user.id }, { onConflict: "user_id" });
    const { data: gamification } = await sb
      .from("user_gamification")
      .select("*")
      .eq("user_id", user.id)
      .single();

    sb.from("user_activity_log")
      .insert({
        user_id: user.id,
        event_type: isNewTelegramUser ? "register" : "login",
        action: isNewTelegramUser ? "telegram_register" : "telegram_login",
        metadata: {
          method: tokenExchange ? "bot_deeplink" : widgetData ? "widget" : "miniapp",
          // Signup campaign also kept here (utm only), so a Telegram signup
          // stays attributed while analytics writes are switched off.
          ...(isNewTelegramUser ? { source: "telegram", ...withCampaign(sanitizeAttribution(body.attribution)) } : {}),
        },
        ip_address:
          req.headers.get("x-forwarded-for") ||
          req.headers.get("x-real-ip") ||
          "unknown",
        user_agent: req.headers.get("user-agent") || "unknown",
      })
      .then(({ error: logErr }) => {
        if (logErr) console.error("[auth] activity insert:", logErr);
      });

    if (isNewTelegramUser) {
      // First-touch campaign the browser stored before the Telegram sign-in
      // (a20, OW-46): a tagged Telegram post or bot start code. a-first-touch:
      // also the signed Mini App start_param and the /tg-welcome hint.
      // After the response (a used bot token cannot be retried if the reply is slow).
      const tgAttr = sanitizeAttribution(body.attribution);
      const method = tokenExchange ? "bot_deeplink" : widgetData ? "widget" : "miniapp";
      const firstTouch = deriveFirstTouch({ attribution: tgAttr, startParam, hint: body.firstTouch });
      await afterResponse("first-touch", async () => {
        await recordSignup(sb, { userId: user.id as string, source: "telegram", method, attribution: tgAttr, firstTouch });
        // a-signup-source-1029: every new account names a source (SIGNUP_SOURCE_ENABLED).
        await writeSignupSource(sb, user.id as string, deriveSignupSource({
          attribution: tgAttr,
          pendingReferral: body.pendingReferral,
          startParam,
          hint: body.firstTouch,
          telegramMethod: method,
          refHost: body.refHost,
          userAgent: req.headers.get("user-agent"),
        }));
      });
    }

    // Mint a server-signed session token. This is the credential the
    // client sends back on `x-session-token`; `requireUser` verifies the
    // signature, so a forged `x-user-id` can no longer authenticate (S-1).
    scheduleIntercomContactSync(user.id as string, isNewTelegramUser ? "register" : "login");
    return NextResponse.json({
      user: sanitizeUser(user),
      gamification,
      sessionToken: signSession(user.id as string),
    });
  } catch (e: unknown) {
    console.error("[auth] top-level error:", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
