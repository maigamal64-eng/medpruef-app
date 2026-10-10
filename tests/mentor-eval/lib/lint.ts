/**
 * Golden-set lint (W2-EVAL): structure always, ground truth when the facts
 * directory is present. Run by `scripts/mentor-eval.mjs --lint` and by the
 * unit tests; it spends nothing and needs no key.
 *
 * Ground-truth rule: a golden case may only expect a date, amount or
 * percentage that is printed in the facts it cites. That keeps the golden set
 * from inventing a value of its own (it would then "pass" a wrong mentor).
 */

import { billingCancelSummary, billingPlansSummary, billingTrialSummary } from "@/lib/billing-copy";
import { MENTOR_MODES, MENTOR_REFUSAL_REASONS } from "@/lib/mentor/contract";
import { checkMinCounts } from "./aggregate";
import { countEmDashes } from "./lang";
import { factsMatching, type FactRecord } from "./facts-source";
import type { Category, ExpectKind, FixturesFile, GoldenFile } from "./types";
import { extractEur, extractPercents, globToRegExp, isoDatesIn } from "./values";

const CATEGORIES: readonly Category[] = ["deadline", "procedure", "explain", "study", "app_plan", "refusal", "injection", "unconfirmed"];
const KINDS: readonly ExpectKind[] = ["answer", "ask_filing_university", "refuse", "not_confirmed", "safe"];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Ids the files cannot prove: derived at runtime by the brain. */
const DERIVED_PREFIXES = ["sitting.", "app.", "question.", "progress."];

/** The app.billing.* fact texts (de and en), as the brain's appBillingFacts() builds them. */
const APP_BILLING_TEXT = (["de", "en"] as const).flatMap((l) => [billingPlansSummary(l), billingTrialSummary(l), billingCancelSummary(l)]).join("\n");

export interface LintOptions {
  /** Records of content/mentor-facts; null skips the ground-truth checks. */
  facts: readonly FactRecord[] | null;
  /** Ids of derived sitting facts (sittingFactId over OFFICIAL_SITTINGS); null skips that check. */
  sittingIds?: readonly string[] | null;
}

export interface LintResult {
  errors: string[];
  warnings: string[];
  groundTruthChecked: boolean;
}

