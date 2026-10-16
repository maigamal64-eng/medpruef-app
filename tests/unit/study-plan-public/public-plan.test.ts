import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { OFFICIAL_SITTINGS } from "@/lib/exam-dates";
import {
  PUBLIC_PLAN_HOURS,
  approvedNarratives,
  buildPublicPlan,
  defaultSitting,
  pendingPlanMatches,
  pendingPlanRecord,
  dailyGoalForHours,
  narrativeKey,
  parseCarriedPlan,
  parsePublicPlanQuery,
  publicPlanEnabled,
  publicRegistrationRows,
  publicSittingOptions,
  resolveNarrative,
  studyPlanCarryHref,
  validateNarrative,
  weeksFromSchedule,
  withoutCarryParams,
  type NarrativeEntry,
} from "@/lib/study-plan-public";
import { PUBLIC_PLAN_COPY } from "@/lib/study-plan-public/copy";
import { safeNext } from "@/lib/auth-entry";

const NOW = new Date("2026-10-14T10:00:00Z");
const TODAY = "2026-10-14";
const COUNTS = [
  { topic: "Innere Medizin", count: 2100 },
  { topic: "Chirurgie", count: "1500" },
  { topic: "Pädiatrie", count: 900 },
  { topic: "Leer", count: 0 },
];
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

