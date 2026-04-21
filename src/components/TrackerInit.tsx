"use client";

import { useEffect } from "react";
import { initTracker } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";
import { initOfflineSync } from "@/lib/offlineSync";

export default function TrackerInit() {
  useEffect(() => {
    const session = getStoredSession();
    const userId = session?.user?.id || "guest";
    initTracker(userId);
    // Wire up auto-drain of queued offline answers. Safe no-op when
    // IndexedDB is unavailable (Safari private mode, etc.).
    initOfflineSync();
  }, []);

  return null;
}
