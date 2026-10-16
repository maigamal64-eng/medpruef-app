/** One owner for runtime fact tracing, also inspected by the readiness card. */
export const MENTOR_FACT_TRACE: Record<string,string[]> = {
 "/api/mentor/chat": ["./content/mentor-facts/**/*"],
 "/api/mentor/admin/operations": ["./content/mentor-facts/**/*"],
};
/**
 * Last live trust gate that passed in one run (track-A, a-mentor-g1-fix): scripts/mentor-trust-gate.mjs
 * --live --max-usd 0.50 on f1a3a1b2 (track-a/mentor-g1-fix), merged unchanged into track-a/release-int-8
 * (a-release-int-8-g1). Evidence: track-b handover a-mentor-g1-fix/gate-live-2/gate.json; passed_at is that
 * file's write time. Precision: 188 of 188 cases completed, 0 grounded answers replaced, 106 of 108
 * in-scope answers fully correct (bar 90 %; app_plan 26/28). Previous record: 28bd430a (a-mentor-preconds).
 * Re-run the gate and update this record and MENTOR_RELEASE_EVAL_SOURCES after any change to the answer
 * path; tests/unit/mentor/release-eval-sources.test.ts fails while the gated sources differ.
 */
export const MENTOR_RELEASE_EVAL: { commit: string; score: string; passed_at: string } | null = {
  commit: "f1a3a1b2",
  score: "PASS 5/5 slices (deadline 7/7, precision 188/188 completed with 0 replaced and 106/108 fully correct, trust 32/32, explain 30/30, multilingual 20/20), USD 0.228",
  passed_at: "2026-10-16T04:31:11Z",
};
/** The gate's own source_sha256 (gate.json of the run above): the files whose bytes the PASS is bound to. */
export const MENTOR_RELEASE_EVAL_SOURCES: Readonly<Record<string,string>> = {
 "content/mentor-facts/SCHEMA.json": "7af620733875df49bcc07d5580b4901bf2a9720f6b07a64799f753e31c34cc7d",
 "content/mentor-facts/general.json": "e2d3e7ed5860eebeef0779dba351df8e685a23dc3de8b8954cd80ead17cc1fb6",
 "content/mentor-facts/pharma.json": "46175c0dedeeca659c847acc53274130644340013161e2dbcb9f77d3e64f37d6",
 "content/mentor-facts/sip.json": "639e2aa6728a71efc116cd23db57970c0a3c062502e1f275a192b0431f3c07db",
 "content/mentor-facts/stichprobentest.json": "3c577bc488ac62b60a79b2c7fc03f48e23f2096e5d6f57a9164cad3cd04c0f51",
 "src/lib/mentor/deadline-copy.ts": "afa1a26701f648c30551fc852833885939c38a4187f0ab2f143c5324335b05e7",
 "tests/mentor-eval/r4-deadlines.json": "8fffd4c3344d0c883fed7fdb6df5bc95c6c458f4b47fc8a8fd632ca524d2e542",
 "src/lib/mentor/prompt/system.ts": "994f0c9fe0f5d7fc8bb6343d497a074f08580231003a95f1022a8fe77e3f3d32",
 "src/lib/mentor/explain-safety.ts": "602e4343d6d20e115e720149a39b59699a8e6c6cfc3af92fc4b7bb1b37220c9b",
 "tests/mentor-eval/lib/score.ts": "98a29ae420e91446a359d52b084cd2beec976e3028b1a3b70b3c6c45fb9dd13c",
 "tests/mentor-eval/r3-explain-multilingual.json": "14404728976274a15d9d11a0b82c8a57933549b238118ca8565c386b5ace0cbb",
 "src/lib/mentor/validator.ts": "165ec191aa50bd010241dfcaa262d33d587949fb913c2dd713269ce21f73707d",
 "src/lib/mentor/turn.ts": "8baa284cb44cf58c471963b8a24f3079e59ae576076a188022a04756f5a0f99b",
 "tests/mentor-eval/r2-trust.json": "3589c42b31a43b37d79030d0934fd9356c9289cf1f5fb9e42c5e97791c944f56",
 "tests/mentor-eval/r2-trust-fixtures.json": "6d3254e41cea2382a496458fb31d880da534e86dd5abfcd24083331ae12e4a0f",
 "tests/mentor-eval/r1-multilingual.json": "caffea899a95351840e3f0054c41a03c6e757b8f129e404b8f3453aa69aaf876",
 "tests/mentor-eval/lib/harness.ts": "576c352888cb45287d1497c8e655234f2d0103c8475ccfb3a9cebda44da0f41d",
 "tests/mentor-eval/lib/run.ts": "b97a4768161fbff4e0fe627cd653e9ab7e0452a6b5f74e34f8228b2c859a5a29",
};
/**
 * Answer-path files the gate script does not hash itself (Argus P2, a-release-int-8-g1): their bytes at the
 * gated commit f1a3a1b2, read with git show. Not proof the run read them (the run hashes only the list above),
 * only a drift guard: a change here also needs a new live gate. Widen scripts/mentor-trust-gate.mjs to cover
 * them on the next gate run.
 */
export const MENTOR_RELEASE_EVAL_COMMIT_SOURCES: Readonly<Record<string,string>> = {
 "src/lib/mentor/app-trial.ts": "c89b4fb59916c51e99ab000f6b9ff956eb5b41918258d4274bedccb5db68b366",
 "src/lib/mentor/unconfirmed-label.ts": "f095983176a733ea42262beb91b2443dbc765e20f347c825be1c1b0d54c15fbc",
 "src/lib/mentor/facts-loader.ts": "cfc0690c72c6f01584cd712c647be720c834881e0ced8b24463bd699f1d92f89",
 "src/lib/billing-copy.ts": "22a9470aac3d56a2b6054c6f8950254f0b98b1de3bfeab041c4266fc929ac6e9",
 "src/lib/mentor/trust-copy.ts": "d004528b0bfbdbfa9a4da54e34d781624d7ca82e90bfb83a89d469beca539263",
 "src/lib/mentor/prompt/refusals.ts": "cfa637fd493224aae3b8de4990ca41aa7a4738f01ef8506697b45a4475501e7a",
 "src/lib/mentor/prompt/refusal-i18n.ts": "c56501b06f20659a5116b642724f59903e1d99158a5a2035c696484b81bd26e9",
 "src/lib/mentor/deadline-first.ts": "479fcef84de588f492f4b35b6e7076a7c13dbbd0399e646b6eec6808971fb15f",
 "src/lib/mentor/citation-repair.ts": "0f51d3894b6843280ef4d92cbbb9ef7782b6f0a4a7264cc21a5377781149c56e",
 "src/lib/mentor/seam.ts": "ea2a8398640ea5a140d245566148066e39fdb7b5a4c9183267f3bb6dd89c3e40",
 "tests/mentor-eval/golden.json": "b4138a62b418fe75a061a29e53f5f490802270af50ceff7a463fbaa05ce71bda",
};
