/**
 * founderActions: the Action Queue — every item that needs [name]'s own hands
 * (AUTONOMY.md follow-on, STATIC). His command center.
 *
 * Hand-maintained, machine-readable list of the steps the fleet cannot take for
 * him: a real card payment on his card, accepting a cookie banner in his own
 * browser, linking his Google Ads, hitting send on a staged batch, signing off
 * Arabic / Russian register, setting an ad budget live. Each carries WHY it
 * matters, WHAT he must provide, and the exact click-by-click STEPS.
 *
 * One owner per fact: the meeting reflections + marketing drafts own the prose
 * (reviews/meeting-2026-06-24/*, marketing/distribution/*, marketing/campaigns/*);
 * this const is the mirror the superadmin Action Queue reads. When a draft or a
 * blocker changes, update this file in the same change.
 *
 * Operator-honest: "blocking" = nothing downstream (paid acquisition) is sound
 * until it is done; "ready" = staged and waiting only on [name] to fire it;
 * "optional" = real but sequenced after the blockers. Array order is
 * blocking → ready → optional on purpose, so the most urgent card renders first.
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
 *  - ready: staged and waiting only on [name] to fire it.
 *  - optional: real, but sequenced after the blockers.
 */
export type ActionStatus = "blocking" | "ready" | "optional";

export interface FounderAction {
  /** Stable id (verify-whop-rail, pixel-test-fire, …). */
  id: string;
  /** Short imperative title. */
  title: string;
  /** One line: why this is on [name]'s plate. */
  why: string;
  /** Which lane it moves. */
  category: ActionCategory;
  /** Gate status: blocking / ready / optional. */
  status: ActionStatus;
  /** What [name] must provide or personally do (a card, a browser, a sign-off). */
  needs: string;
  /** Exact click-by-click steps, in order. */
  steps: string[];
}

// ═══════════════════════════════════════════════════════════════════
// The queue — blocking → ready → optional
// ═══════════════════════════════════════════════════════════════════

