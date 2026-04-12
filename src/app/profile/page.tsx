"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Profile page merged into /settings as of April 12, 2026.
 * This redirect ensures existing links (bookmarks, BottomNav, emails) still work.
 */
export default function ProfileRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings");
  }, [router]);
  return null;
}
