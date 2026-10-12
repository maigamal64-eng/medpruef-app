import { describe, expect, it } from "vitest";
import { DataResponseError } from "@/lib/async-data";
import { describeReadFailure } from "@/lib/read-failure";
import { sanitizeEventData } from "@/lib/analytics-events";
import { HOME_CTA_SLOTS } from "@/lib/home-events";
import { readFileSync } from "node:fs";

describe("error_state_shown carries the real class, HTTP status and error name (issue 5)", () => {
  it("a page timeout is a timeout, never malformed", () => {
    expect(describeReadFailure(new DOMException("Request timed out", "TimeoutError"))).toEqual({ status: "none", reason: "timeout:TimeoutError" });
  });
  it("a 500 keeps its status", () => {
    expect(describeReadFailure(new DataResponseError(500))).toEqual({ status: 500, reason: "server:Error" });
  });
  it("only a body that failed validation is malformed", () => {
    expect(describeReadFailure(new DataResponseError(502, true)).reason).toBe("malformed:Error");
    expect(describeReadFailure(new SyntaxError("Unexpected token <")).reason).toBe("network:SyntaxError");
  });
  it("network and offline", () => {
    expect(describeReadFailure(new TypeError("Failed to fetch")).reason).toBe("network:TypeError");
    expect(describeReadFailure(new TypeError("x"), false).reason).toBe("offline:TypeError");
  });
  it("odd throwables get a safe name", () => {
    expect(describeReadFailure("boom").reason).toBe("network:string");
    const e = new Error("x"); e.name = "has spaces and stuff";
    expect(describeReadFailure(e).reason).toBe("network:Unknown");
  });
  it("both keys survive the analytics allowlist", () => {
    const out = sanitizeEventData("error_state_shown", { page: "/study-plan", ...describeReadFailure(new DataResponseError(503)) });
    expect(out).toEqual({ page: "/study-plan", status: 503, reason: "server:Error" });
  });
});

describe("Home topics failure keeps a working start (issue 5)", () => {
  it("the failed-topics notice links a mixed start that needs no topic list", () => {
    const src = readFileSync("src/app/page.tsx", "utf8");
    const notice = src.slice(src.indexOf('{topicsError && <Alert'), src.indexOf("</Alert>}", src.indexOf('{topicsError && <Alert')));
    expect(notice).toContain('data-testid="home-topics-error-start"');
    expect(notice).toContain('buildQuizHref({ topic: "random", examSource, practiceMode: "unseen" })');
    expect(HOME_CTA_SLOTS).toContain("topics_error_start");
  });
  it("Home topic counts and every learner aggregate read the shared cache", () => {
    for (const f of ["src/app/api/questions/route.ts", "src/app/api/user/topic-progress/route.ts", "src/app/api/user/study-plan/route.ts", "src/app/api/user/readiness/route.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).toContain("getTopicCountsCached");
      expect(s).not.toMatch(/rpc\(\s*['"]get_topic_counts['"]/);
    }
  });
});
