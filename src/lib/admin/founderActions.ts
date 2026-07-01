/**
 * founderActions: the Action Queue — every item that needs [name]'s own hands
 * (AUTONOMY.md follow-on, STATIC). His command center.
 *
 * Hand-maintained, machine-readable list of the steps the fleet cannot take
 * for him: posting AS HIMSELF in a forum/group, a real card payment on his
 * card, linking his Google Ads, pasting an IG DM the API cannot send. Each
 * carries WHY it matters, WHAT he must provide, and the exact step-by-step
 * guide ([name] wants step-by-step, not a one-liner).
 *
 * PRIORITY ORDER (2026-06-24 round-3 fleet reflection, rail note refreshed
 * 2026-07-01): the binding constraint is TOP-OF-FUNNEL, not the rail. As of
 * 2026-07-01 the rail is no longer a 0-attempt story — the €0 card trial fired
 * a full checkout → webhook → grant → Pro (payment_events has one
 * grant_succeeded), so the grant pipeline is PROVEN; only a real nonzero PAID
 * charge is still unproven. So the queue still leads with the highest-leverage
 * distribution move (firing the loaded, judged-ready community seeds), THEN the
 * rail/tracking verifications that gate paid spend. Array order IS priority
 * order, so the top card is the most leveraged move, not necessarily a hard gate.
 *
 * One owner per fact: the meeting reflections + posts-ready pack own the prose
 * (reviews/meeting3-2026-06-24/*, reviews/meeting2-2026-06-24/posts-ready.md);
 * this const is the mirror the superadmin Action Queue reads. When a draft or a
 * blocker changes, update this file in the same change.
 *
 * Operator-honest status: "ready" = staged/judged and waiting only on [name] to
 * fire it; "blocking" = paid acquisition is not sound until it clears;
 * "optional" = real but lower priority. The TOP item is `ready` on purpose
 * (the seeds are loaded; firing them is the move), and the rail/tracking
 * blockers follow because they gate the SPEND, not the free organic seed.
 *
 * Every card must pass the STANDING RULE documented above the ACTIONS_INTRO_NOTE
 * (a machine-checkable done-when predicate + an owner-only hand); when a card's
 * done-when goes true, or the fleet can do it, pull it — do not re-show it.
 *
 * IMPORTANT: this module is PURE DATA (consts + types + a one-owner comment).
 * It must stay free of any server import or exported function so the client
 * page /admin/actions can import it directly without dragging a server-only
 * module (or a non-action function) into the client bundle.
 */

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** Which lane the action moves. Drives the category tag on the card. */
export type ActionCategory = "Revenue" | "Tracking" | "Growth" | "Content";

/**
 * Lifecycle:
 *  - blocking: a hard gate; paid acquisition is not sound until it clears.
 *  - ready: staged/judged and waiting only on [name] to fire it.
 *  - optional: real, but lower priority.
 */
export type ActionStatus = "blocking" | "ready" | "optional";

export interface FounderAction {
  /** Stable id (post-community-seeds, verify-whop-rail, …). */
  id: string;
  /** Short imperative title. */
  title: string;
  /** One line: why this is on [name]'s plate. */
  why: string;
  /** Which lane it moves. */
  category: ActionCategory;
  /** Gate status: blocking / ready / optional. */
  status: ActionStatus;
  /** What [name] must provide or personally do (a forum login, a card, a paste). */
  needs: string;
  /** Exact step-by-step guide, in order. */
  steps: string[];
}

// ═══════════════════════════════════════════════════════════════════
// The queue — priority order (highest-leverage first)
// ═══════════════════════════════════════════════════════════════════

