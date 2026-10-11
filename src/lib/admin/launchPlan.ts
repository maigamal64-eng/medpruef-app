// src/lib/admin/launchPlan.ts
//
// The MedPruf Launch Plan: the phased path to the first euro, the funnel model
// with editable projections, and the exact guided tasks [name] must do per phase.
//
// Authored 2026-06-27 ([name]). The BASELINE numbers are REAL, pulled from the
// production DB on 2026-06-27. The funnel ASSUMPTIONS are honest planning
// defaults (not inflated) and are editable live in /admin/launch so [name] can
// stress-test them. No em dashes in any string ([name]'s rule); Austrian framing.
//
// Consumed by: src/app/admin/launch/page.tsx (the interactive console).

export type TaskOwner = "[name]" | "done";
export type PhaseStatus = "done" | "active" | "next" | "later";

export interface LaunchStep {
  /** One concrete action. Keep it fast to execute. */
  do: string;
  /** Optional clickable target (admin route, external dashboard, or asset path). */
  link?: { label: string; href: string; external?: boolean };
}

export interface LaunchTask {
  id: string;
  title: string;
  /** Why it matters, in one honest line. */
  why: string;
  owner: TaskOwner;
  /** Rough time to do it, so [name] can batch. */
  est: string;
  steps: LaunchStep[];
}

export interface LaunchPhase {
  id: string;
  num: number;
  title: string;
  subtitle: string;
  goal: string;
  status: PhaseStatus;
  tasks: LaunchTask[];
}

/* ------------------------------------------------------------------ */
/* BASELINE (real, 2026-06-27) + prices                                */
/* ------------------------------------------------------------------ */

export const LAUNCH_BASELINE = {
  asOf: "2026-06-27",
  totalUsers: 117,
  signupsPerMonth: 9,
  mau: 23,
  wau: 11,
  activeAnswerersMonthly: 12,
  paidSubs: 0,
  checkoutAttemptsAllTime: 6,
};

export const PRICE_POINTS = {
  monthlyEur: 19,
  threeMonthEur: 49,
  sixMonthCohortEur: 129,
};

/* ------------------------------------------------------------------ */
/* FUNNEL MODEL                                                        */
/* The page renders each stage and lets [name] edit every assumption.    */
/* computeFunnel() is the single source of truth for the math.         */
/* ------------------------------------------------------------------ */

export interface FunnelAssumptions {
  /** How many value-first posts/emails get fired in the distribution push. */
  posts: number;
  /** Organic reach per post into the foreign-doctors-in-Austria niche. */
  reachPerPost: number;
  /** Reach -> site visit (value-first post, not a hard sell). */
  ctrToSite: number;
  /** Visit -> free signup (warm niche, free product to start). */
  visitToSignup: number;
  /** Signup -> activation (answered >= 10 questions, felt the value). */
  signupToActivation: number;
  /** Activated -> started checkout (hit the value ceiling / wanted more). */
  activationToCheckout: number;
  /** Checkout -> completed payment on Whop. */
  checkoutToPaid: number;
  /** Blended first payment value (most pick the 3-month at 49 EUR). */
  avgFirstPaymentEur: number;
}

// Honest planning defaults. End-to-end these put the first euro within ~1
// sustained distribution push, NOT one lucky post. Edit them in the UI.
export const FUNNEL_DEFAULTS: FunnelAssumptions = {
  posts: 8,
  reachPerPost: 600,
  ctrToSite: 0.03,
  visitToSignup: 0.18,
  signupToActivation: 0.5,
  activationToCheckout: 0.12,
  checkoutToPaid: 0.6,
  avgFirstPaymentEur: 49,
};

export interface FunnelStage {
  key: string;
  label: string;
  hint: string;
  value: number;
  /** Conversion from the previous stage (0..1), null for the first stage. */
  conversion: number | null;
}

export interface FunnelResult {
  stages: FunnelStage[];
  paid: number;
  firstEuroRevenueEur: number;
  /** Posts needed for >= 1 paid at the current assumptions (the headline number). */
  postsForFirstPaid: number;
}

