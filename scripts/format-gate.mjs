#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkedUrl, curlGet, options, readTsExports, repoRoot, writeReport } from "./linkcheck.mjs";

// Readiness checklist area-format: the P0 items are FMT-01, 02, 03 and 05.
export const P0_RULES = {
  "FMT-02": { sip4a: ["sip.mc", "sip.kaf"], sip5a: ["sip.mc", "sip.kaf"], rezeptierkunde: ["rx.format"] },
  "FMT-03": { sip4a: ["sip.pass", "sip4a.assignment", "supplement.attempts", "sip4a.commission"],
    sip5a: ["sip.pass", "sip5a.assignment", "supplement.attempts", "sip5a.commission"],
    stichprobentest: ["stp.pass", "stp.once"], rezeptierkunde: ["rx.pass", "rezeptierkunde.commission"],
    gerichtsmedizin: ["gm.pass", "gerichtsmedizin.commission"] },
  "FMT-05": { sip4a: ["sip.duration"], sip5a: ["sip.duration"], stichprobentest: ["stp.structure", "stp.duration"],
    rezeptierkunde: ["rx.format"], gerichtsmedizin: ["gm.format"] },
};
export const NOV_SITTINGS = [
  ["sip5a", "2026-11-17"], ["sip4a", "2026-11-18"],
  ["rezeptierkunde", "2026-11-23"], ["gerichtsmedizin", "2026-11-23"],
];
export const viennaDay = (now) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
const validDay = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const age = (day, today) => validDay(day) ? (Date.parse(today) - Date.parse(day)) / 86_400_000 : Infinity;
const sha = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const text = (html) => html.replace(/<[^>]*>/g, " ").replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();

