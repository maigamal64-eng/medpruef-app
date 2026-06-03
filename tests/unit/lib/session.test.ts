import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  signSession,
  verifySession,
  SESSION_MAX_AGE_MS,
} from "@/lib/session";

/**
 * Unit tests for the S-1 signed-session core (src/lib/session.ts).
 *
 * The whole point of S-1 is that knowing a user's UUID is useless
 * without the server secret. These tests pin that contract: a token is
 * only valid if it was minted with the live secret, isn't tampered, and
 * isn't expired. vitest doesn't load .env.local, so we set the secret
 * explicitly (the module reads process.env at call time).
 */

const SECRET = "[secret]";
const REAL_USER = "11111111-1111-4111-8111-111111111111";
// An arbitrary UUID an attacker might know or guess. NOT a real id — the
// whole point of S-1 is that knowing ANY UUID is useless without the
// server secret, so we must not hardcode the real admin UUID here either.
const ATTACKER_KNOWN_UUID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  process.env.SESSION_SIGNING_SECRET = SECRET;
});
afterEach(() => {
  process.env.SESSION_SIGNING_SECRET = SECRET;
});

describe("signSession / verifySession", () => {
  it("round-trips a freshly minted token", () => {
    const token = signSession(REAL_USER);
    const verified = verifySession(token);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe(REAL_USER);
    expect(verified!.issuedAtMs).toBeGreaterThan(0);
    // issuedAt should be ~now (within the last few seconds)
    expect(Date.now() - verified!.issuedAtMs).toBeLessThan(5000);
  });

  it("rejects a token whose signature was tampered", () => {
    const token = signSession(REAL_USER);
    // Flip the final character of the signature segment.
    const flipped =
      token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(verifySession(flipped)).toBeNull();
  });

  it("rejects a token whose userId was swapped (signature no longer matches)", () => {
    const token = signSession(REAL_USER);
    const parts = token.split(".");
    // Keep version + issuedAt + signature, swap in the admin UUID.
    const forged = `${parts[0]}.${ATTACKER_KNOWN_UUID}.${parts[2]}.${parts[3]}`;
    expect(verifySession(forged)).toBeNull();
  });

  it("THE S-1 PROPERTY: knowing a UUID can't forge a token without the secret", () => {
    // Attacker knows the admin UUID and the token format, but not the
    // secret. Any signature they fabricate must fail verification.
    const fabricated = `mp1.${ATTACKER_KNOWN_UUID}.${Date.now()}.${Buffer.from(
      "attacker-guessed-signature",
    ).toString("base64url")}`;
    expect(verifySession(fabricated)).toBeNull();
  });

  it("rejects a token minted under a different secret", () => {
    const token = signSession(REAL_USER);
    process.env.SESSION_SIGNING_SECRET = "a-totally-different-secret-value";
    expect(verifySession(token)).toBeNull();
  });

  it("rejects an expired token (issuedAt older than max age)", () => {
    const old = Date.now() - SESSION_MAX_AGE_MS - 60_000;
    const token = signSession(REAL_USER, old);
    expect(verifySession(token)).toBeNull();
  });

  it("accepts a token right at the edge of the validity window", () => {
    const justInside = Date.now() - SESSION_MAX_AGE_MS + 60_000;
    const token = signSession(REAL_USER, justInside);
    expect(verifySession(token)).not.toBeNull();
  });

  it("rejects malformed / missing tokens", () => {
    expect(verifySession(null)).toBeNull();
    expect(verifySession(undefined)).toBeNull();
    expect(verifySession("")).toBeNull();
    expect(verifySession("garbage")).toBeNull();
    expect(verifySession("a.b.c")).toBeNull(); // 3 parts
    expect(verifySession(`v9.${REAL_USER}.${Date.now()}.sig`)).toBeNull(); // bad version
    expect(verifySession(`mp1.not-a-uuid.${Date.now()}.sig`)).toBeNull(); // bad userId
    expect(verifySession(`mp1.${REAL_USER}.notanumber.sig`)).toBeNull(); // bad issuedAt
  });

  it("fails closed when the secret is unset (verify denies, sign throws)", () => {
    const token = signSession(REAL_USER); // minted while secret is set
    delete process.env.SESSION_SIGNING_SECRET;
    // verify must deny rather than throw or accept
    expect(verifySession(token)).toBeNull();
    // sign must throw loudly rather than emit an unverifiable token
    expect(() => signSession(REAL_USER)).toThrow();
  });

  it("signSession rejects a non-UUID userId", () => {
    expect(() => signSession("not-a-uuid")).toThrow();
  });
});