export const ACTIONS: ReadonlyArray<FounderAction> = [
  {
    id: "verify-whop-rail",
    title: "Verify the Whop card rail end to end",
    why: "Prove the 19 € card rail works before any ad spend.",
    category: "Revenue",
    status: "blocking",
    needs: "Your own card and ~5 minutes. A real charge (refundable to yourself after) is the only honest proof the rail clears.",
    steps: [
      "Open medpruf.com/pricing in your browser.",
      "Pick a plan and start the Whop checkout.",
      "Complete a real card payment to the end (do not abandon at the Whop screen).",
      "Open /admin/payments and confirm the row went checkout_initiated then granted.",
      "Confirm your own account flipped to Pro (tier=pro, access unlocked).",
      "If the grant did not fire, stop and flag Kassa before spending a cent on ads.",
    ],
  },
  {
    id: "pixel-test-fire",
    title: "Fire the Meta Pixel and GA4 test events",
    why: "Confirm ad conversion tracking actually fires.",
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
    why: "Let Google optimize and measure the probe.",
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
    id: "fire-institutional",
    title: "Send the 4 institutional referral emails",
    why: "Zero-cost reach with no account-deletion risk.",
    category: "Growth",
    status: "ready",
    needs: "~15 minutes to review the 4 drafts and send them from user-b7e46e80@example.com (or tell [name] to send via the Zoho sender).",
    steps: [
      "Open marketing/distribution/institutional-emails.md and read the 4 drafts.",
      "Confirm each one leads with the correct exam date and the free-450 hook.",
      "Send to meded.at, OEH Med Graz, arabmed.de, and the MedUni Nostrifikation offices.",
      "Either send from user-b7e46e80@example.com yourself or tell [name] send the institutional emails.",
      "Note the send in the comms log so a reply is not dropped.",
    ],
  },
  {
    id: "fire-community",
    title: "Post participate-only in the 2 live community threads",
    why: "Presence in the rooms that pull (Suresh proved it).",
    category: "Growth",
    status: "ready",
    needs: "Your own account on each platform. These post AS YOU, value-first, with NO link (a link or a fresh account risks a ban).",
    steps: [
      "Open marketing/distribution/community-entry-drafts.md and read the staged posts.",
      "Post as yourself in the live MEDI-LEARN Austria thread, participate-only, NO link.",
      "Post as yourself in the Arab-doctors-in-Austria FB group, participate-only, NO link.",
      "Answer one real question in each room before MedPrüf is ever mentioned.",
      "If anyone asks for the tool, share medpruf.com only in a reply, never in the opening post.",
    ],
  },
  {
    id: "send-recovery-comms",
    title: "Send the staged recovery + dormant comms",
    why: "The biggest named dropped euro plus 4 dormant buyers.",
    category: "Revenue",
    status: "ready",
    needs: "Your go-ahead. The drafts are written and the per-user Whop card links are ready; this only waits on you to fire it.",
    steps: [
      "Open reviews/meeting-2026-06-24/empfang.md and read the staged drafts.",
      "Confirm the Sam Tar 2nd-touch (addresses the crypto-failure friction plus the working card link).",
      "Confirm the 4 dormant touches (Heba, [name] Khasan, Mahmoud, Mohamad Fares).",
      "Tell [name] send them, or send each via the Zoho sender (scripts/zoho_send_curl.py).",
      "Watch /admin/payments for the first granted row after they land.",
    ],
  },
  {
    id: "ar-ru-copy-signoff",
    title: "Sign off the Arabic and Russian ad copy",
    why: "Before either non-German ad set runs.",
    category: "Growth",
    status: "optional",
    needs: "Your read on the Egyptian-Arabic register, and one Russian native speaker to check the RU.",
    steps: [
      "Open marketing/campaigns/ad-copy-ar-ru-2026-06-24.md.",
      "Confirm the AR copy is Egyptian-Arabic register (not Gulf, not Levantine, not stiff MSA).",
      "Get a Russian native speaker to check the RU copy reads naturally.",
      "Confirm both are zero em dashes and Austrian-not-German framing.",
      "Approve, or send the line-level edits back to Herold before the set goes live.",
    ],
  },
  {
    id: "launch-de-en-probe",
    title: "Set the DE + EN paid probe live",
    why: "The near-term paid test (the Stratege re-frame).",
    category: "Growth",
    status: "optional",
    needs: "The Pixel and the rail verified first (the two blocking items above), then your hand on the budget toggle.",
    steps: [
      "Confirm verify-whop-rail and pixel-test-fire are both green first.",
      "In Meta Ads Manager, set the DE + EN probe live, optimized for the signup event.",
      "In Google Search, set the corrected keyword set live (per the paid-ads setup doc).",
      "Cap total spend at 150 €.",
      "Do not touch it before day 3; read the result at day 3 to 5, then decide to scale or kill.",
    ],
  },
  {
    id: "ratify-349-content",
    title: "Ratify the repaired Stichprobentest questions",
    why: "Approve the repaired questions back to live.",
    category: "Content",
    status: "optional",
    needs: "Your sign-off on Visite's repair progress (medical-content correctness is a call you own).",
    steps: [
      "Open reviews/meeting-2026-06-24/visite.md and read the repair progress on the deactivated rows.",
      "For each repaired question, confirm the answer key and the de-leaked stem read correctly.",
      "Approve the reactivations so the fixed rows go back to live.",
      "For the rows still flagged as genuinely ambiguous, decide retire-with-reason or keep-flagged.",
      "Tell Visite which to reactivate and which to retire.",
    ],
  },
] as const;

/**
 * The one note that keeps the queue honest: this is the short list of things
 * NO agent can do for [name]. Everything else the fleet already runs. Two
 * blocking items (rail + pixel) gate every euro of paid acquisition; the ready
 * items are staged and waiting only on a send; the optional items are real but
 * sequenced behind the blockers.
 */
export const ACTIONS_INTRO_NOTE =
  "These are the steps no agent can take for you: a charge on your card, a consent click in your browser, a Google Ads link, a send, a register sign-off, a budget toggle. The fleet runs everything else. Clear the two blocking items before any paid spend.";
