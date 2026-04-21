"use client";

/**
 * Admin shell.
 *
 * Owns the sticky oxford-blue header, the horizontal .mp-tabs strip
 * pointing at each nested route (/admin/dashboard, /admin/users, …),
 * and a lightweight client-side auth guard that redirects to /login
 * if the stored session doesn't look like an admin. The server-side
 * `requireAdmin` guard on every /api/stats/admin/* route remains the
 * real enforcement line — this layout guard just spares non-admins
 * from seeing a page full of 403s.
 *
 * Split from the 2,300-LOC monolith at src/app/admin/page.tsx as part
 * of backlog item #14 (Agent C, branch features/mpds-burndown).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Users,
  FileText,
  Activity,
  Settings,
  Sparkles,
  Shield,
  MessageSquarePlus,
  RotateCcw,
} from "lucide-react";
import { getStoredSession } from "@/lib/auth";

type Section = "dashboard" | "users" | "questions" | "analytics" | "feedback" | "changelog" | "system";

const NAV_ITEMS: { key: Section; label: string; icon: typeof LayoutDashboard; href: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/admin/dashboard" },
  { key: "users", label: "Users", icon: Users, href: "/admin/users" },
  { key: "questions", label: "Questions", icon: FileText, href: "/admin/questions" },
  { key: "analytics", label: "Analytics", icon: Activity, href: "/admin/analytics" },
  { key: "feedback", label: "Feedback", icon: MessageSquarePlus, href: "/admin/feedback" },
  { key: "changelog", label: "Changelog", icon: Sparkles, href: "/admin/changelog" },
  { key: "system", label: "System", icon: Settings, href: "/admin/system" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Lightweight client guard: if there's no session at all, boot to
  // /login. The server-side `requireAdmin` on every admin API is still
  // the real gate — this is purely a UX nicety so non-admins don't
  // stare at a forbidden page full of failed requests.
  useEffect(() => {
    const session = getStoredSession();
    if (!session?.user?.id) {
      router.replace("/login?next=" + encodeURIComponent(pathname || "/admin"));
      return;
    }
    setAuthChecked(true);
  }, [router, pathname]);

  // Derive the active tab from the current path so refreshing the page
  // or deep-linking keeps the right tab highlighted.
  const activeKey: Section | null = (() => {
    if (!pathname) return null;
    const match = NAV_ITEMS.find((i) => pathname.startsWith(i.href));
    return match ? match.key : null;
  })();

  const activeLabel = NAV_ITEMS.find((i) => i.key === activeKey)?.label || "Admin";

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center">
        <div className="h-4 w-4 rounded-full border-2 border-[var(--mp-viridian)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      {/* ═══ HEADER BAR (MPDS Admin-A) ═══ */}
      <header className="sticky top-0 z-20 bg-[var(--mp-oxford-blue)] border-b border-black/20">
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0 shadow-sm">
              <Shield size={16} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="mp-h3 text-white leading-tight flex items-center gap-2">
                MedPr&uuml;f Admin
                <span className="text-[10px] font-mono font-semibold bg-white/10 text-white/80 px-1.5 py-0.5 rounded uppercase tracking-wider">
                  {activeLabel}
                </span>
              </h1>
              <p className="text-[11px] text-white/60">Analytics &amp; Management</p>
            </div>
          </div>
          <button
            onClick={() => router.refresh()}
            className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
            aria-label="Refresh admin data"
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>

        {/* Horizontal .mp-tabs nav (7 tabs, overflow-x on narrow) */}
        <div className="px-4 sm:px-6 pb-3">
          <div className="overflow-x-auto -mx-2 px-2">
            <div
              className="mp-tabs"
              role="tablist"
              style={{ background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }}
            >
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeKey === item.key;
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    role="tab"
                    aria-selected={active}
                    className={`mp-tabs__tab ${active ? "mp-tabs__tab--active" : ""} flex items-center gap-1.5 whitespace-nowrap`}
                    style={!active ? { color: "rgba(255,255,255,0.7)" } : undefined}
                  >
                    <Icon size={14} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="min-w-0">
        <div className="px-4 sm:px-6 py-6">{children}</div>
      </main>
    </div>
  );
}
