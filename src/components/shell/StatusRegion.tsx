"use client";

/**
 * StatusRegion — the one top status region (UX-GLOBAL-11).
 *
 * Hosts every banner and status strip (offline, update, guest, renewal,
 * cohort) in the gate's priority order: in flow, sticky to the top, one at a
 * time on phones (CSS). Publishes its height as --mp-banner-h on <html>, so
 * sticky headers, the Sidebar and scroll-padding-top sit below it and focus
 * never lands under a banner. Not mounted in focus mode: the running exam
 * reserves its own status row.
 */

import { useEffect, useRef } from "react";
import { useFocusMode } from "@/lib/focus-mode";

export default function StatusRegion({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const focus = useFocusMode();

  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el || typeof ResizeObserver === "undefined") return;
    const publish = () => root.style.setProperty("--mp-banner-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => { observer.disconnect(); root.style.setProperty("--mp-banner-h", "0px"); };
  }, [focus]);

  if (focus) return null;
  return (
    <div ref={ref} className="mp-status-region" data-status-region="">
      {children}
    </div>
  );
}

/**
 * One banner slot. display:contents keeps layout untouched; an empty slot
 * (the banner rendered nothing) does not count, so on phones the first
 * non-empty slot wins.
 */
export function StatusSlot({ name, children }: { name: string; children: React.ReactNode }) {
  return <div data-status-banner={name} className="mp-status-slot">{children}</div>;
}