export function validateData(data, officialSittings, today) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok: !!ok, detail });
  const keys = Object.keys(P0_RULES["FMT-05"]);
  const future = officialSittings.filter((s) => keys.includes(s.exam_key) && (s.date_end ?? s.date) >= today);
  add("FMT-01.calendar", future.length > 0, "Official future sitting list is non-empty");
  const seen = new Set();
  for (const sitting of future) {
    const id = `${sitting.exam_key}:${sitting.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const records = data.sittings.filter((r) => r.examKey === sitting.exam_key && r.date === sitting.date);
    const r = records[0];
    const source = r && data.sources[r.sourceId];
    add(`FMT-01.${id}`, records.length === 1 && ["mc", "kaf", "mixed", "oral", "not_announced"].includes(r?.format)
      && ["official", "reported", "not_confirmed"].includes(r?.status)
      && age(r?.verifiedOn, today) >= 0 && age(r?.verifiedOn, today) <= 14
      && source?.url.startsWith("https://") && source.url === r.sourceUrl && source.label === r.sourceLabel && sha(source.sha256)
      && age(source.verifiedOn, today) >= 0 && age(source.verifiedOn, today) <= 14
      && ["de", "en"].every((lang) => r?.note?.[lang]?.trim()), "Unique, sourced, localized format card checked within 14 days");
    if (r?.format === "not_announced") {
      add(`FMT-01.${id}.announcement`, r.status === "not_confirmed" && (r.expectedBy === null || (validDay(r.expectedBy) && today <= r.expectedBy)), "An unresolved announcement cannot be overdue or labelled official");
      if (sitting.exam_key.startsWith("sip")) add(`FMT-01.${id}.expected-date`, validDay(r.expectedBy) && r.expectedBy < r.date, "Unannounced SIP format has a dated notice expectation before the sitting");
    }
  }
  for (const [item, exams] of Object.entries(P0_RULES)) for (const [key, ids] of Object.entries(exams)) {
    const profile = data.exams.find((exam) => exam.key === key);
    for (const id of ids) {
      const rules = data.rules.filter((r) => r.id === id);
      const rule = rules[0];
      const source = rule && data.sources[rule.sourceId];
      add(`${item}.${key}.${id}`, rules.length === 1 && profile?.ruleIds.includes(id)
        && ["official", "reported", "not_confirmed"].includes(rule?.status)
        && ["de", "en"].every((lang) => rule?.title?.[lang]?.trim() && rule?.text?.[lang]?.trim() && rule?.scope?.[lang]?.trim())
        && source?.url.startsWith("https://") && source.edition && sha(source.sha256)
        && age(source.verifiedOn, today) >= 0 && age(source.verifiedOn, today) <= 14, "P0 rule is reachable through its profile with localized copy and dated source hash");
    }
  }
  for (const [key, date] of NOV_SITTINGS) {
    const r = data.sittings.find((r) => r.examKey === key && r.date === date);
    if (date >= today) add(`INF-05.${key}.same-day-card`, r?.verifiedOn === today && data.sources[r?.sourceId]?.verifiedOn === today, "November cards and their sources were reviewed on the release day");
  }
  // March source typo remains unresolved: never treat an inferred window as confirmed.
  for (const key of ["sip4a", "sip5a"]) {
    add(`INF-05.${key}.march-window`, data.unconfirmedWindows.some((w) => w.examKey === key && w.date === "2027-03-10"), "March window is explicitly unconfirmed pending publisher correction");
  }
  return checks;
}

export function validateAnnouncementReview(review, data, today) {
  return NOV_SITTINGS.filter(([key, date]) => key.startsWith("sip") && date >= today).map(([key, date]) => {
    const entries = review?.checks?.filter((r) => r.examKey === key && r.date === date) ?? [];
    const entry = entries[0];
    const card = data.sittings.find((r) => r.examKey === key && r.date === date);
    const source = data.sources["source-05"];
    return { id: `INF-05.${key}.ausschreibung`, ok: entries.length === 1 && review.checkedOn === today
      && !!entry?.checkedBy?.trim() && entry.sourceUrl === source?.url && sha(entry.sha256)
      && ["announced", "not_announced"].includes(entry.status) && entry.format === card?.format
      && (entry.status === "not_announced" ? card?.format === "not_announced" : card?.format !== "not_announced")
      && (card?.durationMin ?? null) === (entry.durationMin ?? null),
      detail: "Same-day human review of authenticated SIP notices matches the card; HTTP login success is insufficient" };
  });
}

export function validateSurface(html, route, lang, data, officialSittings, today) {
  const main = html.match(/<main\b[^>]*data-format-surface[^>]*>[\s\S]*?<\/main>/)?.[0] ?? "";
  const failures = [];
  if (!main || !new RegExp(`\\blang="${lang}"`).test(main) || !/<h1\b/.test(main)) failures.push("Missing localized format surface");
  if (route === "/exam-formats") {
    for (const s of officialSittings.filter((s) => Object.keys(P0_RULES["FMT-05"]).includes(s.exam_key) && (s.date_end ?? s.date) >= today)) {
      const card = data.sittings.find((r) => r.examKey === s.exam_key && r.date === s.date);
      const article = main.match(new RegExp(`<article\\b[^>]*data-sitting="${s.exam_key}:${s.date}"[^>]*>[\\s\\S]*?<\\/article>`))?.[0] ?? "";
      const source = card && data.sources[card.sourceId];
      const matches = article && card && source && text(article).includes(text(card.note[lang]))
        && (article.includes(`dateTime="${source.verifiedOn}"`) || article.includes(`datetime="${source.verifiedOn}"`))
        && article.includes(source.url.replaceAll("&", "&amp;"));
      if (!matches) failures.push(`Missing or stale sitting ${s.exam_key}:${s.date}`);
    }
  } else {
    const key = route.split("/").at(-1);
    for (const ids of Object.values(P0_RULES)) for (const id of ids[key] ?? []) {
      const rule = data.rules.find((r) => r.id === id);
      const article = main.match(new RegExp(`<article\\b[^>]*data-rule="${id.replaceAll(".", "\\.")}"[^>]*>[\\s\\S]*?<\\/article>`))?.[0] ?? "";
      if (!article || !rule || !text(article).includes(text(rule.text[lang]))) failures.push(`Missing rendered rule ${id}`);
    }
  }
  return failures;
}

export function runFormatGate({ "base-url": baseUrl, out, "announcement-review": reviewFile }, get = curlGet, now = new Date()) {
  const today = viennaDay(now);
  const report = { checkedAt: now.toISOString(), viennaDay: today, baseUrl, ok: false, checks: [], sources: [] };
  try {
    const base = checkedUrl(baseUrl);
    if (new URL(base).pathname !== "/") throw new Error("Base URL must identify the site origin");
    const data = JSON.parse(readFileSync(path.join(repoRoot, "src/lib/exam-formats.data.json"), "utf8"));
    const { OFFICIAL_SITTINGS } = readTsExports(path.join(repoRoot, "src/lib/exam-dates.ts"));
    report.checks = validateData(data, OFFICIAL_SITTINGS, today);
    const review = reviewFile ? JSON.parse(readFileSync(reviewFile, "utf8")) : null;
    report.checks.push(...validateAnnouncementReview(review, data, today));
    for (const id of ["source-03", "source-05", "source-12"]) {
      const result = get(data.sources[id].url);
      report.sources.push({ id, url: result.url, effectiveUrl: result.effectiveUrl, httpStatus: result.httpStatus, sha256: result.sha256 });
      report.checks.push({ id: `INF-05.fetch.${id}`, ok: result.ok && sha(result.sha256), detail: "Same-day official source GET, content hash recorded; verify changed content against the cards" });
      if (id !== "source-05") report.checks.push({ id: `INF-05.review.${id}`, ok: result.sha256 === data.sources[id].sha256 && data.sources[id].verifiedOn === today,
        detail: "Fetched calendar/week document matches the same-day reviewed card source hash" });
    }
    for (const route of ["/exam-formats", ...Object.keys(P0_RULES["FMT-05"]).map((key) => `/exam-formats/${key}`)]) {
      for (const lang of ["de", "en"]) {
        const result = get(`${base.replace(/\/$/, "")}${route}?lang=${lang}`);
        const failures = validateSurface(result.body.toString(), route, lang, data, OFFICIAL_SITTINGS, today);
        report.checks.push({ id: `live.${route}.${lang}`, ok: result.ok && result.httpStatus === 200 && failures.length === 0, detail: failures.join("; ") || "P0 content rendered in the requested language" });
      }
    }
    report.ok = report.checks.every((c) => c.ok);
  } catch (error) { report.checks.push({ id: "gate-input", ok: false, detail: error.message }); }
  writeReport(out, report);
  for (const check of report.checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.id}: ${check.detail}`);
  return report.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const opts = options(process.argv.slice(2), ["base-url", "out", "announcement-review"]);
    if (!opts["base-url"] || !opts.out) throw new Error("Usage: node scripts/format-gate.mjs --base-url <site origin> --out <dated record.json> [--announcement-review <review.json>]");
    process.exitCode = runFormatGate(opts);
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
