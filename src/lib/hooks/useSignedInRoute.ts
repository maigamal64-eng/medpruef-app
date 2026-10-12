"use client";

/**
 * Signed-out visitors on a learner route (UX-GLOBAL-17, PRA-57, EXM-20,
 * ACC-37): one pattern, a redirect to
 * /login?reason=signin_required&next=<validated>, where the login page shows
 * one context line naming the destination. A guest_ session counts as signed
 * out. Pages holding unsaved local values use their own in-page card instead.
 */
import { useEffect, useState } from "react";
import { getStoredSession } from "@/lib/auth";
import { buildAuthHref } from "@/lib/auth-entry";

export function signInRequiredHref(next: string): string {
  return buildAuthHref({ next }, "signin_required");
}

/** Returns true once a signed-in session is confirmed on this device. */
export function useSignedInRoute(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = getStoredSession()?.user?.id;
    if (!id || id.startsWith("guest_")) {
      window.location.replace(signInRequiredHref(window.location.pathname + window.location.search));
      return;
    }
    setReady(true);
  }, []);
  return ready;
}
