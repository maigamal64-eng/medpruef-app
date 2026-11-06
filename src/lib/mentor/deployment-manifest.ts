/** One owner for runtime fact tracing, also inspected by the readiness card. */
export const MENTOR_FACT_TRACE: Record<string,string[]> = {
 "/api/mentor/chat": ["./content/mentor-facts/**/*"],
 "/api/mentor/admin/operations": ["./content/mentor-facts/**/*"],
};
/**
 * Last live trust gate that passed in one run (track-A, a-mentor-gate-fa5a7bb3): scripts/mentor-trust-gate.mjs
 * --live on fa5a7bb3 (gate-live-2, exit 0). Evidence: track-b handover a-mentor-gate-fa5a7bb3/verdict.json and
 * gate-live-2/gate.json; passed_at is that file's write time. Precision: 188 of 188 cases completed, 0
 * replaced, 106 of 108 in-scope answers fully correct. Previous record: f1a3a1b2 (cleared 17 Oct by
 * a-trial-phone-gate). Recorded on the N1 head (a-n1-head-1020), carried by diff review: fa5a7bb3..N1 changes
 * no gated source, no file under src/lib/mentor except a comment in access.ts, and in src/lib/billing-copy.ts
 * only the MENTOR_BILLING public and terms copy, which the answer path never reads (facts-loader imports only
 * billingPlansSummary, billingTrialSummary and billingCancelSummary, unchanged).
 * a-card-trial-build-1024 (24 Oct), carried by diff review the same way: billing-copy.ts adds the
 * 3-day card-trial copy; billingPlansSummary and billingCancelSummary are unchanged and
 * billingTrialSummary returns its old text byte for byte unless NEXT_PUBLIC_CARD_TRIAL is on (the gated
 * build had it off). The card-trial fact text is new answer-path content: re-run the live gate on the
 * build that switches CARD_TRIAL_ENABLED on, before or at that flip (handover followup).
 * a-card-trial-preflip-1024 (24 Oct): the record above is the live gate on a005e786 (track-a/card-trial-1024: N3 head
 * b69a16d1 plus the 3-day card trial, its golden cases and the Reviewer-tightened card-question graders), run
 * with the flip env (card trial on, reverse trial off); evidence track-b handover a-card-trial-preflip-1024/
 * gate-live-3/gate.json, passed_at its write time. Earlier runs in the same handover: gate-live-1 PASS on
 * 43dbfc6e (before the grader fix), gate-live-2 FAIL on a005e786 (one unasked true plan price on ap2-halfyear-en,
 * passed in runs 1 and 3). The six golden trial cases that grade the card trial ran under {pricing_v2,
 * card_trial}. COMMIT_SOURCES hold the a005e786 bytes (golden.json changed with the card-trial cases).
 * a-ai-fix-1106 (6 Nov): the record above is the live gate on a0407a2c (the Mentor answers Arabic in Arabic,
 * pick-arabic A retired; Arabic grounding and copy), run with the same flip env (card trial on, reverse trial
 * off); evidence reports/backlog-out/a-ai-fix-1106/eval/trust-gate-final/gate.json, passed_at its write time.
 * An earlier run on dd9d1a22 (eval/trust-gate-live) failed one precision case, ap2-recurring-de (an unasked
 * true plan price, 1 of 5 in isolated re-runs, the same flake as gate-live-2 on a005e786); later runs were
 * stopped for review fixes. COMMIT_SOURCES hold the a0407a2c bytes. This branch also changes
 * rulings-1017.ts and contract.ts (drift_guard_gap files), both covered by this run.
 * a-mentor-better-1106 (6 Nov): the record above is the live gate on c19f3394 (Mentor v2 behind MENTOR_V2_ENABLED,
 * default off; the hooks in turn.ts and seam.ts are inert with the flag off), run with the same flip env and the flag
 * unset; evidence reports/backlog-out/a-mentor-better-1106/eval/trust-gate-live-2/gate.json, passed_at its write time.
 * An earlier run on 231243a3 (eval/trust-gate-live) stopped after two passing slices on a keyless token-exchange
 * timeout. Commits after c19f3394 change only src/lib/mentor/v2/find-questions.ts (v2 only, never loaded with the
 * flag off) and its test, no gated or commit-bound file. COMMIT_SOURCES hold the c19f3394 bytes.
 * Re-run the gate and update this record and MENTOR_RELEASE_EVAL_SOURCES after any change to the answer
 * path; tests/unit/mentor/release-eval-sources.test.ts fails while the gated sources differ.
 */
