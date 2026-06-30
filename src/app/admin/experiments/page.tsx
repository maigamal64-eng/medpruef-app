"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Tab consolidated (admin nav refactor 2026-06-30) -> /admin/growth
export default function RedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/growth");
  }, [router]);
  return null;
}
