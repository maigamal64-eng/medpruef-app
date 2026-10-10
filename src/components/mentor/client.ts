"use client";

/**
 * Binds the mentor API client to the app's authFetch. The ONLY place that
 * knows about fixture mode.
 *
 * Fixture mode exists so reviewers can render every state before the real
 * routes exist. It is gated on `NODE_ENV !== "production"` AND
 * NEXT_PUBLIC_MENTOR_FIXTURES === "true". NODE_ENV is inlined by the bundler,
 * so in every production build (Vercel or local `next build`) the condition
 * folds to false and the dynamic import is dropped: the synthetic fixture
 * content (example.org sources, "Beispiel" labels) is not even emitted as a
 * chunk, so it cannot ship or render on medpruf.com. A bare NEXT_PUBLIC flag
 * is not enough: when it is unset at build time the bundler leaves a runtime
 * lookup in place and still emits the fixture chunk (verified).
 * To review states on a production build, mock /api/mentor/* in the browser
 * instead (the UI only speaks the contract).
 */

import { authFetch } from "@/lib/authFetch";
import { createMentorApi, type MentorApi, type MentorFetch } from "./api";

let cached: Promise<MentorApi> | null = null;

export function loadMentorApi(): Promise<MentorApi> {
  if (!cached) {
    // Keep the whole test inline in this `if`: it must fold to false in
    // production so the dynamic import and its chunk are dropped.
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_MENTOR_FIXTURES === "true") {
      cached = import("./fixture-client").then((m) => m.createFixtureApi());
    } else {
      cached = Promise.resolve(createMentorApi(authFetch as MentorFetch));
    }
  }
  return cached;
}