export function computeFunnel(a: FunnelAssumptions): FunnelResult {
  const reach = a.posts * a.reachPerPost;
  const visits = reach * a.ctrToSite;
  const signups = visits * a.visitToSignup;
  const activated = signups * a.signupToActivation;
  const checkouts = activated * a.activationToCheckout;
  const paid = checkouts * a.checkoutToPaid;

  const stages: FunnelStage[] = [
    { key: "reach", label: "Reach", hint: "people who see a post", value: reach, conversion: null },
    { key: "visits", label: "Site visits", hint: "clicked through to medpruf.com", value: visits, conversion: a.ctrToSite },
    { key: "signups", label: "Free signups", hint: "created an account", value: signups, conversion: a.visitToSignup },
    { key: "activated", label: "Activated", hint: "answered 10+ questions", value: activated, conversion: a.signupToActivation },
    { key: "checkouts", label: "Checkouts started", hint: "opened Whop checkout", value: checkouts, conversion: a.activationToCheckout },
    { key: "paid", label: "Paid", hint: "completed payment", value: paid, conversion: a.checkoutToPaid },
  ];

  // Per-post yield of a paid user, used to back out posts-for-first-paid.
  const paidPerPost =
    a.reachPerPost *
    a.ctrToSite *
    a.visitToSignup *
    a.signupToActivation *
    a.activationToCheckout *
    a.checkoutToPaid;
  const postsForFirstPaid = paidPerPost > 0 ? Math.ceil(1 / paidPerPost) : Infinity;

  return {
    stages,
    paid,
    firstEuroRevenueEur: paid * a.avgFirstPaymentEur,
    postsForFirstPaid,
  };
}

/* ------------------------------------------------------------------ */
/* WHAT IS ALREADY SHIPPED (so [name] sees the readiness at a glance)     */
/* ------------------------------------------------------------------ */

export const ALREADY_SHIPPED: string[] = [
  "Product: full v3 design reimplementation live (all core + owed surfaces, dark mode, gamification).",
  "All 7 review-feedback items fixed and verified.",
  "Pricing locked at 19 / 49 / 129 EUR; Whop plans match; tier reflected across UI, settings, pricing, CTAs.",
  "Referral program made invite-only and toggleable (no accidental payouts).",
  "Payment rail wired (Whop card checkout) with full funnel observability at /admin/payments.",
  "Tracking wired: first-party events + GA4 + Clarity + Meta Pixel; signup conversion fires to GA and Meta.",
  "Find Your Path guided orientation live for confused candidates.",
  "Mobile bottom nav rebalanced; dark-mode contrast fixed to AA.",
];

/* ------------------------------------------------------------------ */
/* DISTRIBUTION ARSENAL - the 4 newly-built distribution integrations   */
/*                                                                      */
/* Authored 2026-06-29 ([name]). These are the channels [name] can fire     */
/* into the foreign-doctors-in-Austria niche (and across the portfolio).*/
/* Three need a one-time activation by [name] to go live; demand-research */
/* is already live. The activation steps mirror the Blink integrations  */
/* ACTIVATION.md so the cockpit and the disk agree. No em dashes.       */
/* ------------------------------------------------------------------ */

export type IntegrationStatus = "live" | "partial" | "needs-creds";

export interface IntegrationActivation {
  /** What [name] hands over to fire this channel. */
  provide: string;
  /** What providing it switches on. */
  unlocks: string;
  /** The exact steps, in order. */
  steps: string[];
  /** Activation order in the "what I need now" panel (lower fires first). */
  priority: number;
}

export interface Integration {
  key: string;
  name: string;
  /** The channels this integration reaches, in one line. */
  channels: string;
  status: IntegrationStatus;
  /** One line: what it does. */
  does: string;
  /** The concrete capabilities, each a bullet. */
  functionality: string[];
  /** One line: why it matters for MedPruf / the portfolio. */
  value: string;
  /** Null when nothing is required (already live). */
  activation: IntegrationActivation | null;
  /** Shown when activation is null (or as an aside): the optional note. */
  activationNote?: string;
}

