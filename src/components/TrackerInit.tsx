"use client";

import { useEffect } from "react";
import { initTracker } from "@/lib/tracker";
import { getStoredSession } from "@/lib/auth";

export default function TrackerInit() {
  useEffect(() => {
    const session = getStoredSession();
    const userId = session?.user?.id || "guest";
    initTracker(userId);
  }, []);

  return null;
}
