"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import TelegramSdkLoader from "./TelegramSdkLoader";
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
    <TelegramSdkLoader />
    <ConsentGatedAnalytics />
    <ConsentGatedMetaPixel />
    <ConsentGatedRedditPixel />
    <WhopPixel />
  </>;
}
