"use client";

import { getStoredAttribution, type Attribution } from "@/lib/attribution";

export type FunnelEventName =
  | "landing_view"
  | "cta_click"
  | "registration_view"
  | "registration_success"
  | "first_answer"
  | "checkout_intent"
  | "purchase_success"
  | "study_plan_built"
  | "calendar_subscribe_click"
  | "code_entered_pre_signup"
  | "selftest_start"
  | "selftest_finish"
  | "selftest_register_click"
  | "partner_page_view"
  | "partner_request_sent";

const SESSION_KEY = "medpruef_funnel_session";
const SENT_KEY_PREFIX = "medpruef_funnel_sent:";

function id(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const next = id();
    sessionStorage.setItem(SESSION_KEY, next);
    return next;
  } catch {
    return id();
  }
}

function device(): "mobile" | "desktop" {
  return /Mobi|Android/i.test(navigator.userAgent) ? "mobile" : "desktop";
}

function attribution(): Attribution | null {
  const stored = getStoredAttribution();
  if (stored) return stored;
  const params = new URLSearchParams(window.location.search);
  const raw: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "rdt_cid"]) {
    const value = params.get(key);
    if (value) raw[key] = value.slice(0, 200);
  }
  return Object.keys(raw).length ? raw : null;
}

export function trackFunnelEvent(
  eventName: FunnelEventName,
  data: Record<string, string | number | boolean> = {},
  options: { once?: boolean } = {},
): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  const onceKey = `${SENT_KEY_PREFIX}${eventName}`;
  if (options.once) {
    try {
      if (sessionStorage.getItem(onceKey)) return;
      sessionStorage.setItem(onceKey, "1");
    } catch {
      // Measurement must not block the user journey.
    }
  }

  const body = JSON.stringify({
    sessionId: sessionId(),
    eventName,
    path: window.location.pathname.slice(0, 300),
    eventData: data,
    attribution: attribution(),
    lang: document.documentElement.lang || navigator.language.slice(0, 24),
    device: device(),
  });

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/funnel-events", new Blob([body], { type: "application/json" }));
    return;
  }
  void fetch("/api/funnel-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
