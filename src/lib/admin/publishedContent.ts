/**
 * Channels & Published — the distribution strategy + what was ACTUALLY
 * published per channel + its results.
 *
 * WHY THIS FILE EXISTS: the deployed admin (on Vercel) cannot read the
 * workspace logs where channel activity lives (the Reddit bot's
 * `reddit-activity.jsonl`, the `marketing/*` docs, the meta-social posts).
 * So this is the committed bridge: the fleet updates THIS file when it
 * posts / sends / publishes, and `/admin/growth` (Channels & Published)
 * renders it. It is the single on-app source of "what we put out and what
 * it produced." Keep it HONEST: never invent a reach/reply number — if a
 * metric is not instrumented yet, say so.
 *
 * HOW TO UPDATE (fleet): add a `PublishedItem` when something ships; update
 * its `results`/`metrics` when data comes back; flip a `StrategyTier.status`
 * as the plan moves. Bump `PUBLISHED_LAST_UPDATED`.
 *
 * Source of the strategy: marketing/research/channel-allocation-fire-list-2026-06-29.md
 * Source of the Reddit results: blink-studio/integrations/bot-browser/log/reddit-activity.jsonl
 * Source of the DMs: marketing/outreach/closed-core-dms-2026-06-29.md
 */

export type ChannelKey =
  | "reddit"
  | "telegram"
  | "facebook"
  | "instagram"
  | "bluesky"
  | "email"
  | "shortvideo"
  | "googleads";

export const CHANNEL_LABEL: Record<ChannelKey, string> = {
  reddit: "Reddit",
  telegram: "Telegram",
  facebook: "Facebook",
  instagram: "Instagram",
  bluesky: "Bluesky",
  email: "Email",
  shortvideo: "Short video",
  googleads: "Google Ads",
};

export type TierStatus = "running" | "ready" | "pending-[name]" | "later";

export interface StrategyTier {
  tier: 1 | 2 | 3 | 4;
  label: string;
  /** Cash cost framing. */
  cash: string;
  status: TierStatus;
  /** The named moves / targets for this tier. */
  moves: string[];
  rationale: string;
}

export type PublishStatus = "published" | "queued" | "drafted" | "sent";

export interface PublishedItem {
  id: string;
  channel: ChannelKey;
  /** ISO date (YYYY-MM-DD), or a range label for ongoing work. */
  date: string;
  kind: "comment" | "post" | "dm" | "reel" | "video" | "seed" | "reply";
  summary: string;
  link?: string;
  status: PublishStatus;
  /** Honest result note. If not instrumented yet, say so plainly. */
  results: string;
  /** Optional hard metrics (only real, verified numbers). */
  metrics?: { label: string; value: string }[];
}

export const PUBLISHED_LAST_UPDATED = "2026-06-30";

/**
 * THE STRATEGY (the channel-allocation fire-list, 2026-06-29).
 * Decided verdict: the warm leads sit behind gatekeepers + one empty
 * content lane, so the constraint is access + owned content, NOT cash.
 * Paid is a complement (Telegram = buy direct from Framko's admin, no
 * reseller; Meta retargeting on the live Pixel), never the lever.
 */
export const CHANNEL_STRATEGY: StrategyTier[] = [
  {
    tier: 1,
    label: "Partnership / referral DMs (the closed core)",
    cash: "€0",
    status: "pending-[name]",
    moves: [
      "Framko (Telegram 5.7K): partnership + buy-a-post-direct",
      "AMGOE + Egyptian Medical Society Austria (FB): referral/listing ask",
      "NostriFIT (Vienna prep): offer the free QBank",
      "MedLicense Austria: partner/monitor",
    ],
    rationale:
      "The warmest, highest-fit audiences (esp. the Arabic/Egyptian core) live in closed groups paid cannot reach. Outreach is the only key. Drafted + ready; needs [name]'s hand (and AR sign-off).",
  },
  {
    tier: 2,
    label: "Faceless short video (own the empty Austria lane)",
    cash: "~€0",
    status: "ready",
    moves: [
      "Countdown to Kenntnisprüfung Wien (28 Sep) / Stichprobentest Graz (23 Sep)",
      "One KP question in 45s",
      'Egyptian-Arabic "النمسا، مش ألمانيا" cut (AR sign-off)',
    ],
    rationale:
      "The only gatekeeper-free channel; Austrian-recognition short video is empty whitespace (competitor has 85 followers). Compounding moat; slow to a euro.",
  },
  {
    tier: 3,
    label: "Value-first community presence (running)",
    cash: "€0",
    status: "running",
    moves: [
      "Reddit bot: value-first, diversifying off r/approbation",
      "FB diaspora groups + Facharzt-JETZT Telegram folder",
    ],
    rationale:
      "Credibility groundwork while karma builds. Reddit's Austria-specific volume is thin (mostly Germany-adjacent), so this is a slow burn, not acquisition.",
  },
  {
    tier: 4,
    label: "Google Ads: thin capture sliver (later)",
    cash: "small",
    status: "later",
    moves: ["Brand + the 3 exact-exam ad groups only, €5-10/day"],
    rationale:
      "Only after the sign_up conversion import is live. Low search volume caps scale; a sliver, not the bet. Hold the cash until organic proves the economics.",
  },
];

