import { describe, it, expect } from "vitest";
import { __sanitizeUserForStorageForTests as sanitize } from "@/lib/auth";

/**
 * Regression test for the §1.5 password-hash leak.
 *
 * The prod UX tour (2026-04-24) found that
 * `JSON.parse(localStorage.medpruef_session).user.password_hash` was a
 * bcrypt hash. Every script on a medpruef.com page could read it.
 *
 * Fix: `storeSession` now passes the user blob through
 * `sanitizeUserForStorage`, which whitelists safe fields and drops
 * everything else. This test asserts the contract — if anyone adds a
 * new password_* field or copies the raw row through, this fails.
 */

describe("sanitizeUserForStorage", () => {
  it("drops password_hash + password_salt + every password_* field", () => {
    const raw = {
      id: "u1",
      email: "x@example.com",
      first_name: "Alice",
      password_hash: "$2a$10$abc",
      password_salt: "saltyboi",
      password_changed_at: "2024-01-01",
      password_reset_token: "secret",
    };
    const safe = sanitize(raw);
    const json = JSON.stringify(safe);
    expect(safe.password_hash).toBeUndefined();
    expect(safe.password_salt).toBeUndefined();
    expect(safe.password_changed_at).toBeUndefined();
    expect(safe.password_reset_token).toBeUndefined();
    expect(json).not.toContain("password_hash");
    expect(json).not.toContain("password_salt");
    expect(json).not.toContain("password_changed_at");
    expect(json).not.toContain("password_reset_token");
    expect(json).not.toContain("$2a$");
    expect(json).not.toContain("saltyboi");
  });

  it("drops server-only state flags (is_banned, is_locked)", () => {
    const safe = sanitize({
      id: "u1",
      email: "x@example.com",
      is_banned: true,
      is_locked: true,
    });
    expect(safe.is_banned).toBeUndefined();
    expect(safe.is_locked).toBeUndefined();
  });

  it("keeps the public whitelist fields (id, email, role, tier, etc.)", () => {
    const raw = {
      id: "u1",
      email: "x@example.com",
      first_name: "Alice",
      last_name: "Mustermann",
      photo_url: "https://example.com/me.jpg",
      role: "user",
      tier: "pro",
      tier_expires_at: "2027-01-01T00:00:00Z",
      language_code: "de",
      active_exam: "kenntnispruefung",
      xp_total: 1234,
      streak_count: 5,
      longest_streak: 12,
      level: 3,
      daily_goal: 20,
      exam_date: "2026-06-26",
      last_active_date: "2026-04-24",
      referral_code: "ABCD1234",
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-24T00:00:00Z",
      telegram_id: 12345,
      telegram_username: "alice",
      email_status: "valid",
    };
    const safe = sanitize(raw);
    expect(safe.id).toBe("u1");
    expect(safe.email).toBe("x@example.com");
    expect(safe.role).toBe("user");
    expect(safe.tier).toBe("pro");
    expect(safe.referral_code).toBe("ABCD1234");
    expect(safe.exam_date).toBe("2026-06-26");
    expect(safe.telegram_id).toBe(12345);
  });

  it("drops unknown / future fields not in the whitelist", () => {
    const safe = sanitize({
      id: "u1",
      // Fictional internal field — anything not whitelisted must drop.
      internal_admin_notes: "secret stuff",
      raw_db_row: { foo: "bar" },
    });
    expect(safe.internal_admin_notes).toBeUndefined();
    expect(safe.raw_db_row).toBeUndefined();
  });

  it("returns an empty object for null/undefined", () => {
    expect(sanitize(null)).toEqual({});
    expect(sanitize(undefined)).toEqual({});
  });

  it("a fully-stringified safe blob never contains '$2a$' or 'password_'", () => {
    // Full belt-and-braces: even if the source row has every imaginable
    // password-related field, the JSON of the sanitised blob is clean.
    const raw = {
      id: "u1",
      email: "x@example.com",
      role: "admin",
      tier: "admin",
      password_hash: "$2a$10$VeryBadIfThisLeaks/abcdefg",
      password_salt: "salty",
      password_history: ["$2a$10$old1", "$2a$10$old2"],
      password_last_changed: "2024-01-01",
    };
    const json = JSON.stringify(sanitize(raw));
    expect(json).not.toContain("$2a$");
    expect(json).not.toMatch(/password_/);
  });
});
