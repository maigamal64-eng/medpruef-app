"use client";

/**
 * Records in-app route changes for goBack() (UX-GLOBAL-10). Renders nothing.
 * Mounted once in the root layout.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordNavigation } from "@/lib/go-back";

export default function NavigationMarker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname) recordNavigation(pathname);
  }, [pathname]);
  return null;
}