export const ACTIONS: ReadonlyArray<FounderAction> = [
  {
    id: "post-community-seeds",
    title: "Post the community seed answers (the highest-leverage move)",
    why: "Top-of-funnel is the confirmed bottleneck (0 completed purchases ever; the only Whop grant so far is your own €0 trial test); these judged-ready, free, participate-only posts put real candidates into the funnel. learn-rx has a product but near-zero audience, so the window is open NOW.",
    category: "Growth",
    status: "ready",
    needs: "Your own account on each forum/group. Post AS YOURSELF, value-first, with NO link and NO product mention (a link or a fresh account risks a ban). All copy is in reviews/meeting2-2026-06-24/posts-ready.md.",
    steps: [
      "TARGET 2 (DE) NOW: open MEDI-LEARN Foren, find the live 'Kenntnisprüfung Österreich / Nostrifikation in AT' thread, and paste the German text from posts-ready.md §1 as a reply. No link, no product mention.",
      "TARGET 5 (EN) NOW: open studentdoctor.net, find the 'Practicing in Austria' thread, skim SDN's posting rules, and paste the English text from posts-ready.md §2 as a reply. No link, no product mention.",
      "TARGET 1 (AR) after a 30-second register glance: this is the #1-ranked pool (a real Arab-doctors-in-Austria FB group with a live audience, vs our ~0-follower own page). Open Herold's AR sign-off pack in reviews/meeting3-2026-06-24/herold.md §2 and confirm the 4 calls (Egyptian register, the two-route descriptions + Graz-not-Innsbruck, Arabic-Indic numerals, no-link/no-em-dash).",
      "On your 'yes': open the FB group 'Doctors in Austria / الأطباء العرب في النمسا', find a relevant prep question thread (or post fresh), and paste the Arabic text from posts-ready.md §3. No link, no product mention.",
      "If anyone asks for the tool, share medpruf.com only in a reply, never in the opening post. A buyer who replies goes to Empfang.",
    ],
  },
  {
    id: "monitor-notes-explore",
    title: "Watch the Explore moderation queue (community notes are LIVE)",
    why: "Community notes / Explore is now LIVE (NOTES_EXPLORE_ENABLED=true, 2026-07-01): users can publish notes publicly (anonymous-by-default, behind a pre-publish PII/quality scan + the 'community, not verified' label). Public health content is the standing risk, so the one ongoing action is to watch the takedown queue.",
    category: "Content",
    status: "optional",
    needs: "~5 min, periodically. The moderation queue is at /admin/note-reports; set NOTES_EXPLORE_ENABLED=false to pull ALL public notes instantly if needed.",
    steps: [
      "Open /admin/note-reports periodically and action any reported note (takedown / dismiss).",
      "Spot-check the public Explore feed for anything off (medical misinformation, PII the scan missed).",
      "If a real problem surfaces, set NOTES_EXPLORE_ENABLED=false to pull all public notes at once, then investigate.",
    ],
  },
  {
    id: "verify-whop-paid-charge",
    title: "Prove a real PAID Whop charge grants Pro (one-time €19)",
    why: "The Whop grant pipeline is already PROVEN end to end: the €0 card trial fired checkout → webhook (signature valid) → grant_succeeded → Pro on 2026-07-01. What has NEVER cleared is a real, nonzero card charge. The paid €19 one-time plan runs the identical webhook code as the trial (same plan→tier map, same 1-month grant), so the only unproven step is a real card clearing Whop's processor on a paid plan. One €19 charge closes that last gap before any ad spend.",
    category: "Revenue",
    status: "blocking",
    needs: "Your own card and ~3 minutes (refundable to yourself after). The €19 single-month plan is plan_redacted07253e20. This is the one proof no agent can run: it needs a real card and a real charge.",
    steps: [
      "Open medpruf.com/pricing while logged in as a real test user (NOT the bare whop.com/medpruf link, which arrives unmapped).",
      "Start the Whop checkout on the €19 single-month plan and complete a real card payment to the end (do not abandon at the Whop screen).",
      "Open /admin/payments and confirm the paid row fired checkout_session_created → checkout_redirected → webhook_received → grant_succeeded (the trial already proved this chain works; you are confirming it also fires on a nonzero charge).",
      "Confirm the test user flipped to pro and a subscriptions row appeared with payment_provider='whop', tier='first_month_19', status='active', expiring ~1 month out.",
      "Refund the charge in the Whop dashboard.",
      "If the grant did not fire, stop and flag Kassa before spending a cent on ads.",
    ],
  },
  {
    id: "pixel-test-fire",
    title: "Confirm the Meta Pixel CompleteRegistration lands",
    why: "GA4 is already confirmed: sign_up is a live key event firing on the medpruf.com stream (verified 2026-07-01). What is NOT yet confirmed is the Meta Pixel side. NEXT_PUBLIC_META_PIXEL_ID is set, but setting the env is not proof the event lands. Only a real consented signup in your own browser, checked in Meta Events Manager, proves it before any Meta ad spend.",
    category: "Tracking",
    status: "blocking",
    needs: "A fresh browser (or incognito), ~3 minutes, and access to Meta Events Manager. (GA4 sign_up is already proven, so this is Meta-only now.)",
    steps: [
      "Open medpruf.com in a fresh browser or an incognito window.",
      "ACCEPT the cookie consent banner (the Pixel does not load until you do).",
      "Create a free account so a real signup event fires.",
      "In Meta Events Manager, confirm a CompleteRegistration event landed for that session.",
      "If it is missing, do not launch any Meta paid set: the spend will be unmeasurable.",
    ],
  },
  {
    id: "ga4-google-ads-link",
    title: "Link Google Ads and import the sign_up conversion",
    why: "sign_up is already a live key event in GA4 (confirmed 2026-07-01), so the measurement half is done. The remaining half needs YOUR Google Ads account: link it to GA4 and import sign_up as a conversion so Google can measure and optimize the DE+EN paid probe (~18-28 July, ahead of the 28 Jul KP-Wien registration deadline). No agent holds this account, so only you can link it.",
    category: "Tracking",
    status: "blocking",
    needs: "Admin access to the GA4 property (G-DP4CQQPZWF) and your Google Ads account. (Marking sign_up as a key event is already DONE.)",
    steps: [
      "In GA4, go to Admin then Product links then Google Ads links, and link your Google Ads account.",
      "Open Google Ads, go to Goals then Conversions, and import the sign_up conversion.",
      "Confirm the imported conversion shows as Eligible (not Inactive) before the probe runs.",
    ],
  },
] as const;

