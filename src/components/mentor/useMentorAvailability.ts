"use client";

import { useEffect, useState } from "react";
import { getStoredSession } from "@/lib/auth";
import { authFetch } from "@/lib/authFetch";

export type MentorAvailability = "unknown" | "available" | "resting" | "hidden";
export const MENTOR_AVAILABILITY_POLL_MS = 60_000;
export const MENTOR_AVAILABILITY_RETRY_MS = 30_000;
/** While the mentor is off for this user, re-check at most this often (no 60 s polling while dark). */
export const MENTOR_AVAILABILITY_HIDDEN_RECHECK_MS = 15 * 60_000;
const RETENTION_PREFIX = "medpruf:mentor-credit-holder:";
const STORAGE_PREFIX = "medpruf:mentor-availability:";
type Known = Exclude<MentorAvailability, "unknown">;
type Cached = { value: Known; at: number; userId: string };
let cache: Cached | null = null;
let inflight: Promise<MentorAvailability> | null = null;
let inflightUser = "";
let retry: ReturnType<typeof setTimeout> | null = null;
let retryUser = "";
const listeners = new Set<(value: MentorAvailability) => void>();

function currentUserId(): string | null {
  try { const id = getStoredSession()?.user?.id; return id && !id.startsWith("guest_") ? id : null; }
  catch { return null; }
}
function stored(userId: string): Cached | null {
  if (cache?.userId === userId) return cache;
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_PREFIX + userId) ?? "null") as Cached | null;
    if (saved?.userId === userId && ["available", "resting", "hidden"].includes(saved.value) && Number.isFinite(saved.at)) return saved;
  } catch { /* Storage is optional. */ }
  return null;
}
/** The hook initializes synchronously from a user-scoped session value. */
export function seedMentorAvailability(): MentorAvailability {
  const user = currentUserId();
  return user ? stored(user)?.value ?? "unknown" : "hidden";
}
/** Call only after a user-owned usage response proves prior grants. */
export function rememberMentorCreditHolder(userId: string): void {
  if (!userId || currentUserId() !== userId) return;
  try { sessionStorage.setItem(RETENTION_PREFIX + userId, "true"); } catch { /* Optional storage. */ }
}
function isCreditHolder(userId: string): boolean {
  try { return sessionStorage.getItem(RETENTION_PREFIX + userId) === "true"; } catch { return false; }
}
function save(userId: string, value: Known): void {
  cache = { userId, value, at: Date.now() };
  try { sessionStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(cache)); } catch { /* Storage is optional. */ }
}
function freshFor(value: Known): number {
  return value === "hidden" ? MENTOR_AVAILABILITY_HIDDEN_RECHECK_MS : MENTOR_AVAILABILITY_POLL_MS;
}
/** Live polling only when the mentor is shown; a hidden mentor waits for its longer cache. */
export function shouldPollLive(): boolean {
  const uid = currentUserId();
  const last = uid ? stored(uid) : null;
  return last !== null && last.value !== "hidden";
}
function emit(value: MentorAvailability): void { listeners.forEach(listener => listener(value)); }
export function probeMentorAvailability(force = false, isRetry = false): Promise<MentorAvailability> {
  const uid = currentUserId();
  if (!uid) return Promise.resolve("hidden");
  if (retry && retryUser !== uid) { clearTimeout(retry); retry = null; retryUser = ""; }
  const last = stored(uid);
  if (!force && last && Date.now() - last.at < freshFor(last.value)) return Promise.resolve(last.value);
  if (inflight && inflightUser === uid) return inflight;
  inflightUser = uid;
  const pending = (async () => {
    let value: MentorAvailability = last?.value ?? "unknown";
    let transient = false;
    try {
      const result = await authFetch("/api/mentor/availability", { timeoutMs: 12_000, skipAuthRedirect: true });
      if (result.ok) {
        const body = await result.json() as { available?: unknown };
        if (body.available === true) value = "available";
        else transient = true; // Malformed bodies cannot hide a known entry.
      } else if ([401, 403, 404].includes(result.status)) {
        value = "hidden";
        if (result.status === 403 && isCreditHolder(uid)) {
          const body = await result.json() as { reason?: string };
          if (body.reason === "paused") value = "resting";
        }
      }
      else transient = true;
    } catch { transient = true; }
    // Avoid a late response crossing a sign-out or a user switch.
    if (currentUserId() !== uid) return "hidden";
    if (!transient && value !== "unknown") save(uid, value);
    if (transient && !isRetry && retry === null) {
      retryUser = uid;
      retry = setTimeout(() => {
      retry = null;
      if (currentUserId() === uid) void probeMentorAvailability(true, true).then(emit);
      }, MENTOR_AVAILABILITY_RETRY_MS);
    }
    return value;
  })().finally(() => { if (inflight === pending) { inflight = null; inflightUser = ""; } });
  inflight = pending;
  return pending;
}

export function useMentorAvailability(): MentorAvailability {
  const [state, setState] = useState<MentorAvailability>(seedMentorAvailability);
  useEffect(() => {
    let live = true;
    const listener = (value: MentorAvailability) => { if (live) setState(value); };
    listeners.add(listener);
    const probe = (force = false) => { void probeMentorAvailability(force).then(listener); };
    probe();
    const interval = setInterval(() => probe(shouldPollLive()), MENTOR_AVAILABILITY_POLL_MS);
    const visible = () => { if (document.visibilityState === "visible") probe(shouldPollLive()); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; listeners.delete(listener); clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return state;
}
export function resetMentorAvailabilityCache(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  retryUser = "";
  cache = null;
  inflight = null;
  inflightUser = "";
}
