# Trial shape: keep the 7-day card trial and the 150-question no-card sample (LX-29)

Date: 2026-10-12. Status: decided (pick-trial-shape A, verdict auto, [name]'s "go with all" on LX-29).

## Decision

Keep both entry offers unchanged:

- **Free sample, no card:** 150 answered questions per question bank (`FREE_TIER.questions_per_exam_type`, enforced in `src/lib/free-access.ts`). Answers given during a Pro-Test count toward it afterwards.
- **Pro-Test with card:** 7 days of Pro, 0 € today, then the monthly price (`TIERS.first_month_19`, Whop plan `plan_redactedec56d4df`) unless cancelled before the first charge. Live behind `NOTES_TRIAL_ENABLED`.

No longer or no-card trial is added. No Whop plan, price or billing-copy change follows from this note.

## Numbers (read-only SQL, 2026-10-10, readiness LX-29 evidence)

| Measure | Value |
|---|---|
| Pro-Test subscriptions (`tier = notes_pro_trial`, all Whop) | 12 |
| active | 5 |
| expired | 5 |
| cancelled | 2 |
| Checkout redirects that were the trial (UX sweep pack) | 20 of 28 redirected learners |

Twelve trials are too few to judge conversion or to justify a longer trial. A competing platform's 30-day trial drew a warm first reaction in one group, and one member hesitated to enter card details before seeing reviews; the no-card sample already answers that hesitation.

## Consequences on the surfaces

- Landing hero leads with the free sample; the trial is the quieter second option and states card, 0 € today, the monthly price and cancelling before the first charge (pick-ux-pub-14 A).
- /pricing shows the Pro-Test as its own tile for visitors and signed-in learners; the paywall shows it only as a labelled secondary to an account that can still take it (pick-ux-acc-24 B).
- Trial-led placements wait until the pre-charge reminder (UX-ACC-55, `TRIAL_REMINDER_EMAILS_ENABLED` plus `VERIFIED_CANCEL_PATH`) is live and verified.

## Revisit

After 30 days of `trial_started`, `paywall_hit` and `paywall_click` events, or when trial starts reach 30, whichever comes first.
