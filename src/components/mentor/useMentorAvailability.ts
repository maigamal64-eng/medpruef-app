"use client";

/**
 * Should the Mentor entry appear in the navigation?
 *
 * Fails CLOSED. The entry shows only after GET /api/mentor/usage answers 200
 * with a well-formed body for the signed-in learner. A 403 (flag off, not on
 * the beta list), a 404 (route not shipped yet), a 401, any other error or a
 * timeout all hide it. One shared in-flight request and a short cache serve
 * every consumer (Sidebar and BottomNav both call this hook), and the probe
 * never redirects to /login.
 */

import { useEffect, useState } from "react";
import { getStoredSession } from "@/lib/auth";
import { loadMentorApi } from "./client";

export type MentorAvailability = "unknown" | "available" | "hidden";

const TTL_MS = 5 * 60 * 1000;

let cache: { value: Exclude<MentorAvailability, "unknown">; at: number; userId: string } | null = null;
let inflight: Promise<Exclude<MentorAvailability, "unknown">> | null = null;
let inflightUser = "";

function currentUserId(): string | null {
  try {
    const s = getStoredSession();
    const id = s?.user?.id;
    return id && !id.startsWith("guest_") ? id : null;
  } catch {
    return null;
  }
}

export function probeMentorAvailability(): Promise<Exclude<MentorAvailability, "unknown">> {
  const uid = currentUserId();
  if (!uid) return Promise.resolve("hidden");
  if (cache && cache.userId === uid && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value);
  if (inflight && inflightUser === uid) return inflight;
  inflightUser = uid;
  inflight = (async () => {
    let value: Exclude<MentorAvailability, "unknown"> = "hidden";
    try {
      const api = await loadMentorApi();
      const r = await api.usage();
      value = r.ok ? "available" : "hidden";
    } catch {
      value = "hidden";
    }
    cache = { value, at: Date.now(), userId: uid };
    inflight = null;
    return value;
  })();
  return inflight;
}

export function useMentorAvailability(): MentorAvailability {
  const [state, setState] = useState<MentorAvailability>("unknown");
  useEffect(() => {
    let live = true;
    probeMentorAvailability().then((v) => {
      if (live) setState(v);
    });
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Test and sign-out hook: forget what we learned. */
export function resetMentorAvailabilityCache(): void {
  cache = null;
  inflight = null;
  inflightUser = "";
}