export const INTEGRATIONS: Integration[] = [
  {
    key: "demand-research",
    name: "Demand Research",
    channels: "Hacker News · Stack Exchange · GitHub · GDELT · Google News",
    status: "live",
    does: "Unified read-only demand, intent, and trend mining across five sources.",
    functionality: [
      "Cross-source pain-point clustering (painpoints)",
      "Dev and founder pain mining (devdemand: HN + Stack Exchange + GitHub)",
      "Trend volume and recency (trends: GDELT + Google News)",
      "Strong-intent vs chatter separation",
    ],
    value:
      "Validate demand and mine real pain-point language across the whole portfolio. Strongest for the dev and founder projects ([name], Blink). The MedPruf audience is not on these platforms, so Reddit carries MedPruf.",
    activation: null,
    activationNote:
      "Already live. Optional only: a free Stack Exchange key + a GitHub token raise rate limits.",
  },
  {
    key: "reddit",
    name: "Reddit",
    channels: "Reddit (governed organic, LIVE bot, karma-gated)",
    status: "partial",
    does: "A live, value-first, health-gated Reddit cycle already runs on a real account. It does NOT need setup. It is deliberately holding at Level-0 (helpful comments, no MedPruf mention) until the account earns enough karma to mention the product safely.",
    functionality: [
      "LIVE: scheduled cycle (~/.claude/scheduled-tasks/medpruef-reddit-cycle) on a separate stealth account, via the CDP bot-browser; value-first, capped 3/run + 10/day",
      "Pain-point / intent mining + community mapping (research, live)",
      "Karma-aware escalation: it stays at Level-0 (no promo) until karma clears the safe threshold (~50); current karma ~4",
      "Governed only: vote + DM gated off, every call logged",
    ],
    value:
      "MedPruf's load-bearing organic channel. The rail is built and running; the real constraint is ACCOUNT KARMA, not creds. Posting the seed/promo now from a karma-4 account = near-instant ban, so the bot correctly holds. Nothing for [name] to set up or post here.",
    activation: null,
    activationNote:
      "Already live: no creds, no setup, and NOTHING for [name] to post. The bot runs value-first and holds at Level-0 because promo is unsafe until karma reaches ~50 (currently ~4). The open work is karma-building plus wiring the auto-escalation from Level-0 to a gentle mention once karma clears, an agent (Herold) task, not an [name] action. See reviews/trial-feedback-2026-07-01.md FB-09.",
  },
  {
    key: "bluesky",
    name: "Bluesky",
    channels: "Bluesky (AT Protocol)",
    status: "partial",
    does: "Research (live now, no creds) + governed organic posting. The only open organic-reach channel left in 2026.",
    functionality: [
      "Creds-free research: search posts, actors, feeds (works today)",
      "Governed posting: draft to queue to your confirm",
      "Like, repost, follow gated off; logged",
    ],
    value:
      "Net-new organic reach, free and open, where X and LinkedIn closed down.",
    activation: {
      provide: "A Bluesky handle + an app-password",
      unlocks: "posting (research already runs)",
      steps: [
        "bsky.social > Settings > Privacy and security > App passwords > create one",
        "Send BLUESKY_HANDLE + BLUESKY_APP_PASSWORD (the app-password, never the main password)",
      ],
      priority: 2,
    },
  },
  {
    key: "threads",
    name: "Threads",
    channels: "Threads (via our Meta rails)",
    status: "needs-creds",
    does: "Organic posting to Threads, riding the Meta integration we already own. Free, 250 posts/day.",
    functionality: [
      "Text and image posts through the same draft to queue to confirm cockpit gate as FB and IG",
      "Reaches the consumer and edtech audiences (MedPruf, Harmonia, Blink)",
      "FB and IG paths untouched (additive only)",
    ],
    value:
      "Free reach on rails we already control; highest setup-ROI of the posting channels.",
    activation: {
      provide: "Threads scopes + token on the Blink Meta app",
      unlocks: "Threads posting",
      steps: [
        "Add the Threads use-case + scopes threads_basic and threads_content_publish on the Blink Meta app",
        "Connect each brand's Threads account, exchange for a long-lived token",
        "Set THREADS_TOKEN in the Meta env + each brand's threads.user_id",
      ],
      priority: 3,
    },
  },
];

/* ------------------------------------------------------------------ */
/* THE PHASES + [name]'S GUIDED TASKS                                    */
/* ------------------------------------------------------------------ */