/**
 * WHAT WAS ACTUALLY PUBLISHED + RESULTS. Honest only.
 * Reddit numbers are from the bot's verified-live log (8 comments,
 * 06-29 → 06-30; one reply received; comment-karma 1 → 2; 0 removed).
 */
export const PUBLISHED: PublishedItem[] = [
  {
    id: "reddit-2026-06-29-run",
    channel: "reddit",
    date: "2026-06-29",
    kind: "comment",
    summary:
      "8 value-first comments on foreign-doctor recognition logistics (r/approbation, r/germany, r/Medizinstudium). Level-0: genuinely helpful, no MedPrüf mention while karma is low.",
    link: "https://www.reddit.com/user/Desperate-Silver-624/",
    status: "published",
    results:
      "All 8 verified live, 0 removed, health green. A user REPLY landed on r/approbation (warm continuation): the topic (recognition logistics) is what works. Concentration risk flagged: 5/8 in r/approbation, now diversifying.",
    metrics: [
      { label: "Comments live", value: "8" },
      { label: "Replies received", value: "1" },
      { label: "Comment karma", value: "1 → 2" },
      { label: "Removed", value: "0" },
    ],
  },
  {
    id: "reddit-2026-06-29-reply",
    channel: "reddit",
    date: "2026-06-29",
    kind: "reply",
    summary:
      'The warm reply: a follow-up on the "Laminated MBBS degree" r/approbation thread (corrected a doc-verification misread + gave Brandenburg-vs-Thüringen comparison axes, no fabrication).',
    link: "https://www.reddit.com/r/approbation/comments/1u8a4hn/laminated_mbbs_degree_and_marksheet/ouj32kl/",
    status: "published",
    results: "Verified live (score 2). The one warm back-and-forth so far; double down on the recognition-logistics topic across more subs.",
  },
  {
    id: "telegram-framko-dm",
    channel: "telegram",
    date: "2026-06-30",
    kind: "dm",
    summary:
      "Framko admin DM (partnership + referral + buy-a-sponsored-post-direct). Reaches the 5.7K Austria-Nostrifizierung audience without a reseller deposit.",
    status: "drafted",
    results: "Ready to send (EN). Awaiting [name]'s hand. No spend to initiate.",
  },
  {
    id: "fb-amgoe-dm",
    channel: "facebook",
    date: "2026-06-30",
    kind: "dm",
    summary:
      "AMGOE (Arab Medical Association in Austria) referral/listing ask: add the free 450-Q Austrian bank to their recognition resources.",
    status: "drafted",
    results: "Drafted EN + Egyptian-Arabic. AR awaits [name]'s sign-off.",
  },
  {
    id: "fb-egyptian-society-dm",
    channel: "facebook",
    date: "2026-06-30",
    kind: "dm",
    summary:
      "Egyptian Medical Society Austria (FB group): value-first share to the Egyptian-doctor core, permission-first to the admin.",
    status: "drafted",
    results: "Drafted Egyptian-Arabic + EN. AR awaits [name]'s sign-off. Highest cultural fit.",
  },
  {
    id: "meta-launch-posts",
    channel: "instagram",
    date: "2026-06-21",
    kind: "post",
    summary:
      "FB + IG launch posts (branded exam-date + 'Austria not Germany' creatives, not app screenshots).",
    status: "published",
    results: "Shipped to FB Page + @medprufeu. Reach/engagement not yet pulled into this dashboard (Meta insights not instrumented).",
  },
  {
    id: "bluesky-lina",
    channel: "bluesky",
    date: "ongoing",
    kind: "post",
    summary:
      'Bluesky persona "Lina Karam" (@drlinakaram): value-first MedPrüf-coach posting into the foreign-doctor / Austria-exam conversation.',
    status: "published",
    results: "Account active. Engagement not yet instrumented into this dashboard.",
  },
];