// REMOVED 2026-07-01 (done): "paste-suresh-ig-reply". [name] pasted the German
// reply in the @medprufeu DM and Suresh replied "Uni Graz", i.e. he filed his
// nostrification at Uni Graz, so his sitting is the Stichprobentest in Graz on
// 23 Sep 2026 (registration by 26 Aug), before the Kenntnisprüfung Wien on
// 28 Sep. The ball is now in OUR court: a warm German follow-up is OWED (anchor
// both live dates, the free 450-question practice, one qualifying question).
// That draft is a comms task for Empfang (agent-doable, logged in
// MEDPRUF-COMMS-LOG.md), NOT an [name]-hands Action-Queue card. The only [name]
// hand left is the final IG send, which surfaces here only once a reply is
// actually staged and waiting on him.

/**
 * The one note that keeps the queue honest: this is the short list of things
 * NO agent can do for [name]. Everything else the fleet already runs. The list is
 * in PRIORITY order — the top item (fire the loaded community seeds) is the
 * highest-leverage move because top-of-funnel is the confirmed bottleneck; the
 * two blocking items (a real paid charge + the Google Ads link) gate paid SPEND,
 * not the free organic seeds.
 *
 * STANDING RULE (added 2026-07-01 to stop this queue drifting stale — the
 * recurring bug where it asked [name] to do things already done or that an agent
 * already does): an item earns a slot here ONLY if it clears both tests.
 *   1. DONE-WHEN predicate: it names a machine-checkable proof against live
 *      truth (payment_events / subscriptions for the rail; a comms-log msg-id or
 *      an inbox reply for a sent message; an env flag for a launched feature).
 *      When that predicate is already true, the item is DONE and must be pulled,
 *      not re-shown.
 *   2. OWNER test: it needs a hand only [name] has — posting AS himself, a real
 *      card charge, linking HIS Google Ads, an IG DM the API can't send, or
 *      flipping an env flag AFTER he's tested it. If the fleet already runs it
 *      or COULD (an email send, a meta-social post, monitoring a queue, drafting
 *      a reply), it is an agent task and does NOT belong in this queue.
 * Anything that fails either test is agent-work or already-done; keep it out.
 */
export const ACTIONS_INTRO_NOTE =
  "These are the only steps no agent can take for you: posting as yourself in a forum, a real charge on your card, linking your Google Ads, flipping an env flag after you've tested it. The fleet runs everything else (sends, drafts, monitoring). Top-of-funnel is still the bottleneck, so firing the loaded community seeds stays the highest-leverage reach move. Rail truth (2026-07-01): the Whop grant pipeline is PROVEN end to end. The €0 card trial fired checkout, webhook, grant, and Pro on a real card. The one thing still unproven is a real, nonzero PAID charge clearing (the €19 one-time plan), which is why that single card test remains. The flash-notes Pro trial and community Explore are both LIVE now; both fail safe (flip NOTES_TRIAL_ENABLED / NOTES_EXPLORE_ENABLED to false to pull them instantly). The one ongoing content action is watching the Explore moderation queue at /admin/note-reports.";
