"use client";

/**
 * Records in-app route changes for goBack() (UX-GLOBAL-10). Renders nothing.
 * Mounted once in the root layout. Browser Back shrinks the trail; a document
 * load that did not come from this app starts a fresh one.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordNavigation, resetTrail } from "@/lib/go-back";

export default function NavigationMarker() {
  const pathname = usePathname();
  const traversal = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    const onPop = () => { traversal.current = true; };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!pathname) return;
    if (!started.current) {
      started.current = true;
      let sameOrigin = false;
      try { sameOrigin = !!document.referrer && new URL(document.referrer).origin === window.location.origin; } catch { /* no referrer */ }
      const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (!sameOrigin && nav?.type !== "reload" && nav?.type !== "back_forward") resetTrail();
    }
    recordNavigation(pathname, traversal.current);
    traversal.current = false;
  }, [pathname]);
  return null;
}