export const MENTOR_RELEASE_EVAL: { commit: string; score: string; passed_at: string } | null = {
 commit: "c19f3394",
 score: "PASS 5/5 slices (deadline 7/7, precision 188/188 completed with 0 replaced, 105/108 in-scope answers fully correct and 106/108 valid citations, trust 32/32, explain 30/30, multilingual 20/20), USD 0.231; run with MENTOR_V2_ENABLED unset (v1 path), CARD_TRIAL_ENABLED and NEXT_PUBLIC_CARD_TRIAL true, REVERSE_TRIAL off (a-mentor-better-1106)",
 passed_at: "2026-11-06T04:58:16Z",
};
/** The gate's own source_sha256 (gate.json of the run above): the files whose bytes the PASS is bound to. */
export const MENTOR_RELEASE_EVAL_SOURCES: Readonly<Record<string,string>> = {
 "content/mentor-facts/SCHEMA.json": "7af620733875df49bcc07d5580b4901bf2a9720f6b07a64799f753e31c34cc7d",
 "content/mentor-facts/general.json": "e2d3e7ed5860eebeef0779dba351df8e685a23dc3de8b8954cd80ead17cc1fb6",
 "content/mentor-facts/pharma.json": "d4cb18ebcb06a747813438e962be16acfa0ad7dceeb4e674b5e9b3bc3e59728a",
 "content/mentor-facts/sip.json": "2985cb84da76be0297e0c049e3341d7dfc8218106c3e9d57983a0502e8ded8a4",
 "content/mentor-facts/stichprobentest.json": "6ebd478f13d743f30d7209e350ec736b94331f7bec1635568dc0f857c61af75d",
 "src/lib/mentor/deadline-copy.ts": "5056322c3c3954c18d815a3cf22da6ec46f0a9d34c8fc90657f7fa9db4597ba3",
 "tests/mentor-eval/r4-deadlines.json": "f31303bd5ae93f1f024761225601bcac6fe0763a501ecf8679758c42d45747c5",
 "src/lib/mentor/prompt/system.ts": "4fdd320f02fe61f9b5e1007f0ee32c0e8701583ac78c568283210c838a271577",
 "src/lib/mentor/explain-safety.ts": "602e4343d6d20e115e720149a39b59699a8e6c6cfc3af92fc4b7bb1b37220c9b",
 "tests/mentor-eval/lib/score.ts": "98a29ae420e91446a359d52b084cd2beec976e3028b1a3b70b3c6c45fb9dd13c",
 "tests/mentor-eval/r3-explain-multilingual.json": "14404728976274a15d9d11a0b82c8a57933549b238118ca8565c386b5ace0cbb",
 "src/lib/mentor/validator.ts": "2804b114d71b2b4bcdf0c4766e133a851ac80a0b041947c58dd96c880f1a975d",
 "src/lib/mentor/turn.ts": "c76ec162269174b959d27c6bd6fc2a1b52218fd24a4e6ce11d15dd6b80277323",
 "tests/mentor-eval/r2-trust.json": "3589c42b31a43b37d79030d0934fd9356c9289cf1f5fb9e42c5e97791c944f56",
 "tests/mentor-eval/r2-trust-fixtures.json": "6d3254e41cea2382a496458fb31d880da534e86dd5abfcd24083331ae12e4a0f",
 "tests/mentor-eval/r1-multilingual.json": "28334c12ac65283b846f40b280da381198cd9e51faefa687bd73acb943871bff",
 "tests/mentor-eval/lib/harness.ts": "576c352888cb45287d1497c8e655234f2d0103c8475ccfb3a9cebda44da0f41d",
 "tests/mentor-eval/lib/run.ts": "b97a4768161fbff4e0fe627cd653e9ab7e0452a6b5f74e34f8228b2c859a5a29",
};
/**
 * Answer-path files the gate script does not hash itself: their bytes at the gated commit fa5a7bb3, read with
 * git show. Not proof the run read them, only a drift guard: a change here also needs a new live gate.
 * Exception (a-n1-head-1020): src/lib/billing-copy.ts holds its N1 bytes (2ff2a968 at fa5a7bb3); the
 * only change is the MENTOR_BILLING included/includedV1/includedRule copy (a-flip-copy-fixes), outside the
 * three summaries the facts loader reads. Second exception (a-n1-head-copy-1021, release-int-8.3): the v2 copy
 * fix (a-v2-copy-surfaces-1021) adds V2_RENEWAL_LINE(_NO_HALF), v2RenewalLine, billingEarlierPlansLine and
 * SURFACE_COPY_V2_NO_HALF and a halfYear option on billingNeutralLine/billingSurfaceText, again outside the
 * three summaries; their output is byte-identical to 058c479d in 48 checks (3 summaries x de/en x pricing v2,
 * reverse trial and 6-month readiness on/off). Not covered by either list (drift_guard_gap): rulings-1017.ts,
 * study-safety.ts, prompt/protocol.ts, config.ts, contract.ts; all unchanged fa5a7bb3..N1.
 */
export const MENTOR_RELEASE_EVAL_COMMIT_SOURCES: Readonly<Record<string,string>> = {
 "src/lib/mentor/app-trial.ts": "c8af267023794de561d32ad97f556bdd2dac7bbb6bb77121de6e08a3273e9d89",
 "src/lib/mentor/unconfirmed-label.ts": "3c22c2976e7024064d948f1194ead6db1392fab912f04d1d4a44662487c99eea",
 "src/lib/mentor/facts-loader.ts": "cfc0690c72c6f01584cd712c647be720c834881e0ced8b24463bd699f1d92f89",
 "src/lib/billing-copy.ts": "2475dcc91f817da44e3f8a46bda46331309d3f62be0ab37a52732606f95c2e73",
 "src/lib/mentor/trust-copy.ts": "cdd454bb414ea53b1637adc212d8816370b41dab06dbcd4a66f37d25ac08cf4d",
 "src/lib/mentor/prompt/refusals.ts": "37d2fd07ce62b32e395b872b71d10b0c3b74b86f3ca5d921ad85d0768fdf6574",
 "src/lib/mentor/prompt/refusal-i18n.ts": "ff44805691e564c530c33ac028762ecb70456da7ff6bd784d1d3cf23f9e1b985",
 "src/lib/mentor/deadline-first.ts": "479fcef84de588f492f4b35b6e7076a7c13dbbd0399e646b6eec6808971fb15f",
 "src/lib/mentor/citation-repair.ts": "0f51d3894b6843280ef4d92cbbb9ef7782b6f0a4a7264cc21a5377781149c56e",
 "src/lib/mentor/seam.ts": "b6a6137617598a7455f2ca71336e9ea8881f7215f6c03f6aa61edf2c86ae39df",
 "tests/mentor-eval/golden.json": "48dd2c745f34aca553b748be55f4ffcd8f3f88f17392d8711c68ba5e26858b54",
};
