import { describe, expect, it } from "vitest";
import { authFailureError, mentorAuthFailure } from "@/app/api/mentor/chat/handler";

describe("a-mentor-reliability R4: auth guard status to mentor reason", () => {
  it("503 (user lookup timed out) is unavailable; every other guard failure is unauthenticated", () => {
    expect(mentorAuthFailure(503)).toEqual({ ok: false, reason: "unavailable" });
    for (const status of [401, 403, 400, 500]) expect(mentorAuthFailure(status)).toEqual({ ok: false, reason: "unauthenticated" });
  });
  it("maps unavailable to a 503 upstream_error with a retry hint and unauthenticated to 401", () => {
    expect(authFailureError("unavailable")).toEqual({ status: 503, body: { error: "upstream_error", retry_after_seconds: 15 } });
    expect(authFailureError("unauthenticated")).toEqual({ status: 401, body: { error: "unauthenticated" } });
  });
});