function validIso(s: string): boolean {
  if (!ISO.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function lintGolden(file: GoldenFile, fx: FixturesFile, opts: LintOptions): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (id: string, m: string) => errors.push(`${id}: ${m}`);

  if (file.version !== 1) errors.push(`golden.version must be 1, got ${String(file.version)}`);
  if (Number.isNaN(Date.parse(file.as_of))) errors.push(`as_of is not a date: ${file.as_of}`);
  if (!/[+-]\d{2}:\d{2}$/.test(file.as_of)) errors.push("as_of must carry an explicit UTC offset (Europe/Vienna wall time)");

  for (const m of checkMinCounts(file)) {
    if (!m.ok) errors.push(`min_counts.${m.key}: ${m.actual} < ${m.min}`);
  }

  const allFactDates = new Set<string>(opts.facts ? isoDatesIn(opts.facts.map((r) => `${r.text_en}\n${r.text_de}`).join("\n")) : []);
  // Amounts and percentages a case may ALLOW (not require): printed in some verified fact, or in the app billing copy
  // that the brain serves as the confirmed app.billing.* facts (src/lib/billing-copy.ts, the single owner of the prices).
  const allFactsText = opts.facts ? `${opts.facts.map((r) => `${r.text_en}\n${r.text_de}`).join("\n")}\n${APP_BILLING_TEXT}` : "";
  const allFactEur = new Set<number>(opts.facts ? extractEur(allFactsText) : []);
  const allFactPct = new Set<number>(opts.facts ? extractPercents(allFactsText) : []);
  const seen = new Set<string>();
  for (const c of file.cases) {
    const id = c.id || "(no id)";
    if (!c.id || !/^[a-z0-9][a-z0-9_.-]{2,80}$/.test(c.id)) err(id, "id must match /^[a-z0-9][a-z0-9_.-]{2,80}$/");
    if (seen.has(c.id)) err(id, "duplicate id");
    seen.add(c.id);
    if (!CATEGORIES.includes(c.category)) err(id, `bad category ${String(c.category)}`);
    if (c.lang !== "de" && c.lang !== "en") err(id, `lang must be de or en (v1), got ${String(c.lang)}`);
    if (!(MENTOR_MODES as readonly string[]).includes(c.mode)) err(id, `bad mode ${String(c.mode)}`);
    if (typeof c.message !== "string" || c.message.trim().length === 0) err(id, "empty message");
    if (c.message && c.message.length > 1500) err(id, "message over the 1,500 character cap");
    for (const t of [c.message, ...(c.history ?? []).map((h) => h.text)]) {
      if (countEmDashes(t) > 0) err(id, "em dash in a learner message");
    }
    if (c.history) {
      const roles = c.history.map((h) => h.role);
      if (roles.length === 0 || roles[0] !== "user" || roles.some((r, i) => r !== (i % 2 === 0 ? "user" : "assistant"))) err(id, "history must alternate user, assistant and start with user");
      if (roles[roles.length - 1] !== "assistant") err(id, "history must end with an assistant turn (the case message is the next user turn)");
    }
    const e = c.expect;
    if (!e || !KINDS.includes(e.kind)) {
      err(id, `bad expect.kind ${String(e?.kind)}`);
      continue;
    }

    if (c.mode === "explain" && !c.question_fixture) err(id, "explain mode needs question_fixture");
    if (c.mode === "study" && !c.profile_fixture) err(id, "study mode needs profile_fixture");
    if (c.question_fixture && !fx.questions[c.question_fixture]) err(id, `unknown question_fixture ${c.question_fixture}`);
    if (c.profile_fixture && !fx.profiles[c.profile_fixture]) err(id, `unknown profile_fixture ${c.profile_fixture}`);
    if (e.kind === "refuse") {
      for (const r of e.refusal_reasons ?? []) if (!(MENTOR_REFUSAL_REASONS as readonly string[]).includes(r)) err(id, `unknown refusal reason ${r}`);
    }
    if (e.kind === "answer" && c.mode === "facts" && c.category !== "injection" && !(e.cite_any && e.cite_any.length)) err(id, "answer needs cite_any");
    if (e.kind === "ask_filing_university" && !(e.forbid_dates && e.forbid_dates.length)) err(id, "ask_filing_university must forbid the deadline dates");
    for (const list of [e.must_dates, e.allow_dates, e.forbid_dates]) {
      for (const d of list ?? []) if (!validIso(d)) err(id, `not an ISO date: ${d}`);
    }
    for (const d of e.must_dates ?? []) if ((e.forbid_dates ?? []).includes(d)) err(id, `${d} is both required and forbidden`);
    if ((e.must_dates ?? []).length > 0 && e.kind !== "answer") err(id, "must_dates only make sense for kind=answer");

    // Ground truth against the facts.
    if (opts.facts) {
      for (const d of e.allow_dates ?? []) {
        if (!allFactDates.has(d)) err(id, `allow_date ${d} is not printed in any fact`);
      }
      for (const n of e.allow_eur ?? []) {
        if (!allFactEur.has(n)) err(id, `allow_eur ${n} is not printed in any fact or in the app billing copy`);
      }
      for (const n of e.allow_percent ?? []) {
        if (!allFactPct.has(n)) err(id, `allow_percent ${n} is not printed in any fact`);
      }
      for (const g of e.cite_any ?? []) {
        if (DERIVED_PREFIXES.some((p) => g.startsWith(p))) {
          if (g.startsWith("sitting.") && opts.sittingIds && !opts.sittingIds.some((s) => globToRegExp(g).test(s))) err(id, `cite_any ${g} matches no derived sitting id`);
          continue;
        }
        if (factsMatching(opts.facts, [g]).length === 0) err(id, `cite_any ${g} matches no fact`);
      }
      const dataGlobs = (e.cite_any ?? []).filter((g) => !DERIVED_PREFIXES.some((p) => g.startsWith(p)));
      const matched = factsMatching(opts.facts, dataGlobs);
      const truthText = matched.map((r) => `${r.text_en}\n${r.text_de}`).join("\n");
      const truthIso = new Set(isoDatesIn(truthText));
      if (e.kind === "answer" && dataGlobs.length > 0) {
        for (const d of e.must_dates ?? []) if (!truthIso.has(d)) err(id, `must_date ${d} is not printed in the cited facts`);
        const eur = new Set(extractEur(truthText));
        for (const n of e.must_eur ?? []) if (!eur.has(n)) err(id, `must_eur ${n} is not printed in the cited facts`);
        const pct = new Set(extractPercents(truthText));
        for (const n of e.must_percent ?? []) if (!pct.has(n)) err(id, `must_percent ${n} is not printed in the cited facts`);
        for (const t of e.terms_all ?? []) if (!truthText.toLowerCase().includes(t.toLowerCase())) warnings.push(`${id}: terms_all "${t}" is not in the cited facts`);
      }
      // A date the case allows must not be a date a forbidden-publisher fact prints for the same sitting; checked by forbid_dates above.
      if (e.kind === "answer" && e.cite_any && matched.some((f) => f.verdict !== "confirmed" || f.status !== "live")) {
        warnings.push(`${id}: cites a fact that is not confirmed/live (${matched.filter((f) => f.verdict !== "confirmed").map((f) => f.id).join(", ")})`);
      }
      if (e.kind === "not_confirmed") {
        // The unconfirmed gap should exist in the facts as a partly or not_in_sources record, or be absent altogether.
        const unconf = (e.cite_any ?? []).length === 0 || matched.some((f) => f.verdict === "partly" || f.verdict === "not_in_sources");
        if (!unconf) warnings.push(`${id}: not_confirmed but none of the cited facts is partly or not_in_sources`);
      }
    }
  }

  // Fixtures sanity.
  for (const [key, q] of Object.entries(fx.questions)) {
    if (!q.synthetic) errors.push(`question fixture ${key} must be marked synthetic`);
    if (q.id < 9_000_000) errors.push(`question fixture ${key}: id must be >= 9000000 so it can never collide with a real question`);
    if (!q.question || !q.explanation) errors.push(`question fixture ${key}: empty question or explanation`);
    if (q.key_terms.de.length === 0 || q.key_terms.en.length === 0) errors.push(`question fixture ${key}: key_terms needed in de and en`);
  }
  for (const [key, p] of Object.entries(fx.profiles)) {
    if (!p.synthetic) errors.push(`profile fixture ${key} must be marked synthetic`);
    if (p.exam_date && !validIso(p.exam_date)) errors.push(`profile fixture ${key}: bad exam_date`);
  }

  return { errors, warnings, groundTruthChecked: opts.facts !== null };
}
