// Prices of the agent files (llms.txt, llms-full.txt), read from TIERS so a
// price change moves them with every other surface. Format "€19", as the
// agent files have always written it. The retired-price guard below is what
// the llms tests run against the v2 output (PRICING_V2_ENABLED on).
import { TIERS } from "@/lib/content-truth";

type PricedTier = Exclude<keyof typeof TIERS, "free">;

export function agentEur(tier: PricedTier): string {
  return `€${TIERS[tier].price_cents / 100}`;
}

// The line-up PRICING_V2_ENABLED replaces: its amounts, plan names and the
// guarantee wording must not survive anywhere in a v2 agent file.
const RETIRED_TIERS: readonly PricedTier[] = ["first_month_19", "first_3mo_27", "premium_pass_guaranteed"];
const V2_TIERS: readonly PricedTier[] = ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"];
const RETIRED_WORDS = [/\bCohort\b/i, /Pass-Until-You-Pass/i, /Prüfungs-Kohorte/i];

/** Retired amounts and words found in `text` (empty = clean). */
export function retiredPriceHits(text: string): string[] {
  const live = new Set(V2_TIERS.map((t) => TIERS[t].price_cents));
  const hits: string[] = [];
  for (const tier of RETIRED_TIERS) {
    const cents = TIERS[tier].price_cents;
    if (live.has(cents)) continue;
    const euros = cents / 100;
    const amount = `${euros}(?:[.,]00)?(?![\\d.,]\\d)(?!\\d)`;
    const re = new RegExp(`(?:€|EUR|Euro)\\s?${amount}|(?<![\\d.,])${amount}\\s?(?:€|(?:EUR(?!-)|Euros?)\\b)`, "i");
    if (re.test(text)) hits.push(`${tier} (${euros})`);
  }
  for (const word of RETIRED_WORDS) if (word.test(text)) hits.push(String(word));
  return hits;
}
