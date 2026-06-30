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
 * PRIORITY ORDER (2026-06-24 round-3 fleet reflection): the binding constraint
 * is TOP-OF-FUNNEL, not the rail — `payment_events` is empty all-time = a
 * 0-attempt story (nobody reaches checkout), not abandonment. So the queue
 * leads with the highest-leverage distribution move (firing the loaded,
 * judged-ready community seeds), THEN the rail/tracking verifications that gate
 * paid spend, THEN the warmest open lead. Array order IS priority order, so the
 * top card is the most leveraged move, not necessarily a hard gate.
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
    why: "Top-of-funnel is the confirmed bottleneck (0 checkout attempts ever); these judged-ready, free, participate-only posts put real candidates into the funnel. learn-rx has a product but near-zero audience, so the window is open NOW.",
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
    id: "enable-notes-trial",
    title: "Turn on the free Pro trial (the new conversion lever)",
    why: "The flash-notes + personal Library feature shipped 2026-06-30, with a Telegram-gated 1-week FREE Pro trial — the strongest conversion mechanism the product has (a user builds a personal note library free for a week, then keeps Pro so they don't lose it). It is BUILT + deployed but flag-gated OFF. Flipping it on is a real revenue move once you've proven it grants + reverts correctly.",
    category: "Revenue",
    status: "ready",
    needs: "Your own account + ~10 min. The trial only activates with NOTES_TRIAL_ENABLED=true in Vercel env (Production). Full checklist + ready promo copy (DE/EN; AR pending your sign-off) in reviews/notes-feature-2026-06-30/trial-launch-kit.md.",
    steps: [
      "Set NOTES_TRIAL_ENABLED=true in the Vercel project env (Production), then redeploy (or re-pull env).",
      "As a real FREE test user with a linked Telegram, open the Library and tap 'Gratis-Woche starten' → confirm the tier flips to pro + a notes_free_trial row appears in the subscriptions table.",
      "Confirm the day-7 revert path: the existing trial-reminder cron flips an expired active subscription back to tier=free, so you are not giving away permanent Pro.",
      "Once proven, run the launch-kit copies for paid + organic promotion. The trial activation is a strong intermediate conversion to optimise toward.",
      "If anything looks off, set NOTES_TRIAL_ENABLED=false to instantly disable it again (fail-safe default).",
    ],
  },
  {
    id: "review-notes-explore",
    title: "Review + optionally turn on community notes (Explore)",
    why: "The public-notes Explore surface + its full safety stack (pre-publish PII/quality scan, publish-confirm, report → admin takedown, 24h author grace, anonymous-by-default) is BUILT + deployed but flag-gated OFF. It needs your review before going live — public health-content + PII is the real risk, so the takedown queue must exist first (it does).",
    category: "Content",
    status: "optional",
    needs: "~15 min. The admin moderation queue is live at /admin/note-reports. The flag is NOTES_EXPLORE_ENABLED (Vercel env). The rest of the notes feature works fully without this.",
    steps: [
      "Open /admin/note-reports — confirm the takedown queue renders (empty until a public note is reported).",
      "Skim the safety design: reviews/notes-feature-2026-06-30/SPEC.md §7 (PII scan + 24h grace + report/takedown + the 'community, not verified' label).",
      "Only if comfortable with moderation: set NOTES_EXPLORE_ENABLED=true (Production env). The 'Entdecken' toggle + 'Öffentlich teilen' then appear in the Library.",
      "Publish one of your own notes, confirm it shows in Explore anonymously, then take it down from /admin/note-reports to test the loop end to end.",
      "Prefer not to run community content yet? Leave it OFF — nothing else depends on it.",
    ],
  },
  {
    id: "verify-whop-rail",
    title: "Prove the Whop card rail end to end",
    why: "Prove the 19 € card rail closes before any ad spend. The rail is wired and silent (0 attempts ever) — one real charge is the only honest proof the grant pipeline fires.",
    category: "Revenue",
    status: "blocking",
    needs: "Your own card and ~5 minutes. A real charge (refundable to yourself after) is the only honest proof. The €19 single-month plan is plan_redacted07253e20.",
    steps: [
      "Open medpruf.com/pricing while logged in as a real test user (NOT the bare whop.com/medpruf link — that arrives unmapped).",
      "Start the Whop checkout on the 19 € single-month plan and complete a real card payment to the end (do not abandon at the Whop screen).",
      "Open /admin/payments and confirm the row fired all 4 steps: checkout_session_created → checkout_redirected → webhook_received → grant_succeeded.",
      "Confirm the test user's tier flipped to pro (access unlocked) and a subscriptions row appeared with payment_provider='whop', status='active'.",
      "Refund the charge in the Whop dashboard.",
      "If the grant did not fire, stop and flag Kassa before spending a cent on ads.",
    ],
  },
  {
    id: "pixel-test-fire",
    title: "Test-fire the Meta Pixel and GA4 events",
    why: "Un-skippable before any ad spend (Stratege: zero euros until this fires). NEXT_PUBLIC_META_PIXEL_ID is now SET, but setting the env is not the same as confirming the events actually land — only a real consented signup in your own browser proves it.",
    category: "Tracking",
    status: "blocking",
    needs: "A fresh browser (or incognito), ~5 minutes, and access to Meta Events Manager plus GA4 DebugView.",
    steps: [
      "Open medpruf.com in a fresh browser or an incognito window.",
      "ACCEPT the cookie consent banner (the trackers do not load until you do).",
      "Create a free account so a real signup event fires.",
      "In Meta Events Manager, confirm a CompleteRegistration event landed for that session.",
      "In GA4 (G-DP4CQQPZWF) DebugView, confirm a sign_up event landed.",
      "If either is missing, do not launch any paid set: the spend will be unmeasurable.",
    ],
  },
  {
    id: "ga4-google-ads-link",
    title: "Mark sign_up as key and link Google Ads",
    why: "Let Google measure and optimize the paid probe before the DE+EN probe (~18-28 July, ahead of the 28 Jul deadline). Do this after the test-fire confirms sign_up actually fires.",
    category: "Tracking",
    status: "blocking",
    needs: "Admin access to the GA4 property (G-DP4CQQPZWF) and the Google Ads account.",
    steps: [
      "Open GA4 (G-DP4CQQPZWF), go to Admin then Events (Key events).",
      "Mark sign_up as a key event.",
      "Go to Admin then Product links then Google Ads links, and link the Google Ads account.",
      "Open Google Ads, go to Goals then Conversions, and import the sign_up conversion.",
      "Confirm the imported conversion shows as Eligible (not Inactive) before the probe runs.",
    ],
  },
  {
    id: "paste-suresh-ig-reply",
    title: "Paste Suresh's Instagram reply (the warmest open lead)",
    why: "The only open lead where we hold the ball and it isn't moving: a doctor actively prepping Stichprobentest + the Kenntnisprüfung who reached in via IG. The German reply is drafted; the IG DM API cannot send it, so only you can.",
    category: "Revenue",
    status: "ready",
    needs: "Your own Instagram on @medprufeu (~2 minutes). The drafted German reply is logged in MEDPRUF-COMMS-LOG.md (the Suresh row) per Empfang's reflection (reviews/meeting3-2026-06-24/empfang.md §C).",
    steps: [
      "Open the Suresh row in MEDPRUF-COMMS-LOG.md and copy the drafted German reply (process explainer + free-450 hook + one qualifying question).",
      "Open Instagram, go to the @medprufeu DM thread with Suresh.",
      "Paste the reply and send.",
      "If he replies with a buying question, hand it to Empfang; if he wants to pay, the /pricing checkout (not a bare Whop link) is the path.",
    ],
  },
] as const;

/**
 * The one note that keeps the queue honest: this is the short list of things
 * NO agent can do for [name]. Everything else the fleet already runs. The list is
 * in PRIORITY order — the top item (fire the loaded community seeds) is the
 * highest-leverage move because top-of-funnel is the confirmed bottleneck;
 * the two blocking items (rail + Google Ads link) gate paid SPEND, not the free
 * organic seeds; the warm IG paste is the closest open loop on our side of the net.
 */
export const ACTIONS_INTRO_NOTE =
  "These are the steps no agent can take for you: posting as yourself in a forum, a charge on your card, a Google Ads link, an Instagram DM the API can't send, flipping an env flag after you've tested it. The fleet runs everything else. Top-of-funnel is still the bottleneck (0 checkout attempts ever), so firing the loaded community seeds stays the highest-leverage reach move. NEW (2026-06-30): the flash-notes + personal Library feature shipped, and its two levers are built, deployed, and flag-OFF, waiting only on your test + flip — the Telegram-gated free Pro trial (NOTES_TRIAL_ENABLED, a direct conversion lever) and community Explore (NOTES_EXPLORE_ENABLED, optional). Both fail safe to OFF.";
