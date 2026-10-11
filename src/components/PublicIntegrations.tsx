"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { installAdminNavigationBoundary, isAdminPath } from "@/lib/admin-route";
import ConsentGatedAnalytics from "./ConsentGatedAnalytics";
import ConsentGatedMetaPixel from "./ConsentGatedMetaPixel";
import ConsentGatedRedditPixel from "./ConsentGatedRedditPixel";
import WhopPixel from "./WhopPixel";

export default function PublicIntegrations() {
  const pathname = usePathname();
  useLayoutEffect(() => installAdminNavigationBoundary(window), []);
  if (!pathname || isAdminPath(pathname)) return null;
  return <>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
    <ConsentGatedAnalytics />
    <ConsentGatedMetaPixel />
    <ConsentGatedRedditPixel />
    <WhopPixel />
  </>;
}
