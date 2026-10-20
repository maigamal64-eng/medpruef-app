// Edge-safe gate data for the answer pages: slug and page conditions only,
// so middleware does not bundle the content. A unit test keeps this list
// equal to pages.data.json.
import { answerPagesEnabled } from "./flag";
import { mentorIncludedCopyEnabled, mentorPublicCopyEnabled } from "@/lib/mentor-public/flag";

type SlugGate = "mentor_public_copy" | "mentor_included_copy";

export const ANSWER_SLUG_GATES: Readonly<Record<string, readonly SlugGate[]>> = {
  "pruefungsausschreibung-pruefungskalender-wo": [],
  "pruefungsanmeldung-schritte-sip-stichprobentest": [],
  "sip-feedback-eliminiert-bedeutung": [],
  // Guides (a-seo-articles-1019, pages.articles.json), kept away from the first and
  // last lines so answer-page batches and gate-type changes merge without conflicts.
  "nostrifizierung-medizin-wien-ablauf-schritte": [],
  "stichprobentest-faecher-fragen-vorbereitung": [],
  "pruefungstermine-anmeldefristen-nostrifizierung": [],
  "rezeptierkunde-gerichtsmedizin-pflichtpruefungen": [],
  "pharmakologie-rezeptierkunde-vorbereitung": [],
  "deutschkenntnisse-nostrifizierung-c1-sprachpruefung": [],
  // English guide URLs (a-seo-articles-en-1019, en_slug in pages.articles.json).
  "nostrification-austria-medical-degree-vienna": [],
  "stichprobentest-austria-subjects-questions-preparation": [],
  "nostrification-exam-dates-registration-deadlines-austria": [],
  "rezeptierkunde-forensic-medicine-mandatory-exams": [],
  "pharmacology-rezeptierkunde-exam-preparation-vienna": [],
  "german-language-c1-nostrification-medical-chamber-exam": [],
  // Batch-2 guides (a-seo-guides-b2-de-1019), German then English URLs.
  "sip4a-sip5a-pruefungsteile-nostrifizierung": [],
  "ergaenzungspruefungen-innsbruck-nach-stichprobentest": [],
  "nostrifizierung-dauer-kosten-ueberblick": [],
  "aerzteliste-berufsberechtigung-nach-nostrifizierung": [],
  "facharzt-allgemeinmedizin-anrechnung-ausbildung-ausland": [],
  "nostrifizierung-lernen-neben-dem-beruf": [],
  "sip4a-sip5a-vienna-exam-parts-nostrification": [],
  "supplementary-exams-innsbruck-after-stichprobentest": [],
  "nostrification-austria-duration-costs": [],
  "aerzteliste-medical-licence-austria-after-nostrification": [],
  "specialist-training-austria-foreign-training-credit": [],
  "nostrification-exam-study-while-working": [],
  "pruefungsformat-mc-kaf-wann-bekannt": [],
  "stichprobentest-fristen-meduni-wien-innsbruck": [],
  "sip-stichprobentest-kenntnispruefung-unterschied": [],
  "kostenlose-probe-was-umfasst": [],
  "ki-mentor-credits-wie-funktioniert": ["mentor_public_copy", "mentor_included_copy"],
};

/**
 * German slug to English slug of the guides with their own English URL
 * (a-seo-articles-en-1019). A unit test keeps it equal to pages.articles.json.
 */
export const ANSWER_EN_SLUGS: Readonly<Record<string, string>> = {
  "nostrifizierung-medizin-wien-ablauf-schritte": "nostrification-austria-medical-degree-vienna",
  "stichprobentest-faecher-fragen-vorbereitung": "stichprobentest-austria-subjects-questions-preparation",
  "pruefungstermine-anmeldefristen-nostrifizierung": "nostrification-exam-dates-registration-deadlines-austria",
  "rezeptierkunde-gerichtsmedizin-pflichtpruefungen": "rezeptierkunde-forensic-medicine-mandatory-exams",
  "pharmakologie-rezeptierkunde-vorbereitung": "pharmacology-rezeptierkunde-exam-preparation-vienna",
  "deutschkenntnisse-nostrifizierung-c1-sprachpruefung": "german-language-c1-nostrification-medical-chamber-exam",
  "sip4a-sip5a-pruefungsteile-nostrifizierung": "sip4a-sip5a-vienna-exam-parts-nostrification",
  "ergaenzungspruefungen-innsbruck-nach-stichprobentest": "supplementary-exams-innsbruck-after-stichprobentest",
  "nostrifizierung-dauer-kosten-ueberblick": "nostrification-austria-duration-costs",
  "aerzteliste-berufsberechtigung-nach-nostrifizierung": "aerzteliste-medical-licence-austria-after-nostrification",
  "facharzt-allgemeinmedizin-anrechnung-ausbildung-ausland": "specialist-training-austria-foreign-training-credit",
  "nostrifizierung-lernen-neben-dem-beruf": "nostrification-exam-study-while-working",
};

/**
 * Where a guide URL asking for the other language lives, as path plus query, or null.
 * The German slug with ?lang=en and the English slug with ?lang=de move to the other
 * URL; every other query parameter (utm_*) is kept. Middleware answers it with a 308,
 * since a redirect from the streamed page would be a 200 with a meta refresh.
 */
export function answerLangRedirect(pathname: string, search: URLSearchParams): string | null {
  const match = /^\/blog\/([^/]+)\/?$/.exec(pathname);
  const asked = search.get("lang")?.toLowerCase();
  if (!match || (asked !== "de" && asked !== "en")) return null;
  const slug = match[1];
  const english = Object.prototype.hasOwnProperty.call(ANSWER_EN_SLUGS, slug) ? ANSWER_EN_SLUGS[slug] : undefined;
  const german = english ? null : Object.keys(ANSWER_EN_SLUGS).find((de) => ANSWER_EN_SLUGS[de] === slug) ?? null;
  const target = asked === "en" && english ? english : asked === "de" && german ? german : null;
  if (!target) return null;
  const rest = new URLSearchParams(search);
  rest.delete("lang");
  const qs = rest.toString();
  return `/blog/${target}${qs ? `?${qs}` : ""}`;
}

/** True when `pathname` is an answer page that must not be served now. */
export function answerPathBlocked(pathname: string, env: Record<string, string | undefined> = process.env): boolean {
  const match = /^\/blog\/([^/]+)\/?$/.exec(pathname);
  if (!match) return false;
  // Next.js decodes the segment for the route, so match the decoded slug too
  // (an encoded "%73ip-..." would otherwise pass the gate as a 200 not-found).
  let slug = match[1];
  try { slug = decodeURIComponent(slug); } catch { /* malformed escape: keep raw */ }
  // Own keys only: "constructor" or "__proto__" must not reach the gate list (a 500 in middleware).
  if (!Object.prototype.hasOwnProperty.call(ANSWER_SLUG_GATES, slug)) return false;
  if (!answerPagesEnabled(env.ANSWER_PAGES_ENABLED)) return true;
  // Read at request time from the edge runtime's env (not inlined at build): Vercel and
  // `next start` expose NEXT_PUBLIC_MENTOR_PUBLIC_COPY there, matching the build-time page flag.
  return ANSWER_SLUG_GATES[slug].some((c) => c === "mentor_public_copy"
    ? !mentorPublicCopyEnabled(env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY)
    : !mentorIncludedCopyEnabled(env.NEXT_PUBLIC_MENTOR_INCLUDED_COPY, env.NEXT_PUBLIC_MENTOR_PUBLIC_COPY));
}
