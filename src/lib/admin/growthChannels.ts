/**
 * growthChannels — the STATIC reach surfaces behind /admin/growth (Autonomy
 * Control Plane, AUTONOMY.md F-08, the GROWTH process). The reach/distribution
 * counterpart to processRegistry: hand-maintained consts rendered in-panel, not
 * a live feed.
 *
 * ONE OWNER PER FACT (do not let these drift):
 *   - PRESENCE_CHANNELS mirrors marketing/presence/presence-console.html (the 11
 *     platforms, their handles, and which are stood up). When a profile goes
 *     live or a handle changes there, update it here in the same change.
 *   - CAMPAIGNS mirrors MEDPRUF-CAMPAIGNS.md (the community + own-channel
 *     queue). When Herold posts/queues something there, reflect the status here.
 *   - EXPERIMENTS folds the revived Funnels + Experiments stubs (AUTONOMY.md
 *     F-01): none are running yet — an empty array with the planned note below.
 *
 * Growth owns reach/funnel; euros stay on the control plane. Nothing here is a
 * money figure — the live funnel counts come from growthMetrics via the API.
 */

export type ChannelStatus = "live" | "ready" | "planned";

export interface PresenceChannel {
  /** Display name of the platform. */
  name: string;
  /** The MedPrüf handle / route on that platform. */
  handle: string;
  /**
   * live   = profile stood up and posting,
   * ready  = handle + copy + assets prepared, not yet created/published,
   * planned= on the roadmap, not yet prepared.
   */
  status: ChannelStatus;
}

/**
 * The 11 platforms from the presence console. LIVE today (per
 * MEDPRUF-CAMPAIGNS.md): the Facebook Page, Instagram @medprufeu, and the Whop
 * store. The rest are READY (handle + bilingual copy + assets prepared in the
 * presence console, profile not yet created/published).
 */
export const PRESENCE_CHANNELS: ReadonlyArray<PresenceChannel> = [
  { name: "Facebook Page", handle: "@medpruef", status: "live" },
  { name: "Instagram", handle: "@medprufeu", status: "live" },
  { name: "Whop store", handle: "whop.com/medpruf", status: "live" },
  { name: "LinkedIn Company Page", handle: "MedPrüf", status: "ready" },
  { name: "Reddit", handle: "u/MedPruef · r/MedPruef", status: "ready" },
  { name: "Telegram channel", handle: "@MedPruef", status: "ready" },
  { name: "X / Twitter", handle: "@medpruef", status: "ready" },
  { name: "YouTube", handle: "@medpruef", status: "ready" },
  { name: "TikTok", handle: "@medpruef", status: "ready" },
  { name: "WhatsApp Business", handle: "[phone]", status: "ready" },
  { name: "Threads", handle: "@medpruef", status: "ready" },
] as const;

export interface Campaign {
  /** Where it runs (community or own channel). */
  channel: string;
  /** The angle / hook. */
  angle: string;
  /** drafted = written, not posted; queued = in the publish queue, pending
   *  approval; live = posted. */
  status: "drafted" | "queued" | "live";
}

/**
 * The campaign pipeline from MEDPRUF-CAMPAIGNS.md — the ranked community-entry
 * queue (participate-only, no-link, pending [name] sign-off + Lektor SoT-check)
 * plus the own-channel queue (FB Page + IG, posted via the Meta integration).
 * Lead every message with the correct exam date (SoT §1).
 */
export const CAMPAIGNS: ReadonlyArray<Campaign> = [
  // Own-channel queue (FB Page + IG @medprufeu, via the Meta integration).
  {
    channel: "FB Page + IG",
    angle: "Exam calendar (28 Sep + Ende-Juli deadline)",
    status: "live",
  },
  {
    channel: "FB Page + IG",
    angle: "Austria is not Germany — why the prep differs",
    status: "queued",
  },
  {
    channel: "FB Page + IG",
    angle: "AI explains any question",
    status: "queued",
  },
  {
    channel: "FB Page + IG",
    angle: "Study plan that counts down to exam day",
    status: "queued",
  },
  {
    channel: "FB Page + IG",
    angle: "The free 150-question sample",
    status: "queued",
  },
  // Community-entry queue (participate-only, no link until asked).
  {
    channel: "FB · Doctors in Austria / الأطباء العرب في النمسا",
    angle: "Austria-specific moat (participate-only)",
    status: "drafted",
  },
  {
    channel: "Telegram · Framko врачи в Австрии (5.7K)",
    angle: "Pass-Until-You-Pass (participate-only)",
    status: "drafted",
  },
  {
    channel: "MEDI-LEARN Foren (Austria thread)",
    angle: "Genuinely-helpful answer (participate-only)",
    status: "drafted",
  },
  {
    channel: "Institutional (meded.at, ÖH Med Graz, arabmed.de, MedUni)",
    angle: "Referral intro emails",
    status: "drafted",
  },
];

export interface Experiment {
  /** What is being tested. */
  name: string;
  /** The metric it moves. */
  metric: string;
  status: "running" | "planned";
}

/**
 * The revived Funnels + Experiments stubs (AUTONOMY.md F-01) fold here. NONE is
 * running yet — growth is still at the get-the-funnel-instrumented stage. The
 * live funnel itself (signups → activated → engaged → paying) is measured by
 * growthMetrics; structured A/B experiments come once there is enough traffic
 * to power them. Planned first tests: landing-headline (Austria-moat vs
 * Pass-Until-You-Pass vs ~12x-cheaper), and the free-150-sample CTA placement.
 */
export const EXPERIMENTS: ReadonlyArray<Experiment> = [] as const;

/** The plain note shown when no experiments are running. */
export const EXPERIMENTS_EMPTY_NOTE =
  "None running yet. Planned: landing-headline test (Austria-moat vs Pass-Until-You-Pass vs ~12x-cheaper) and the free-150-sample CTA placement, once traffic can power them.";
