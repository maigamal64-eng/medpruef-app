import { describe, expect, it } from "vitest";
import {
  FIRST_TOUCH_KEY_RE,
  deriveFirstTouch,
  firstTouchEnabled,
  firstTouchFromAttribution,
  firstTouchFromHint,
  firstTouchFromStartParam,
  initDataStartParam,
  leverOf,
  parseWebLoginCampaign,
  touchSlug,
  webLoginPayload,
} from "@/lib/first-touch";
import { isAllowedEvent } from "@/lib/analytics-events";

describe("flag", () => {
  it("only the literal true", () => {
    expect(firstTouchEnabled({})).toBe(false);
    expect(firstTouchEnabled({ FIRST_TOUCH_ENABLED: "1" })).toBe(false);
    expect(firstTouchEnabled({ FIRST_TOUCH_ENABLED: "TRUE" })).toBe(false);
    expect(firstTouchEnabled({ FIRST_TOUCH_ENABLED: "true" })).toBe(true);
  });
});

describe("keys from the stored browser first touch", () => {
  it("organic arrival keys pass through only in ARRIVAL_CAMPAIGN_RE shape", () => {
    for (const k of ["lernplan", "selbsttest", "blog:sip-anmeldung", "sitting:sip4a-2027-02-19", "gratis:wien26"]) {
      expect(firstTouchFromAttribution({ utm_source: "arrival", utm_medium: "organic", utm_campaign: k })).toEqual({ key: k, basis: "arrival" });
    }
    expect(firstTouchFromAttribution({ utm_source: "arrival", utm_campaign: "evil:payload" })).toBeNull();
    expect(firstTouchFromAttribution({ utm_source: "arrival", utm_campaign: "https://x.example/ref" })).toBeNull();
  });
  it("a typed code becomes code:<code>", () => {
    expect(firstTouchFromAttribution({ utm_source: "code", utm_medium: "typed", utm_campaign: "wien26" })).toEqual({ key: "code:wien26", basis: "code" });
  });
  it("Telegram posts and bot starts keep their slug", () => {
    expect(firstTouchFromAttribution({ utm_source: "telegram", utm_medium: "post", utm_campaign: "fristen-17-okt" })?.key).toBe("tg_post:fristen-17-okt");
    expect(firstTouchFromAttribution({ utm_source: "telegram", utm_medium: "bot", utm_campaign: "fristen-17-okt" })?.key).toBe("tg_start:fristen-17-okt");
  });
  it("any other campaign link is utm:<source>, slugged and capped", () => {
    expect(firstTouchFromAttribution({ utm_source: "Reddit Ads", utm_campaign: "x" })?.key).toBe("utm:reddit-ads");
    expect(firstTouchFromAttribution({ utm_source: "a".repeat(300) })?.key).toBe(`utm:${"a".repeat(80)}`);
    expect(firstTouchFromAttribution({ utm_source: "@@@" })).toBeNull();
    expect(firstTouchFromAttribution({ rdt_cid: "click" })).toBeNull();
    expect(firstTouchFromAttribution(null)).toBeNull();
  });
  it("never keeps an address, a URL or a space", () => {
    expect(touchSlug("learner@example.at")).toBe("learner-example-at");
    expect(touchSlug("https://evil.example/?a=b")).toBe("https-evil-example-a-b");
    expect(touchSlug("")).toBeNull();
  });
});