describe("flag", () => {
  it("opens only on the literal 'true'", () => {
    expect(publicPlanEnabled({})).toBe(false);
    expect(publicPlanEnabled({ STUDY_PLAN_PUBLIC_ENABLED: "1" })).toBe(false);
    expect(publicPlanEnabled({ STUDY_PLAN_PUBLIC_ENABLED: "TRUE" })).toBe(false);
    expect(publicPlanEnabled({ STUDY_PLAN_PUBLIC_ENABLED: "true" })).toBe(true);
  });

  it("the page calls notFound before reading anything when the flag is off", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/lernplan/page.tsx"), "utf8");
    const body = src.slice(src.indexOf("export default async function Page"));
    expect(body.indexOf("if (!publicPlanEnabled()) notFound();")).toBeGreaterThan(-1);
    expect(body.indexOf("if (!publicPlanEnabled()) notFound();")).toBeLessThan(body.indexOf("await searchParams"));
  });

  it("sitemap lists /lernplan only while the flag is on", async () => {
    const { default: sitemap } = await import("@/app/sitemap");
    const prev = process.env.STUDY_PLAN_PUBLIC_ENABLED;
    try {
      delete process.env.STUDY_PLAN_PUBLIC_ENABLED;
      expect(sitemap().some((e) => e.url.endsWith("/lernplan"))).toBe(false);
      process.env.STUDY_PLAN_PUBLIC_ENABLED = "true";
      expect(sitemap().some((e) => e.url.endsWith("/lernplan"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.STUDY_PLAN_PUBLIC_ENABLED;
      else process.env.STUDY_PLAN_PUBLIC_ENABLED = prev;
    }
  });

  it("agent surfaces stay silent about the page", () => {
    for (const f of ["public/llms.txt", "src/lib/agent-docs/llms-full-txt.ts", "src/app/openapi.json/route.ts"]) {
      let text = "";
      try { text = readFileSync(path.join(process.cwd(), f), "utf8"); } catch { continue; }
      expect(text).not.toContain("/lernplan");
    }
  });
});

describe("hours to daily goal", () => {
  it("uses the 1.5 minute estimate and clamps to 5..200", () => {
    expect(dailyGoalForHours(3)).toBe(17);
    expect(dailyGoalForHours(8)).toBe(46);
    expect(dailyGoalForHours(20)).toBe(114);
    expect(dailyGoalForHours(0)).toBe(5);
    expect(dailyGoalForHours(100)).toBe(200);
    for (const h of PUBLIC_PLAN_HOURS) expect(dailyGoalForHours(h)).toBeGreaterThanOrEqual(5);
  });
});

describe("sitting options come only from OFFICIAL_SITTINGS", () => {
  it("every option date is an official row of the bank's exams, after today", () => {
    const official = new Set(OFFICIAL_SITTINGS.map((s) => `${s.exam_key}|${s.date}`));
    const keys = { kenntnispruefung: ["sip4a", "sip5a"], kmp_innsbruck: ["stichprobentest"], pharma: ["rezeptierkunde"] } as const;
    for (const bank of ["kenntnispruefung", "kmp_innsbruck", "pharma"] as const) {
      const opts = publicSittingOptions(bank, NOW);
      expect(opts.length).toBeGreaterThan(0);
      for (const o of opts) {
        expect(o.date > TODAY).toBe(true);
        expect(keys[bank].some((k) => official.has(`${k}|${o.date}`))).toBe(true);
        expect(o.publishers.length).toBeGreaterThan(0);
      }
    }
  });

  it("the Stichprobentest shows both publishers, never one", () => {
    const stp = publicSittingOptions("kmp_innsbruck", NOW)[0];
    expect(stp.publishers).toEqual(expect.arrayContaining(["MedUni Wien", "Medizinische Universität Innsbruck"]));
    const rows = publicRegistrationRows("kmp_innsbruck", stp.date, NOW);
    expect(new Set(rows.map((r) => r.publisher)).size).toBe(2);
    expect(rows.map((r) => r.deadlineType).sort()).toEqual(["filing_cutoff", "registration"]);
  });

  it("pharma offers the Rezeptierkunde week, not Gerichtsmedizin", () => {
    for (const o of publicSittingOptions("pharma", NOW)) {
      expect(o.labels.every((l) => /Rezeptierkunde/.test(l.de))).toBe(true);
      expect(o.dateEnd).toBeDefined();
    }
  });

  it("an unconfirmed window is flagged and has no deadline row", () => {
    const march = publicSittingOptions("kenntnispruefung", NOW).find((o) => o.date === "2027-03-10");
    expect(march?.windowUnconfirmed).toBe(true);
    expect(publicRegistrationRows("kenntnispruefung", "2027-03-10", NOW)).toEqual([]);
  });

  it("a sitting that has passed disappears by itself", () => {
    const later = new Date("2026-11-18T12:00:00Z");
    expect(publicSittingOptions("kenntnispruefung", later).some((o) => o.date === "2026-11-17")).toBe(false);
  });
});

describe("default sitting", () => {
  it("skips a sitting whose registration has closed", () => {
    // 20 Oct 2026 13:00 Vienna: the November SIP window closed on 19 Oct.
    const after = new Date("2026-10-20T11:00:00Z");
    const opts = publicSittingOptions("kenntnispruefung", after);
    expect(opts[0].date).toBe("2026-11-17");
    expect(opts[0].registrationClosed).toBe(true);
    expect(defaultSitting(opts)).toBe("2027-02-15");
    expect(parsePublicPlanQuery({}, after).form.sitting).toBe("2027-02-15");
  });
  it("an unconfirmed window never counts as closed", () => {
    const march = publicSittingOptions("kenntnispruefung", NOW).find((o) => o.date === "2027-03-10");
    expect(march?.registrationClosed).toBe(false);
  });
});

describe("query", () => {
  it("needs bank, an official sitting of that bank and a listed hours value", () => {
    const ok = parsePublicPlanQuery({ bank: "kmp_innsbruck", sitting: "2027-02-03", hours: "8" }, NOW);
    expect(ok.query).toEqual({ bank: "kmp_innsbruck", sitting: "2027-02-03", hours: 8 });
    expect(parsePublicPlanQuery({ bank: "kmp_innsbruck", sitting: "2026-11-17", hours: "8" }, NOW).query).toBeNull();
    expect(parsePublicPlanQuery({ bank: "kenntnispruefung", sitting: "2026-11-17", hours: "7" }, NOW).query).toBeNull();
    expect(parsePublicPlanQuery({ bank: "nope", sitting: "2026-11-17", hours: "8" }, NOW).query).toBeNull();
  });

  it("form defaults are usable without a query", () => {
    const { form, query } = parsePublicPlanQuery({}, NOW);
    expect(query).toBeNull();
    expect(form.bank).toBe("kenntnispruefung");
    expect(form.sitting).toBe(publicSittingOptions("kenntnispruefung", NOW)[0].date);
    expect(form.hours).toBe(8);
  });
});

describe("plan", () => {
  const plan = buildPublicPlan({ query: { bank: "kmp_innsbruck", sitting: "2027-02-03", hours: 8 }, topicCounts: COUNTS, todayISO: TODAY, now: NOW });

  it("is the deterministic engine with nothing answered", () => {
    const again = buildPublicPlan({ query: plan.query, topicCounts: [...COUNTS].reverse(), todayISO: TODAY, now: NOW });
    expect(again.plan).toEqual(plan.plan);
    expect(plan.dailyGoal).toBe(46);
    expect(plan.bankTotal).toBe(4500);
    expect(plan.plan.generatedFor).toBe("2027-02-03");
    expect(plan.plan.dailySchedule[0].day).toBe(TODAY);
  });

  it("weeks add up to the plan and run in seven-day steps", () => {
    expect(plan.weeks.reduce((s, w) => s + w.questions, 0)).toBe(plan.plan.totalQuestions);
    expect(plan.weeks[0].from).toBe(TODAY);
    expect(plan.weeks[0].to).toBe("2026-10-20");
    expect(plan.weeks.at(-1)?.to).toBe("2027-02-02");
    expect(plan.weeks[0].phase).toBe("new");
    expect(plan.weeks.at(-1)?.phase).toBe("consolidation");
    for (const w of plan.weeks) expect(w.topics.reduce((s, t) => s + t.count, 0)).toBe(w.questions);
  });

  it("weeksFromSchedule handles an empty schedule", () => {
    expect(weeksFromSchedule([])).toEqual([]);
  });
});

describe("carrying the plan into an account", () => {
  const carried = { exam: "kmp_innsbruck" as const, examDate: "2027-02-03", dailyGoal: 46 };

  it("round-trips through safeNext and back", () => {
    const href = studyPlanCarryHref(carried);
    expect(safeNext(href)).toBe(href);
    const url = new URL(href, "https://medpruf.com");
    expect(parseCarriedPlan(url.searchParams, NOW)).toEqual(carried);
  });

  it("rejects anything that is not an upcoming official sitting of that bank", () => {
    const bad = (over: Record<string, string>) =>
      parseCarriedPlan(new URLSearchParams({ plan_exam: "kmp_innsbruck", plan_date: "2027-02-03", plan_goal: "46", from: "lernplan", ...over }), NOW);
    expect(bad({})).not.toBeNull();
    expect(bad({ plan_date: "2027-02-04" })).toBeNull();
    expect(bad({ plan_exam: "pharma" })).toBeNull();
    expect(bad({ plan_goal: "4" })).toBeNull();
    expect(bad({ plan_goal: "201" })).toBeNull();
    expect(bad({ plan_goal: "4e1" })).toBeNull();
    expect(bad({ from: "elsewhere" })).toBeNull();
  });

  it("auto-apply needs the CTA marker for exactly this plan, not expired", () => {
    const rec = pendingPlanRecord(carried, 1_000);
    expect(pendingPlanMatches(rec, carried, 2_000)).toBe(true);
    expect(pendingPlanMatches(rec, { ...carried, dailyGoal: 47 }, 2_000)).toBe(false);
    expect(pendingPlanMatches(rec, carried, 1_000 + 31 * 60_000)).toBe(false);
    expect(pendingPlanMatches(null, carried, 2_000)).toBe(false);
    expect(pendingPlanMatches("{bad", carried, 2_000)).toBe(false);
  });

  it("strips the carry parameters and keeps the rest", () => {
    expect(withoutCarryParams("?plan_exam=pharma&plan_date=x&plan_goal=5&from=lernplan&focus=weak")).toBe("?focus=weak");
    expect(withoutCarryParams("?plan_exam=pharma&from=lernplan")).toBe("");
  });
});

describe("narratives", () => {
  const plan = buildPublicPlan({ query: { bank: "kmp_innsbruck", sitting: "2027-02-03", hours: 8 }, topicCounts: COUNTS, todayISO: TODAY, now: NOW });
  const de = "Bis {sitting} haben Sie {weeks} Wochen. Mit {hours} Stunden pro Woche üben Sie etwa {per_week} Fragen, ab {review_from} wiederholen Sie.";
  const en = "You have {weeks} weeks until {sitting}. With {hours} hours a week you practise about {per_week} questions and review from {review_from}.";
  const base: NarrativeEntry = { key: narrativeKey("kmp_innsbruck", "2027-02-03", 8), bank: "kmp_innsbruck", sitting: "2027-02-03", hours: 8, verdict: plan.verdict!, de, en, status: "approved", approved_by: "Lektor", approved_on: "2026-10-14", text_sha256: sha(`${de}\n${en}`) };
  const values = { exam: "X", sitting: "3. Februar 2027", weeks: "16", hours: "8", per_week: "299", review_from: "5. Jänner" };

  it("only approved entries with an unchanged hash render", () => {
    expect(Object.keys(approvedNarratives([base], sha))).toEqual([base.key]);
    expect(approvedNarratives([{ ...base, status: "draft" }], sha)).toEqual({});
    expect(approvedNarratives([{ ...base, approved_by: undefined }], sha)).toEqual({});
    expect(approvedNarratives([{ ...base, de: `${de} Neu.` }], sha)).toEqual({});
  });

  it("fills placeholders from code and hides when the verdict moved", () => {
    const approved = approvedNarratives([base], sha);
    expect(resolveNarrative(approved, plan, "de", values)).toContain("16 Wochen");
    expect(resolveNarrative(approved, { ...plan, verdict: plan.verdict === "fits" ? "tight" : "fits" }, "de", values)).toBeNull();
    expect(resolveNarrative({}, plan, "en", values)).toBeNull();
  });

  it("the shipped set holds no draft (until Lektor approves, the page shows no narrative)", () => {
    const data = JSON.parse(readFileSync(path.join(process.cwd(), "src/lib/study-plan-public/narratives.data.json"), "utf8")) as { entries: NarrativeEntry[] };
    for (const e of data.entries) {
      expect(e.status).toBe("approved");
      expect(e.text_sha256).toBe(sha(`${e.de}\n${e.en}`));
    }
  });

  it("validation catches digits, dashes, du, pass promises, prices and eligibility", () => {
    expect(validateNarrative(de, "de")).toEqual([]);
    expect(validateNarrative(en, "en")).toEqual([]);
    expect(validateNarrative("Sie haben 12 Wochen.", "de")).toContain("digit");
    expect(validateNarrative("Sie lernen — jeden Tag.", "de")).toContain("dash");
    expect(validateNarrative("Du lernst jeden Tag, Ihr Plan.", "de").some((i) => i.startsWith("forbidden"))).toBe(true);
    expect(validateNarrative("Ihr Plan hilft beim Bestehen.", "de").some((i) => i.startsWith("forbidden"))).toBe(true);
    expect(validateNarrative("This plan helps you pass.", "en").some((i) => i.startsWith("forbidden"))).toBe(true);
    expect(validateNarrative("Only 19 euro a month.", "en").length).toBeGreaterThan(0);
    expect(validateNarrative("Check your eligibility first.", "en").some((i) => i.startsWith("forbidden"))).toBe(true);
    expect(validateNarrative("Use {price} now.", "en")).toContain("placeholder:price");
    expect(validateNarrative("Der Plan läuft bis {sitting}.", "de")).toContain("not_formal");
    expect(validateNarrative("Ab Jänner wiederholen Sie.", "de")).toContain("month");
    expect(validateNarrative("From January you review.", "en")).toContain("month");
    expect(validateNarrative("You may review from {review_from}.", "en")).toEqual([]);
  });
});

describe("page copy", () => {
  const all = Object.values(PUBLIC_PLAN_COPY).flatMap((v) => [v.de, v.en]);
  it("has no em or en dashes, no prices and no pass promise", () => {
    for (const text of all) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/€|\beuro\b|\d+ ?EUR/i);
      expect(text).not.toMatch(/bestehen|bestanden|garantie|\bpass\b|guarantee/i);
    }
  });
  it("German copy uses Sie, never du", () => {
    for (const v of Object.values(PUBLIC_PLAN_COPY)) expect(v.de).not.toMatch(/\b(du|dein|deine|dich|dir)\b/i);
  });
  it("frames the exams as Austrian, never German", () => {
    for (const text of all) expect(text).not.toMatch(/Deutschland|Germany|German exam/);
  });
});
