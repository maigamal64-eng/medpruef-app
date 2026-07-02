"use client";

import { useEffect } from "react";
import { captureAttributionFromUrl } from "@/lib/attribution";

/**
 * Mounts once in the root layout. On first load with campaign params in the
 * URL (utm_* / rdt_cid), stores them first-touch to localStorage so the
 * register call can attribute the signup. Renders nothing, never blocks.
 */
export default function AttributionCapture() {
  useEffect(() => {
    captureAttributionFromUrl();
  }, []);
  return null;
}
