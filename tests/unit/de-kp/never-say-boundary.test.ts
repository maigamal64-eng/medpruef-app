import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EXAM_SOURCE_IDS } from "@/lib/topics";
import { DE_KP_LAW_URL, deKpCopy } from "@/lib/de-kp/copy";

/** Spec 6.4 / acceptance test 5: two surfaces, no crossing. */
const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|json)$/.test(name)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const files = walk(SRC).map((p) => ({ p, r: rel(p) }));
const GERMANY = [/^src\/lib\/de-kp\//, /^src\/app\/kenntnispruefung-deutschland\//, /^src\/app\/api\/de-kp\//, /^src\/components\/de-kp\//];
const inGermany = (r: string) => GERMANY.some((re) => re.test(r));
const read = (p: string) => readFileSync(p, "utf8");

describe("KP-DE never-say boundary", () => {
  it("(a) src/lib/de-kp is imported only from the Germany surface, its API, its components, the flag-gated sitemap entry and its own tests", () => {
    const allowed = [...GERMANY, /^src\/app\/sitemap\.ts$/];
    const offenders = files.filter(({ p, r }) => !allowed.some((re) => re.test(r)) && /from\s+["']@\/lib\/de-kp(\/|["'])/.test(read(p))).map((f) => f.r);
    expect(offenders).toEqual([]);
  });

  it("(a) the sitemap imports only the flag reader (index), never the copy", () => {
    const text = read(path.join(SRC, "app/sitemap.ts"));
    const imports = [...text.matchAll(/from\s+["'](@\/lib\/de-kp[^"']*)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["@/lib/de-kp"]);
  });

  it("(b) the key de_kenntnispruefung is not in EXAM_SOURCES and appears nowhere outside the Germany surface", () => {
    expect((EXAM_SOURCE_IDS as string[]).includes("de_kenntnispruefung")).toBe(false);
    const offenders = files.filter(({ p, r }) => !inGermany(r) && read(p).includes("de_kenntnispruefung")).map((f) => f.r);
    expect(offenders).toEqual([]);
  });

  it("(b) Germany exam wording outside the Germany surface stays at the frozen baseline and never grows", () => {
    const BASELINE = new Set([
      "src/middleware.ts", "src/components/seo/ExamOrientation.tsx", "src/lib/exam-formats.data.json", "src/lib/guidance/routes.ts",
      "src/lib/master-locale/render.ts", "src/lib/changelog.ts", "src/lib/answer-pages/pages.data.json", "src/lib/answer-pages/copy.ts",
      "src/lib/mentor/tools/run.ts", "src/lib/mentor/answer-language.ts", "src/lib/mentor/prompt/system.ts", "src/lib/agent-docs/llms-txt.ts",
      "src/lib/guidance-data/orientation.data.json",
      // landing lead refresh (a-kp-landing-lead-1113): one line telling readers the Germany procedure is separate
      "src/components/seo/KenntnispruefungFunnel.tsx",
    ]);
    const hits = files.filter(({ p, r }) => !inGermany(r) && /Deutschland|German exam|DACH/.test(read(p))).map((f) => f.r);
    expect(hits.filter((r) => !BASELINE.has(r))).toEqual([]);
  });

  it("(b) no Austrian pricing, billing or i18n copy module links or names the Germany track", () => {
    const austrian = files.filter(({ r }) => /^src\/lib\/(i18n[^/]*\.ts|pricing-v2\/.*|billing-copy.*\.ts|content-truth\.ts)$/.test(r) || /^src\/app\/(landing|pricing)\//.test(r) || /^src\/components\/(Sidebar|BottomNav)\.tsx$/.test(r) || /^src\/lib\/nav-destinations\.ts$/.test(r));
    const offenders = austrian.filter(({ p }) => /kenntnispruefung-deutschland|Deutschland|German exam|DACH|de_kp/i.test(read(p))).map((f) => f.r);
    expect(offenders).toEqual([]);
  });

  it("(b) the only Austrian-side mention of the route is the sign-in return allowlist, the sitemap and the root JSON-LD exclusion", () => {
    const hits = files.filter(({ p, r }) => !inGermany(r) && /kenntnispruefung-deutschland/.test(read(p))).map((f) => f.r).sort();
    expect(hits).toEqual(["src/app/sitemap.ts", "src/lib/auth-entry.ts", "src/lib/root-jsonld.ts"]);
  });

  it("(c) the Germany copy has no general never-say word and no dash character", () => {
    const text = JSON.stringify([deKpCopy("de"), deKpCopy("en")]);
    for (const re of [/\bofficial\b/i, /\boffiziell/i, /\breal\b/i, /\brecalled\b/i, /altfrag/i, /altfall/i, /matches the exam/i, /exactly like the exam/i, /unlimited/i, /\bgratis\b/i, /\bechte[rsnm]?\b/i]) {
      expect(text).not.toMatch(re);
    }
    expect(text).not.toMatch(/[–—]/);
  });

  it("(c) Germany source files carry no dash character in learner copy files", () => {
    for (const r of ["src/lib/de-kp/copy.ts"]) expect(read(path.join(ROOT, r))).not.toMatch(/[–—]/);
  });

  it("names the exam with its legal basis on the landing, in both languages, and no pre-reform Land sheet", () => {
    for (const lang of ["de", "en"] as const) {
      const l = deKpCopy(lang).landing;
      const text = [l.lawBody, l.lawTiming, l.lawLink, l.lawRead, l.landNote].join(" ");
      expect(l.lawBody).toMatch(/BGBl\. 2026 I (Nr|No)\. 225/);
      expect(l.lawBody).toMatch(/(Nr|No)\. 326/);
      expect(l.lawBody).toMatch(/§ 37|section 37/);
      expect(l.lawBody).toMatch(/1 November 2026|1\. November 2026/);
      expect(l.lawBody).toMatch(/höchstens 20 Minuten|at most 20 minutes/);
      expect(l.lawBody).toMatch(/höchstens 30 Minuten|at most 30 minutes/);
      expect(l.lawBody).toMatch(/60 (bis|to) 90/);
      expect(text).not.toMatch(/NiZzA|Niedersachsen|Lower Saxony|Stand 1\. Januar 2026|1 January 2026/);
    }
    expect(DE_KP_LAW_URL).toBe("https://www.gesetze-im-internet.de/_appro_2002/__37.html");
  });

  it("the learner copy never names a pre-reform Land sheet, a pass rate, or other exams", () => {
    const text = JSON.stringify([deKpCopy("de"), deKpCopy("en")]);
    expect(text).not.toMatch(/NiZzA|nizza\.niedersachsen|alle Prüfungen|every exam|\bWien\b|Österreich|Austria|Vienna|\bSIP\b|Stichprobentest|\bKMP\b|Prozent der|pass rate/i);
  });

  it("the page says plainly what text practice cannot train", () => {
    expect(deKpCopy("de").honesty).toMatch(/körperliche Untersuchung.*mündliche Prüfungsgespräch/);
    expect(deKpCopy("en").honesty).toMatch(/physical examination.*spoken exam conversation/);
  });
});
