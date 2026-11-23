/**
 * Simulation core (PLAN.md 2.2): exam-agnostic, pure logic. No React, no fetch,
 * no env, no copy. Each exam brings a profile, a case adapter and its own copy
 * module from its own surface (KP: src/lib/de-kp/sim/).
 */
export * from "./parts";
export * from "./profile";
export * from "./access";
export * from "./case";
export * from "./scoring";
export * from "./state";
