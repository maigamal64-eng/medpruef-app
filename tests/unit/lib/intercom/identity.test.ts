import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { intercomApiBase, signIntercomIdentity } from "@/lib/intercom-identity";

describe("Intercom Messenger identity", () => {
  it("signs only the supplied server identity with a five-minute HS256 expiry", () => {
    const token = signIntercomIdentity("verified-user", "test-secret", 1000);
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ user_id: "verified-user", iat: 1000, exp: 1300 });
    expect(signature).toBe(createHmac("sha256", "test-secret").update(`${header}.${payload}`).digest("base64url"));
    expect(token).not.toContain("test-secret");
  });
  it("rejects missing configuration and unknown regions", () => {
    expect(() => signIntercomIdentity("user", "")).toThrow();
    expect(intercomApiBase("eu")).toBe("https://api-iam.eu.intercom.io");
    expect(intercomApiBase("invalid")).toBeNull();
  });
});
