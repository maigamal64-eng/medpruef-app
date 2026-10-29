/**
 * a-seo-from-gsc (15 Oct 2026): search fixes from the Search Console read in
 * reports/gsc-2026-10-15/README.md (main checkout).
 *
 * - Canonicals for the guidance pages (unflagged): the root layout used to
 *   hand every page without its own canonical the /landing canonical, so the
 *   guidance pages told Google they were copies of /landing.
 * - SEO_GSC_COPY_ENABLED (server env, default OFF, only the literal "true"):
 *   new titles and descriptions, per-page guidance titles from the route
 *   registry, the Austrian scope line and the link block to the answer and
 *   sitting pages. Read when metadata is built, so static pages need a
 *   redeploy after a flip.
 */
import type { Metadata } from "next";
import { GUIDANCE_ROUTES } from "@/lib/guidance/routes";
import { OFFICIAL_KEYS_BY_BANK } from "@/lib/exam-dates";
import { answerPath, visibleAnswerPages } from "@/lib/answer-pages/registry";
import { isPastSitting, sittingDatesFrozen, sittingPages, sittingPagesEnabled, SITTING_PAGES_PATH } from "@/lib/sitting-pages";
import { SEO_COPY } from "@/lib/seo/gsc-copy";

type Env = Record<string, string | undefined>;
export type SeoBank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";
export interface SeoLink { href: string; label: { de: string; en: string }; hrefEn?: string }

export const SITE = "https://medpruf.com";

export const seoCopyEnabled = (env: Env = process.env) => env.SEO_GSC_COPY_ENABLED === "true";

/**
 * Self canonical per language plus DE/EN alternates for a guidance route
 * (the English page is ?lang=en and names itself, so Google can index it);
 * with the flag on, the registry label in that language as title.
 */
export function guidanceMetadata(path: string, env: Env = process.env, lang: "de" | "en" = "de"): Metadata {
  const route = GUIDANCE_ROUTES.find((r) => r.path === path);
  const de = `${SITE}${path}`;
  const en = `${SITE}${path}?lang=en`;
  const meta: Metadata = {
    alternates: { canonical: lang === "en" ? en : de, languages: { de, en } },
  };
  if (route && seoCopyEnabled(env)) meta.title = `${route.label[lang]} | MedPrüf`;
  return meta;
}

type LangSearch = { searchParams?: Promise<{ lang?: string | string[] }> };
const langOf = (v: string | string[] | undefined): "de" | "en" => ((Array.isArray(v) ? v[0] : v) === "en" ? "en" : "de");

/** generateMetadata for a guidance page: reads ?lang. */
export function guidanceMetadataFor(path: string) {
  return async ({ searchParams }: LangSearch): Promise<Metadata> =>
    guidanceMetadata(path, process.env, langOf((await searchParams)?.lang));
}

/** Title and description for a page that has SEO copy; the given fallback while the flag is off. */
export function pageCopy(
  key: keyof typeof SEO_COPY.pages,
  fallback: { title: string; description: string },
  env: Env = process.env,
): { title: string; description: string } {
  return seoCopyEnabled(env) ? SEO_COPY.pages[key] : fallback;
}

/** Answer pages (only listed ones) and the next sitting page per exam (only while sitting pages are on), for one bank or all. */
export function seoLinkHub(bank: SeoBank | "all", now: Date = new Date(), env: Env = process.env): { answers: SeoLink[]; sittings: SeoLink[] } {
  if (!seoCopyEnabled(env)) return { answers: [], sittings: [] };
  // Guides (a-seo-articles-1019): /landing ("all") lists them in its own block, so the hub skips them there.
  // a-guides-examweek-1029: exam-week guides lead their bank's hub and the Vienna bank page's hub.
  const answers = visibleAnswerPages(env)
    .filter((p) => bank !== "all" || !p.article)
    .filter((p) => bank === "all" || p.bank === bank || (p.exam_week && bank === "kenntnispruefung"))
    .sort((a, b) => Number(!!b.exam_week) - Number(!!a.exam_week))
    .map((p) => ({ href: answerPath(p, "de"), label: p.title, ...(p.en_slug ? { hrefEn: answerPath(p, "en") } : {}) }));
  const sittings: SeoLink[] = [];
  if (sittingPagesEnabled(env) && !sittingDatesFrozen(env)) {
    const keys = bank === "all" ? null : (OFFICIAL_KEYS_BY_BANK[bank] as readonly string[]);
    const seen = new Set<string>();
    for (const page of sittingPages()) {
      if (isPastSitting(page, now) || seen.has(page.label.de)) continue;
      if (keys && !keys.includes(page.examKey)) continue;
      seen.add(page.label.de);
      sittings.push({ href: `${SITTING_PAGES_PATH}/${page.slug}`, label: page.label });
    }
  }
  return { answers, sittings: sittings.slice(0, 6) };
}