export const LAUNCH_PHASES: LaunchPhase[] = [
  {
    id: "phase-0",
    num: 0,
    title: "Pre-flight",
    subtitle: "Readiness",
    status: "active",
    goal:
      "The machine is built and ready to receive, convert, and measure. Three platform steps only you can do (they unlock measurement and prove the money rail) before we drive traffic.",
    tasks: [
      {
        id: "t0-ga",
        title: "GA4: mark sign_up a key event + link Google Ads",
        why: "Lets Google measure and optimize the signup conversion for the paid probe. Without it, paid traffic flies blind.",
        owner: "[name]",
        est: "15 min",
        steps: [
          { do: "Open Google Analytics, click Admin (gear, bottom-left), make sure the property is MedPruf (G-DP4CQQPZWF)." },
          { do: "Admin > Data display > Events. Find the sign_up event in the list. Toggle 'Mark as key event' ON." },
          { do: "If sign_up is not listed yet, it appears within ~24h of the first consented signup. You can also pre-create it: Key events > New key event > name it exactly sign_up." },
          { do: "Admin > Product links > Google Ads links > Link. Pick your Google Ads account, enable personalized advertising, Submit." },
          { do: "In Google Ads: Goals > Conversions > New > Import > Google Analytics 4 > select sign_up > Import." },
        ],
      },
      {
        id: "t0-pixel",
        title: "Meta: test-fire the Pixel",
        why: "Proves the Pixel and the CompleteRegistration conversion actually fire, so paid social can optimize to signups.",
        owner: "[name]",
        est: "10 min",
        steps: [
          { do: "Open Meta Events Manager and select the MedPruf Pixel." },
          { do: "Open the 'Test events' tab, enter https://medpruf.com, click 'Open website'." },
          { do: "On the site: ACCEPT the cookie banner first (the Pixel only fires on consent), then register a throwaway account." },
          { do: "Back in Test events, confirm a PageView and a CompleteRegistration event land for that session." },
        ],
      },
      {
        id: "t0-whop",
        title: "Whop: one real end-to-end test payment",
        why: "The payment rail has never once been completed end-to-end. Prove a real card payment grants Pro before you send buyers to it.",
        owner: "[name]",
        est: "10 min",
        steps: [
          { do: "Log in to medpruf.com as a normal (non-admin) test user." },
          { do: "Go to /pricing, pick the 19 EUR monthly, click through to Whop checkout, complete a real card payment.", link: { label: "Open /pricing", href: "/pricing" } },
          { do: "Confirm: you return to /checkout/success, your tier flips to Pro, and the payment shows grant_succeeded.", link: { label: "Check /admin/payments", href: "/admin/payments" } },
          { do: "Optional: refund yourself from the Whop dashboard afterwards." },
        ],
      },
    ],
  },
  {
    id: "phase-1",
    num: 1,
    title: "Distribution",
    subtitle: "The binding constraint",
    status: "next",
    goal:
      "Fire the loaded posts. Turn 0 outbound into the first real traffic. Everything upstream is ready; this is the ONE thing standing between us and the first euro. 0 posts = 0 traffic = 0 euros.",
    tasks: [
      {
        id: "t1-community",
        title: "Post the community seed-posts (see the pinned Action Queue card)",
        why: "This is the unlock. The judged-ready posts are staged and have never been fired. This is the SAME move as the pinned 'post-community-seeds' card at the top of this page, so do it there (it carries the exact per-target copy references); this row is the phase-plan pointer, not a second job.",
        owner: "[name]",
        est: "30 min",
        steps: [
          { do: "Use the pinned Action Queue card at the top of this page ('Post the community seed answers'). It has the exact posts-ready.md references per target (DE / EN / AR), value-first, no link in the opening post." },
          { do: "Where the audience is confused beginners, link /find-your-path instead of the homepage.", link: { label: "See /find-your-path", href: "/find-your-path", } },
        ],
      },
      {
        id: "t1-institutional",
        title: "Send the institutional referral emails",
        why: "Institutional reach compounds: one email to a coordinator can put MedPruf in front of a whole cohort. This is an EMAIL send, which the Concierge agent (Empfang) runs, so it does not need [name]'s hands, and the first round already went out.",
        owner: "done",
        est: "done",
        steps: [
          { do: "DONE (2026-06-24): the Concierge (Empfang) sent the DE, Lektor-passed institutional referral / free-resource emails to meded.at, ÖH Med Graz, and MedUni Wien Nostrifikation. Msg ids logged in MEDPRUF-COMMS-LOG.md (meded 1782329344933155100, ÖH Graz 1782329354056155100, MedUni Wien 1782329363003155100)." },
          { do: "HELD (agent task, not [name]'s): the arabmed.de bilingual send plus the Graz/Innsbruck Nostr. offices are pending address confirmation and the Arabic pass. Empfang fires them when ready. Replies to nurture come back through Empfang." },
        ],
      },
      {
        id: "t1-ownchannel",
        title: "Post to MedPruf's own FB + IG",
        why: "Your own channels are free and warm. Posting to FB + IG runs through the meta-social skill, so this is a Growth-agent (Herold) task, not [name]'s hands.",
        owner: "done",
        est: "done",
        steps: [
          { do: "DONE / ongoing (agent-run): the first MedPruf FB Page + Instagram posts shipped (from 2026-06-21). The ongoing own-channel cadence is Herold's via the meta-social skill (--business medpruef), so it does not need [name]." },
        ],
      },
    ],
  },
  {
    id: "phase-2",
    num: 2,
    title: "Conversion",
    subtitle: "The first euro",
    status: "later",
    goal:
      "Convert the new traffic into the first paying user. Watch the funnel daily, answer inbound fast, and nudge the people who hit checkout but did not finish. The first completed Whop payment is the milestone.",
    tasks: [
      {
        id: "t2-watch",
        title: "Watch the funnel daily (5 min)",
        why: "You cannot fix a drop you cannot see. The dashboards now show every stage.",
        owner: "[name]",
        est: "5 min/day",
        steps: [
          { do: "Open the growth funnel: reach, signups, activation.", link: { label: "/admin/growth", href: "/admin/growth" } },
          { do: "Open the payment funnel: checkout started, redirected, webhook, granted.", link: { label: "/admin/payments", href: "/admin/payments" } },
          { do: "Note the biggest drop-off stage. That is tomorrow's lever." },
        ],
      },
      {
        id: "t2-inbound",
        title: "Answer inbound fast",
        why: "A fast human reply converts a confused candidate. Find Your Path + the chat widget catch them; you close them.",
        owner: "[name]",
        est: "as it comes",
        steps: [
          { do: "Review first-party feedback submissions and the support@medpruf.com mailbox." },
          { do: "Reply within hours. Answer the real question (which exam, when, how to prep), then drop the Whop checkout link if they are ready." },
        ],
      },
      {
        id: "t2-nudge",
        title: "Nudge the almost-buyers",
        why: "Someone who opened checkout and did not pay is the warmest lead you will ever get.",
        owner: "[name]",
        est: "10 min",
        steps: [
          { do: "In /admin/payments, find checkout_started rows with no matching grant.", link: { label: "/admin/payments", href: "/admin/payments" } },
          { do: "Reach out with a short, warm nudge + the direct checkout link (use the targeted-user-comms approach, not a blast)." },
        ],
      },
    ],
  },
  {
    id: "phase-3",
    num: 3,
    title: "Repeat",
    subtitle: "Make it a machine",
    status: "later",
    goal:
      "Turn the first euro into a repeatable channel. Find what converted, do more of exactly that, and bank the first testimonial as social proof.",
    tasks: [
      {
        id: "t3-attribute",
        title: "Attribute the first paid user",
        why: "Knowing which post/channel produced the first euro tells you exactly where to spend the next hour.",
        owner: "[name]",
        est: "15 min",
        steps: [
          { do: "Trace the first paid user back through /admin/growth + their signup source." },
          { do: "Whatever channel produced them, post there again. Double down, do not diversify yet." },
        ],
      },
      {
        id: "t3-testimonial",
        title: "Get the first testimonial",
        why: "One real candidate's words lift every later conversion. Social proof is the cheapest conversion gain there is.",
        owner: "[name]",
        est: "15 min",
        steps: [
          { do: "Ask your first happy user (or first passer) for one line you can quote." },
          { do: "Add it to the landing + pricing pages (hand it to the MedPruf Content Steward to place on-brand)." },
        ],
      },
      {
        id: "t3-ladder",
        title: "Then: cohort + price ladder",
        why: "Only after the first euros and testimonials do you raise prices and run the guaranteed-cohort play. Not before.",
        owner: "[name]",
        est: "later",
        steps: [
          { do: "Once there are testimonials, run the cohort offer and step prices up toward 149 to 199." },
          { do: "Hold prices until then. Distribution and proof come first, price later." },
        ],
      },
    ],
  },
];
