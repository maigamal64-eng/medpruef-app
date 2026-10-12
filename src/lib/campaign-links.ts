/**
 * Tagged links for one community post (ADM-18 A, OW-46, a20 2026-10-12).
 *
 * Every Telegram post gets two links that carry the same campaign slug:
 *   - a site link: /landing?utm_source=telegram&utm_medium=post&utm_campaign=<slug>
 *   - a bot start link: t.me/MedPruefBot?start=c_<slug>
 * The bot turns a c_<slug> start into the same utm tags on its "open MedPrüf"
 * button (utm_medium=bot), so both paths land in the admin Growth "Sources"
 * table under one campaign. Pure and isomorphic: no data, no secrets.
 */

export const CAMPAIGN_BOT = "MedPruefBot";
export const CAMPAIGN_SOURCE = "telegram";
const SLUG_MAX = 40;

/** A post label ("Fristen 17 Okt") as a campaign slug ("fristen-17-okt"), or null. */
export function campaignSlug(label: string): string | null {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
  return slug ? slug : null;
}

/** Both tagged links for one post. */
export function buildCampaignLinks(slug: string, siteUrl = "https://medpruf.com") {
  const base = siteUrl.replace(/\/$/, "");
  const site = new URL(`${base}/landing`);
  site.searchParams.set("utm_source", CAMPAIGN_SOURCE);
  site.searchParams.set("utm_medium", "post");
  site.searchParams.set("utm_campaign", slug);
  return { site: site.toString(), bot: `https://t.me/${CAMPAIGN_BOT}?start=c_${slug}` };
}

/**
 * The campaign slug in a bot /start payload ("c_<slug>", optionally followed
 * by the existing _de/_en language suffix), or null. Only slug characters are
 * accepted, so nothing from the payload can reach a URL path.
 */
export function parseCampaignStart(payload: string | undefined | null): string | null {
  const match = payload?.match(/^c_([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)(?:_(?:de|en))?$/);
  return match ? match[1] : null;
}

/** The bot welcome button URL for a campaign start: the site entry plus utm tags. */
export function campaignWelcomeUrl(siteUrl: string, slug: string | null): string {
  const url = new URL(`${siteUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("tg_start", "1");
  if (slug) {
    url.searchParams.set("utm_source", CAMPAIGN_SOURCE);
    url.searchParams.set("utm_medium", "bot");
    url.searchParams.set("utm_campaign", slug);
  }
  return url.toString();
}
