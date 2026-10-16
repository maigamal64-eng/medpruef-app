import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import allowlist from "@/lib/public-selftest/allowlist.data.json";
import {
  SELFTEST_BANKS, SELFTEST_PENDING_TTL_MS, SELFTEST_SIZE, allowlistFor, isSelftestSitting, parsePending, pendingRecord,
  scoreBucket, scoreSelftest, selftestDurationS, selftestHref, selftestNext, selftestSittingDates,
} from "@/lib/public-selftest";
import { buildItems } from "@/lib/public-selftest/server";
import { servedCanonical, servedContentHash } from "@/lib/public-selftest/served-hash";
import { FIELD_LABELS, allSelftestCopy, fieldLabel, selftestCopy } from "@/lib/public-selftest/copy";
import { freeSetIds } from "@/lib/free-set";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import { FUNNEL_EVENTS, isAllowedEvent, sanitizeEventData } from "@/lib/analytics-events";
import { ARRIVAL_CAMPAIGN_RE, arrivalPathKey } from "@/lib/attribution";
import { parseAuthEntry } from "@/lib/auth-entry";
import { middleware, config } from "@/middleware";
import { foldSelftestCounts } from "@/lib/public-selftest/counts";

afterEach(() => { vi.unstubAllEnvs(); });

const NOW = Date.parse("2026-10-15T12:00:00Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fp = "k1:" + "a".repeat(64);

describe("allowlist", () => {
  it("has at least SELFTEST_SIZE unique ids per bank, all inside the free set of that bank", () => {
    for (const bank of SELFTEST_BANKS) {
      const list = allowlistFor(bank);
      expect(list.length, bank).toBeGreaterThanOrEqual(SELFTEST_SIZE);
      const free = new Set(freeSetIds(bank));
      expect(new Set(list.map((e) => e.id)).size).toBe(list.length);
      for (const e of list) {
        expect(free.has(e.id), `${bank} ${e.id}`).toBe(true);
        expect(e.served_sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(e.reads.length).toBeGreaterThan(0);
      }
    }
    expect(allowlist.version).toMatch(/^st1-[0-9a-f]{12}$/);
  });
  it("names every allowlisted field in both languages", () => {
    for (const bank of SELFTEST_BANKS) for (const e of allowlistFor(bank)) {
      expect(FIELD_LABELS[e.field], e.field).toBeDefined();
      expect(fieldLabel(e.field, "en")).not.toBe("");
    }
  });
  it("never shares an id between the banks", () => {
    const a = new Set(allowlistFor("kmp_innsbruck").map((e) => e.id));
    expect(allowlistFor("kenntnispruefung").some((e) => a.has(e.id))).toBe(false);
  });
});

describe("served hash and buildItems", () => {
  const bank = "kmp_innsbruck" as const;
  const entry = allowlistFor(bank)[0];
  const row = { id: entry.id, question: "Stamm", choices: [{ text: "A", correct: true }, { text: "B", correct: false }], answer: "A", distractors: ["B"], topic: entry.field, exam_type: bank, is_active: true };
  it("hashes stem, option texts with flags and the answer, never the explanation", () => {
    expect(servedCanonical(row)).toContain("Stamm");
    expect(servedContentHash({ ...row, explanation: "x" } as never)).toBe(servedContentHash(row));
    expect(servedContentHash({ ...row, choices: [{ text: "A", correct: false }, { text: "B", correct: true }] })).not.toBe(servedContentHash(row));
  });
  it("drops a row whose served text differs from the reviewed hash", () => {
    expect(buildItems(bank, [row])).toEqual([]);
  });
  it("drops inactive, wrong-bank and unknown rows even with matching text", () => {
    expect(buildItems(bank, [{ ...row, id: 1, is_active: true }])).toEqual([]);
    expect(buildItems(bank, [{ ...row, is_active: false }])).toEqual([]);
    expect(buildItems(bank, [{ ...row, exam_type: "kenntnispruefung" }])).toEqual([]);
  });
});

describe("scoring", () => {
  const items = [
    { id: 1, field: "A", options: [{ correct: true }, { correct: false }, { correct: true }] },
    { id: 2, field: "B", options: [{ correct: true }, { correct: false }] },
    { id: 3, field: "A", options: [{ correct: false }, { correct: true }] },
  ];
  it("uses strict multi-answer grading and counts open items as not solved", () => {
    const s = scoreSelftest(items, { 1: [0], 2: [0], 3: [] });
    expect(s.correct).toBe(1);
    expect(s.answered).toBe(2);
    expect(s.fields).toEqual([{ field: "A", correct: 0, total: 2 }, { field: "B", correct: 1, total: 1 }]);
    expect(scoreSelftest(items, { 1: [0, 2] }).correct).toBe(1);
    expect(scoreSelftest(items, { 1: [0, 1, 2] }).correct).toBe(0);
  });
  it("sends only a band", () => {
    expect([0, 3, 4, 6, 7, 8, 9, 10].map((c) => scoreBucket(c, 10))).toEqual(["0-3", "0-3", "4-6", "4-6", "7-8", "7-8", "9-10", "9-10"]);
    expect(scoreBucket(0, 0)).toBe("0-3");
  });
  it("runs at the custom pace", () => {
    expect(selftestDurationS(10)).toBe(900);
  });
});

describe("sittings", () => {
  it("offers only upcoming official sittings of the bank", () => {
    const now = new Date(NOW);
    for (const bank of SELFTEST_BANKS) {
      const dates = selftestSittingDates(bank, now);
      for (const d of dates) {
        expect(OFFICIAL_SITTINGS.some((s) => s.date === d)).toBe(true);
        expect(isSelftestSitting(bank, d, now)).toBe(true);
      }
    }
    expect(isSelftestSitting("kmp_innsbruck", "2030-01-01", now)).toBe(false);
    expect(isSelftestSitting("kmp_innsbruck", "x", now)).toBe(false);
  });
  it("routes to the study plan only with a named sitting", () => {
    expect(selftestNext("kmp_innsbruck", "2027-01-01")).toBe("/study-plan");
    expect(selftestNext("kmp_innsbruck", "")).toBe("/quiz?examSource=kmp_innsbruck&practiceMode=unseen");
  });
  it("builds entry links", () => {
    expect(selftestHref()).toBe("/selbsttest");
    expect(selftestHref("kenntnispruefung", "en")).toBe("/selbsttest?bank=kenntnispruefung&lang=en");
  });
});

describe("carry record", () => {
  const id = allowlistFor("kmp_innsbruck")[0].id;
  const ok = { id, requestId: uuid(1), userAnswer: "A", isCorrect: true, timeSpentMs: 1000, keyFingerprint: fp };
  const rec = (p: Record<string, unknown>) => pendingRecord({ bank: "kmp_innsbruck", sitting: "", answers: [ok], ...p } as never, NOW);
  it("round-trips a record the self-check wrote", () => {
    expect(parsePending(rec({}), NOW)?.answers).toHaveLength(1);
  });
  it("refuses expired, foreign, repeated or malformed records whole", () => {
    expect(parsePending(rec({}), NOW + SELFTEST_PENDING_TTL_MS + 1)).toBeNull();
    expect(parsePending(rec({ answers: [{ ...ok, id: 1 }] }), NOW)).toBeNull();
    expect(parsePending(rec({ answers: [ok, ok] }), NOW)).toBeNull();
    expect(parsePending(rec({ answers: [{ ...ok, requestId: "x" }] }), NOW)).toBeNull();
    expect(parsePending(rec({ answers: [{ ...ok, keyFingerprint: "k1:zz" }] }), NOW)).toBeNull();
    expect(parsePending(rec({ answers: [] }), NOW)).toBeNull();
    expect(parsePending(rec({ bank: "kenntnispruefung" }), NOW)).toBeNull();
    expect(parsePending(rec({ sitting: "soon" }), NOW)).toBeNull();
    expect(parsePending("{", NOW)).toBeNull();
    expect(parsePending(null, NOW)).toBeNull();
  });
});

describe("copy", () => {
  it("has DE and EN for every key, no long dashes, no exclamation marks, no promises", () => {
    for (const { key, lang, text } of allSelftestCopy()) {
      expect(text, key).not.toBe("");
      expect(text, `${key} ${lang}`).not.toMatch(/[–—!]/);
      expect(text, `${key} ${lang}`).not.toMatch(/garantiert|guarantee|echte Prüfungsfragen|real exam questions|Originalfragen|gratis|kostenloses Konto|free account|Deutschland/i);
      if (lang === "de") expect(text, key).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
    }
  });
  it("frames the result as practice, never as a pass verdict", () => {
    expect(selftestCopy("result_note", "de")).toMatch(/Keine Aussage über das Bestehen/);
    expect(selftestCopy("scope", "en")).toMatch(/not official exam questions/);
  });
});

describe("events and attribution", () => {
  it("lets the three anonymous events through with bands only", () => {
    for (const n of ["selftest_start", "selftest_finish", "selftest_register_click"]) {
      expect(isAllowedEvent(n)).toBe(true);
      expect((FUNNEL_EVENTS as readonly string[]).includes(n)).toBe(true);
    }
    expect(sanitizeEventData("selftest_finish", { exam: "kmp_innsbruck", bucket: "4-6", source: "landing", score: 5, email: "user-0a322b44@example.com" }))
      .toEqual({ exam: "kmp_innsbruck", bucket: "4-6", source: "landing" });
    expect(sanitizeEventData("selftest_register_click", { exam: "kenntnispruefung", sitting: "named", source: "landing", date: "2027-01-01" }))
      .toEqual({ exam: "kenntnispruefung", sitting: "named", source: "landing" });
  });
  it("keys /selbsttest as an arrival and lets the beacon accept it", () => {
    expect(arrivalPathKey("/selbsttest")).toBe("selbsttest");
    expect(ARRIVAL_CAMPAIGN_RE.test("selbsttest")).toBe(true);
  });
  it("carries intent selftest through the auth round trip", () => {
    expect(parseAuthEntry(new URLSearchParams("intent=selftest&exam=kmp_innsbruck&next=/study-plan"))).toEqual({ intent: "selftest", exam: "kmp_innsbruck", next: "/study-plan" });
  });
});

describe("edge gate", () => {
  const req = (path: string) => new NextRequest(`https://medpruf.com${path}`);
  it("is a real 404 while the flag is off and passes when on", () => {
    expect(config.matcher).toContain("/selbsttest");
    expect(middleware(req("/selbsttest")).headers.get("x-middleware-rewrite")).toContain("/__selbsttest-off");
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "1");
    expect(middleware(req("/selbsttest")).headers.get("x-middleware-rewrite")).toContain("/__selbsttest-off");
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    expect(middleware(req("/selbsttest")).headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("Monday counts", () => {
  it("folds funnel rows, saves and checkout opens within 14 days", () => {
    const c = foldSelftestCounts({
      arrivals: 7,
      funnel: [
        { event: "selftest_start", metadata: { exam: "kmp_innsbruck", source: "landing" } },
        { event: "selftest_start", metadata: { exam: "kmp_innsbruck", source: "landing", ua_class: "automation" } },
        { event: "selftest_finish", metadata: { bucket: "4-6" } },
        { event: "selftest_register_click", metadata: { sitting: "named" } },
        { event: "registration_success", metadata: { intent: "selftest" } },
        { event: "registration_success", metadata: { intent: "free" } },
      ],
      firstTouchSignups: 2,
      saved: [
        { user_id: "u1", at: "2026-10-01T00:00:00Z", sitting: "named" },
        { user_id: "u2", at: "2026-10-01T00:00:00Z", sitting: "open" },
      ],
      checkouts: [
        { user_id: "u1", at: "2026-10-10T00:00:00Z" },
        { user_id: "u2", at: "2026-10-20T00:00:00Z" },
        { user_id: "u3", at: "2026-10-02T00:00:00Z" },
      ],
    });
    expect(c.starts).toEqual({ total: 1, by_exam: { kmp_innsbruck: 1 }, by_source: { landing: 1 } });
    expect(c.finishes.by_bucket).toEqual({ "4-6": 1 });
    expect(c.register_clicks).toEqual({ total: 1, named: 1, open: 0 });
    expect(c.signups).toEqual({ registration_success_selftest: 1, first_touch_selbsttest: 2 });
    expect(c.saved).toEqual({ accounts: 2, named_sitting: 1, open: 1 });
    expect(c.checkout_opens_14d.accounts).toBe(1);
  });
});

describe("sitemap route", () => {
  it("lists /selbsttest only while the flag is on", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    expect(sitemap().some((e) => e.url.endsWith("/selbsttest"))).toBe(false);
    vi.stubEnv("PUBLIC_SELFTEST_ENABLED", "true");
    expect(sitemap().some((e) => e.url.endsWith("/selbsttest"))).toBe(true);
  });
});