describe("Telegram start parameter and hints", () => {
  it("c_<slug> (with the language suffix) becomes tg_start:<slug>; anything else is dropped", () => {
    expect(firstTouchFromStartParam("c_fristen-17-okt")).toEqual({ key: "tg_start:fristen-17-okt", basis: "start_param" });
    expect(firstTouchFromStartParam("c_fristen-17-okt_de")?.key).toBe("tg_start:fristen-17-okt");
    for (const bad of ["web_login", "auth_x", "c_Bad", "c_", "", null, 7, `c_${"a".repeat(70)}`]) expect(firstTouchFromStartParam(bad)).toBeNull();
  });
  it("only the literal tg_welcome hint is accepted", () => {
    expect(firstTouchFromHint("tg_welcome")).toEqual({ key: "tg_welcome", basis: "hint" });
    for (const bad of ["TG_WELCOME", "partner:x", "code:x", "lernplan", "utm:x", 1, null]) expect(firstTouchFromHint(bad)).toBeNull();
  });
  it("reads start_param from an initData string", () => {
    expect(initDataStartParam("user=%7B%7D&start_param=c_abc&hash=h")).toBe("c_abc");
    expect(initDataStartParam("user=%7B%7D")).toBeNull();
  });
  it("web_login_c_<slug> parses whatever the flag says; the payload is tagged only when on", () => {
    expect(parseWebLoginCampaign("web_login_c_fristen-17-okt_de")).toBe("fristen-17-okt");
    expect(parseWebLoginCampaign("web_login_c_fristen")).toBe("fristen");
    expect(parseWebLoginCampaign("web_login_de")).toBeNull();
    expect(parseWebLoginCampaign("web_login_c_Bad_de")).toBeNull();
    expect(webLoginPayload("fristen", "_de", true)).toBe("web_login_c_fristen_de");
    expect(webLoginPayload("fristen", "_de", false)).toBe("web_login_de");
    expect(webLoginPayload(null, "_en", true)).toBe("web_login_en");
    // Telegram start payloads hold at most 64 characters.
    expect(webLoginPayload("a".repeat(40), "_de", true).length).toBeLessThanOrEqual(64);
  });
});

describe("precedence (same as captureAttributionFromUrl)", () => {
  it("stored first touch > start param > hint", () => {
    const attr = { utm_source: "arrival", utm_medium: "organic", utm_campaign: "lernplan" };
    expect(deriveFirstTouch({ attribution: attr, startParam: "c_post", hint: "tg_welcome" })?.key).toBe("lernplan");
    expect(deriveFirstTouch({ attribution: null, startParam: "c_post", hint: "tg_welcome" })?.key).toBe("tg_start:post");
    expect(deriveFirstTouch({ attribution: null, startParam: "junk", hint: "tg_welcome" })?.key).toBe("tg_welcome");
    expect(deriveFirstTouch({ attribution: { rdt_cid: "x" }, startParam: null, hint: "nope" })).toBeNull();
  });
  it("every derived key matches the one stored shape", () => {
    const keys = ["lernplan", "selbsttest", "tg_welcome", "blog:a", "sitting:a", "gratis:a", "code:a", "tg_post:a", "tg_start:a", "utm:a"];
    for (const k of keys) expect(FIRST_TOUCH_KEY_RE.test(k)).toBe(true);
    for (const k of ["partner:a", "blog:", "Lernplan", "utm:A", "code:a b", `blog:${"a".repeat(81)}`]) expect(FIRST_TOUCH_KEY_RE.test(k)).toBe(false);
  });
});

describe("levers", () => {
  it("groups keys by the 20 Oct lever", () => {
    const partner = new Set(["oeh-wien"]);
    expect(leverOf("code:wien26", partner)).toBe("codes");
    expect(leverOf("gratis:oeh-wien", partner)).toBe("partner_codes");
    expect(leverOf("tg_post:x")).toBe("telegram");
    expect(leverOf("tg_start:x")).toBe("telegram");
    expect(leverOf("blog:x")).toBe("answer_pages");
    expect(leverOf("lernplan")).toBe("lernplan");
    expect(leverOf("selbsttest")).toBe("selbsttest");
    expect(leverOf("tg_welcome")).toBe("tg_welcome");
    expect(leverOf("sitting:x")).toBe("sitting_pages");
    expect(leverOf("utm:reddit")).toBe("other_campaign");
    expect(leverOf(null)).toBe("untagged");
    expect(leverOf("partner:x")).toBe("untagged");
  });
});

describe("server is the only writer", () => {
  it("the client event allowlist does not accept user_registered", () => {
    expect(isAllowedEvent("user_registered")).toBe(false);
  });
});
