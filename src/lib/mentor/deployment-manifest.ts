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
 * Re-run the gate and update this record and MENTOR_RELEASE_EVAL_SOURCES after any change to the answer
 * path; tests/unit/mentor/release-eval-sources.test.ts fails while the gated sources differ.
 */
export const MENTOR_RELEASE_EVAL: { commit: string; score: string; passed_at: string } | null = {
 commit: "fa5a7bb3",
 score: "PASS 5/5 slices (deadline 7/7, precision 188/188 completed with 0 replaced and 106/108 in-scope answers fully correct, trust 32/32, explain 30/30, multilingual 20/20), USD 0.225",
 passed_at: "2026-10-18T07:07:06Z",
};
/** The gate's own source_sha256 (gate.json of the run above): the files whose bytes the PASS is bound to. */
export const MENTOR_RELEASE_EVAL_SOURCES: Readonly<Record<string,string>> = {
 "content/mentor-facts/SCHEMA.json": "7af620733875df49bcc07d5580b4901bf2a9720f6b07a64799f753e31c34cc7d",
 "content/mentor-facts/general.json": "e2d3e7ed5860eebeef0779dba351df8e685a23dc3de8b8954cd80ead17cc1fb6",
 "content/mentor-facts/pharma.json": "d4cb18ebcb06a747813438e962be16acfa0ad7dceeb4e674b5e9b3bc3e59728a",
 "content/mentor-facts/sip.json": "2985cb84da76be0297e0c049e3341d7dfc8218106c3e9d57983a0502e8ded8a4",
 "content/mentor-facts/stichprobentest.json": "6ebd478f13d743f30d7209e350ec736b94331f7bec1635568dc0f857c61af75d",
 "src/lib/mentor/deadline-copy.ts": "afa1a26701f648c30551fc852833885939c38a4187f0ab2f143c5324335b05e7",
 "tests/mentor-eval/r4-deadlines.json": "8fffd4c3344d0c883fed7fdb6df5bc95c6c458f4b47fc8a8fd632ca524d2e542",
 "src/lib/mentor/prompt/system.ts": "b955f7e054241aca452f2e5f7b591dd1c1aa36d7fc2e7daf2ce08a027179709a",
 "src/lib/mentor/explain-safety.ts": "602e4343d6d20e115e720149a39b59699a8e6c6cfc3af92fc4b7bb1b37220c9b",
 "tests/mentor-eval/lib/score.ts": "98a29ae420e91446a359d52b084cd2beec976e3028b1a3b70b3c6c45fb9dd13c",
 "tests/mentor-eval/r3-explain-multilingual.json": "14404728976274a15d9d11a0b82c8a57933549b238118ca8565c386b5ace0cbb",
 "src/lib/mentor/validator.ts": "586635bd6d3825d02f8e126fb5a61f60eb1050e1e55302a9722aa5eff05035ce",
 "src/lib/mentor/turn.ts": "a90258877b262add506dc1be5b587de77bab34d5d11313dbd3083d279e8d6ac0",
 "tests/mentor-eval/r2-trust.json": "3589c42b31a43b37d79030d0934fd9356c9289cf1f5fb9e42c5e97791c944f56",
 "tests/mentor-eval/r2-trust-fixtures.json": "6d3254e41cea2382a496458fb31d880da534e86dd5abfcd24083331ae12e4a0f",
 "tests/mentor-eval/r1-multilingual.json": "caffea899a95351840e3f0054c41a03c6e757b8f129e404b8f3453aa69aaf876",
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
 "src/lib/mentor/unconfirmed-label.ts": "f095983176a733ea42262beb91b2443dbc765e20f347c825be1c1b0d54c15fbc",
 "src/lib/mentor/facts-loader.ts": "cfc0690c72c6f01584cd712c647be720c834881e0ced8b24463bd699f1d92f89",
 "src/lib/billing-copy.ts": "9f2e3773f79035ea3b253b636f0ad87b11025fd6dc96681ca0bb33503b7b9f85",
 "src/lib/mentor/trust-copy.ts": "d004528b0bfbdbfa9a4da54e34d781624d7ca82e90bfb83a89d469beca539263",
 "src/lib/mentor/prompt/refusals.ts": "cfa637fd493224aae3b8de4990ca41aa7a4738f01ef8506697b45a4475501e7a",
 "src/lib/mentor/prompt/refusal-i18n.ts": "c56501b06f20659a5116b642724f59903e1d99158a5a2035c696484b81bd26e9",
 "src/lib/mentor/deadline-first.ts": "479fcef84de588f492f4b35b6e7076a7c13dbbd0399e646b6eec6808971fb15f",
 "src/lib/mentor/citation-repair.ts": "0f51d3894b6843280ef4d92cbbb9ef7782b6f0a4a7264cc21a5377781149c56e",
 "src/lib/mentor/seam.ts": "cde0b0d701dbe9e7b7e2d036c83330260b17c41785dca78c45238827745e5be9",
 "tests/mentor-eval/golden.json": "bac3d4a1627ec96504dea84a26263101d01afb5760c74d555eb16b3d231b05ff",
};
