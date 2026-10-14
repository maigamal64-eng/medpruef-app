"use client";

/**
 * a-d5b: the signed-in learner's exam deadline reminder opt-in, shared by the
 * Settings card and the quiet line under the Home deadline line. One read per
 * session token per two minutes in this tab (Home and Settings reuse it);
 * mutations update every mounted surface at once. Renders nothing until the
 * server says the surface exists ({available:false} without the secret).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { getSessionToken } from "@/lib/auth";

export type ExamReminderState = "off" | "pending" | "confirmed";
export type ExamReminderBank = "kenntnispruefung" | "kmp_innsbruck" | "pharma";
export interface ExamReminderView {
  email: string | null;
  exam: ExamReminderBank | null;
  state: ExamReminderState;
}
/** Outcome of the last action, for the status line. */
export type ExamReminderOutcome = "sent" | "cooldown" | "withheld" | "already_on" | "turned_off" | "no_email" | "unsupported" | "managed_elsewhere" | "rate_limited" | "failed";

const BANKS = new Set(["kenntnispruefung", "kmp_innsbruck", "pharma"]);
const STATES = new Set(["off", "pending", "confirmed"]);

/** Pure: the server view, or null when the surface is unavailable or the body is malformed. */
export function parseExamReminderView(body: unknown): ExamReminderView | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.available !== true || typeof b.state !== "string" || !STATES.has(b.state)) return null;
  return {
    email: typeof b.email === "string" && b.email ? b.email : null,
    exam: typeof b.exam === "string" && BANKS.has(b.exam) ? (b.exam as ExamReminderBank) : null,
    state: b.state as ExamReminderState,
  };
}

/** Pure: whether the opt-in prompt (not a status) may show: an address on file and a bank the sender serves. */
export function canOfferExamReminder(view: ExamReminderView | null): boolean {
  return !!view && view.state === "off" && !!view.email && !!view.exam;
}

/** Pure: the status line after a POST response. */
export function outcomeFromPost(status: number, body: Record<string, unknown> | null): ExamReminderOutcome {
  if (status === 429) return "rate_limited";
  if (status === 409) return body?.error === "no_email" ? "no_email" : body?.error === "managed_elsewhere" ? "managed_elsewhere" : "unsupported";
  if (status < 200 || status >= 300 || !body) return "failed";
  if (body.state === "confirmed") return "already_on";
  if (body.mail === "withheld") return "withheld";
  // A cooldown only means "check your inbox" while that link is still live;
  // after a withdrawal the last link is dead, so it is a plain "try later".
  if (body.mail === "cooldown") return body.state === "pending" ? "cooldown" : "rate_limited";
  return body.state === "pending" ? "sent" : "failed";
}

const TTL_MS = 2 * 60_000;
type Cache = { token: string; at: number; view: ExamReminderView | null };
let cache: Cache | null = null;
let inflight: { token: string; promise: Promise<ExamReminderView | null> } | null = null;
const listeners = new Set<(view: ExamReminderView | null) => void>();

function publish(token: string, view: ExamReminderView | null) {
  cache = { token, at: Date.now(), view };
  for (const listener of listeners) listener(view);
}

async function load(token: string): Promise<ExamReminderView | null> {
  if (cache && cache.token === token && Date.now() - cache.at < TTL_MS) return cache.view;
  if (!inflight || inflight.token !== token) {
    const promise: Promise<ExamReminderView | null> = (async () => {
      try {
        const res = await authFetch("/api/reminders/me", { skipAuthRedirect: true });
        const view = res.ok ? parseExamReminderView(await res.json().catch(() => null)) : null;
        // Only a definite answer is kept, and only while the same account is
        // signed in; a failed read retries on the next mount.
        if (res.ok && getSessionToken() === token) publish(token, view);
        return getSessionToken() === token ? view : null;
      } catch {
        return null;
      } finally {
        if (inflight?.token === token) inflight = null;
      }
    })();
    inflight = { token, promise };
  }
  return inflight.promise;
}

export function useExamReminder() {
  const [view, setView] = useState<ExamReminderView | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ExamReminderOutcome | null>(null);
  // A second tap before the first answer is ignored (state updates are async).
  const running = useRef(false);

  useEffect(() => {
    let alive = true;
    const token = getSessionToken();
    if (!token) return;
    const listener = (next: ExamReminderView | null) => { if (alive) setView(next); };
    listeners.add(listener);
    void load(token).then((next) => { if (alive) setView(next); });
    return () => { alive = false; listeners.delete(listener); };
  }, []);

  const act = useCallback(async (method: "POST" | "DELETE") => {
    const token = getSessionToken();
    if (!token || running.current) return null;
    running.current = true;
    setBusy(true);
    let next: ExamReminderOutcome;
    try {
      const res = await authFetch("/api/reminders/me", { method, skipAuthRedirect: true });
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (res.ok && getSessionToken() === token) publish(token, parseExamReminderView(body));
      next = method === "POST" ? outcomeFromPost(res.status, body) : res.ok ? "turned_off" : res.status === 429 ? "rate_limited" : "failed";
    } catch {
      next = "failed";
    }
    running.current = false;
    setBusy(false);
    setOutcome(next);
    return next;
  }, []);

  return {
    view,
    busy,
    outcome,
    optIn: useCallback(() => act("POST"), [act]),
    optOut: useCallback(() => act("DELETE"), [act]),
  };
}
