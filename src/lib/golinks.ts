/**
 * Short campaign links /g/<code> (a-golinks, decision groups-links-images-1021).
 *
 * Group posts carry one short link (medpruf.com/g/<code>) instead of a long
 * UTM URL. The route 302s a visitor to the target with the full utm_* set, so
 * AttributionCapture stores the first touch and fires the landing beacon on
 * the target page exactly as for a long link (one landing_hits row, no double
 * count). Link-preview bots get a small HTML page with a per-code og:image.
 *
 * The registry is static on purpose: a code is a reviewed campaign, never a
 * user-supplied target, so the route cannot be used as an open redirect.
 */

export type GoLinkLang = "de" | "en" | "uk";

export interface GoLink {
  /** Same-origin path only (starts with "/", never "//"). */
  target: string;
  /** Row slug in growth-weekly/2026-10-19/new-groups/rolling.json. */
  campaign: string;
  lang: GoLinkLang;
}

const UTM_SOURCE = "telegram";
const UTM_MEDIUM = "community";
const UTM_CONTENT = "golink";

/** Path used when the target is switched off (for example /lernplan with its flag off). */
const FALLBACK_TARGET = "/landing";

export const GO_LINKS: Readonly<Record<string, GoLink>> = {
  dg: { target: "/lernplan", campaign: "doctors-at-route", lang: "en" },
  b2: { target: "/lernplan", campaign: "b2-bis-c2", lang: "de" },
  no: { target: "/lernplan", campaign: "nostrifizierung-oesterreich", lang: "de" },
  fsp: { target: "/lernplan", campaign: "fsp-erfahrungen-oesterreich", lang: "de" },
  ni: { target: "/lernplan", campaign: "nostrifizierung-innsbruck", lang: "de" },
  ua1: { target: "/lernplan", campaign: "ukrainiansaustria", lang: "uk" },
  ua2: { target: "/lernplan", campaign: "ua-vienna-domivka", lang: "uk" },
  ua3: { target: "/lernplan", campaign: "austriaukr", lang: "uk" },
  ua4: { target: "/lernplan", campaign: "ukrainiansandaustria", lang: "uk" },
  ph1: { target: "/lernplan", campaign: "pharma-gerichts-r1027", lang: "de" },
  ph2: { target: "/lernplan", campaign: "pharma-gerichts-r1103", lang: "de" },
};

const CODE_RE = /^[a-z0-9]{1,8}$/;

export function normalizeGoCode(raw: string): string | null {
  let c = String(raw ?? "");
  try { c = decodeURIComponent(c); } catch { return null; }
  c = c.trim().toLowerCase();
  return CODE_RE.test(c) ? c : null;
}

export function lookupGoLink(raw: string): GoLink | null {
  const c = normalizeGoCode(raw);
  return c && Object.prototype.hasOwnProperty.call(GO_LINKS, c) ? GO_LINKS[c] : null;
}

/**
 * Target path plus query for a code. The site has no Ukrainian UI, so uk and
 * en links open the English page (/lernplan reads ?lang; the /landing
 * fallback takes the browser language instead). `targetEnabled` lets the
 * route send a switched-off target to the fallback with the same attribution.
 */
export function goLinkDestination(link: GoLink, targetEnabled: boolean): string {
  const path = targetEnabled ? link.target : FALLBACK_TARGET;
  const q = new URLSearchParams();
  if (link.lang !== "de") q.set("lang", "en");
  q.set("utm_source", UTM_SOURCE);
  q.set("utm_medium", UTM_MEDIUM);
  q.set("utm_campaign", link.campaign);
  q.set("utm_content", UTM_CONTENT);
  return `${path}?${q.toString()}`;
}

/** Targets behind a feature flag (middleware turns them into a 404 while off). */
export function goTargetEnabled(target: string, env: Record<string, string | undefined> = process.env): boolean {
  if (target === "/lernplan") return env.STUDY_PLAN_PUBLIC_ENABLED === "true";
  return true;
}

/**
 * Link-preview fetchers that read og tags instead of following the redirect.
 * Search crawlers are not listed: they follow the 302 like a visitor.
 */
const PREVIEW_BOT_RE = /TelegramBot|facebookexternalhit|Facebot|WhatsApp|Twitterbot|LinkedInBot|Slackbot|Discordbot|Viber|SkypeUriPreview|vkShare|redditbot|Pinterestbot|Mastodon\/|Cardyb/i;

export function isPreviewBot(userAgent: string | null | undefined): boolean {
  return PREVIEW_BOT_RE.test(String(userAgent ?? ""));
}

const PREVIEW_COPY: Record<GoLinkLang, { title: string; description: string; htmlLang: string }> = {
  de: {
    title: "MedPrüf: In 3 Schritten starten",
    description: "Prüfung wählen, Lernplan ansehen, kostenlose Probefragen starten. Kuratierte Übungsfragen, keine offiziellen Prüfungsfragen.",
    htmlLang: "de",
  },
  en: {
    title: "MedPrüf: Start in 3 steps",
    description: "Pick your exam, see your study plan, try the free sample questions. Curated practice questions, not official exam questions.",
    htmlLang: "en",
  },
  uk: {
    title: "MedPrüf: Почніть за 3 кроки",
    description: "Оберіть свій іспит, перегляньте план підготовки, спробуйте безкоштовні пробні питання. Сайт німецькою та англійською. Добірні тренувальні питання, не офіційні екзаменаційні.",
    htmlLang: "uk",
  },
};

export function goOgImagePath(lang: GoLinkLang): string {
  return `/og/g-start-${lang}.png`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Neutral preview while the target is switched off (the 3-step image would promise a study plan). */
const FALLBACK_PREVIEW = {
  title: "MedPrüf",
  description: "Übungsfragen für die Nostrifizierung in Österreich. Practice questions for the Austrian Nostrifizierung.",
  image: "/brand/og-image.png",
};

/** Minimal page for preview bots: og tags, noindex, and a refresh to the destination. */
export function goPreviewHtml(link: GoLink, origin: string, destination: string, selfUrl: string, targetEnabled = true): string {
  const lc = PREVIEW_COPY[link.lang];
  const c = targetEnabled ? lc : { ...FALLBACK_PREVIEW, htmlLang: lc.htmlLang };
  const img = `${origin}${targetEnabled ? goOgImagePath(link.lang) : FALLBACK_PREVIEW.image}`;
  const dest = `${origin}${destination}`;
  return `<!doctype html><html lang="${c.htmlLang}"><head><meta charset="utf-8">
<title>${esc(c.title)}</title>
<meta name="robots" content="noindex,nofollow">
<meta name="description" content="${esc(c.description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MedPrüf">
<meta property="og:title" content="${esc(c.title)}">
<meta property="og:description" content="${esc(c.description)}">
<meta property="og:url" content="${esc(selfUrl)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(dest)}">
</head><body><a href="${esc(dest)}">medpruf.com</a></body></html>`;
}
