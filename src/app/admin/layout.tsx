"use client";

/**
 * Admin shell — mission-control deck.
 *
 * §2.1 + §2.11 of the April 23 admin revamp sprint.
 *
 * Structure:
 *  - Collapsible sidebar (Overview · Revenue · Content · Product · System)
 *  - Top bar with connection indicator, Cmd+K global search, user menu
 *  - Keyboard shortcuts: g o/r/c/p/s, /, ?, Esc
 *  - Dark-mode first: the admin subtree gets data-theme='dark' applied to
 *    the <html> element unless localStorage('medpruef_admin_theme') overrides.
 *    The public app's theme preference is saved + restored when leaving /admin.
 *
 * Server-side, every /api/admin/* route is guarded by requireAdmin(); this
 * client layout just does the UX courtesy of bouncing unauthenticated visitors
 * before they see a page of 403 shells.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  ChevronDown,
  ClipboardCheck,
  Command,
  Cpu,
  CreditCard,
  Database,
  FileText,
  Flag,
  FlaskConical,
  Gauge,
  GitBranch,
  Image as ImageIcon,
  Keyboard,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map,
  MessageSquare,
  Moon,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Sun,
  TerminalSquare,
  Ticket,
  TrendingUp,
  Users,
  Wallet,
  Webhook,
  Zap,
} from "lucide-react";
import { clearSession, getStoredSession } from "@/lib/auth";
import { ShortcutHint } from "./_components/primitives";

type SectionKey =
  | "overview"
  | "control-plane"
  | "actions"
  | "growth"
  | "plan"
  | "revenue"
  | "content"
  | "product"
  | "system";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Users;
  description?: string;
  /** Reserved for future gating (e.g., pay-wall specific routes). */
  experimental?: boolean;
}

interface NavSection {
  key: SectionKey;
  label: string;
  icon: typeof LayoutDashboard;
  shortcut: string;
  items: NavItem[];
  /** For sections with a single "landing" href (Overview). */
  href?: string;
}

const NAV: NavSection[] = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    shortcut: "o",
    href: "/admin/overview",
    items: [],
  },
  {
    key: "control-plane",
    label: "Control Plane",
    icon: Cpu,
    shortcut: "a",
    href: "/admin/control-plane",
    items: [],
  },
  {
    key: "actions",
    label: "Actions",
    icon: ClipboardCheck,
    shortcut: "x",
    href: "/admin/actions",
    items: [],
  },
  {
    key: "growth",
    label: "Growth",
    icon: Sprout,
    shortcut: "w",
    href: "/admin/growth",
    items: [],
  },
  {
    key: "plan",
    label: "Plan",
    icon: Map,
    shortcut: "l",
    href: "/admin/plan",
    items: [],
  },
  {
    key: "revenue",
    label: "Revenue",
    icon: Wallet,
    shortcut: "r",
    items: [
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Payments", href: "/admin/payments", icon: CreditCard },
      { label: "Subscriptions", href: "/admin/subscriptions", icon: Ticket },
      { label: "Referrals", href: "/admin/referrals", icon: GitBranch },
      { label: "Waitlist", href: "/admin/waitlist", icon: BellRing },
    ],
  },
  {
    key: "content",
    label: "Content",
    icon: FileText,
    shortcut: "c",
    items: [
      { label: "Questions", href: "/admin/questions", icon: FileText },
      { label: "Flagged", href: "/admin/flagged", icon: ShieldAlert },
      { label: "Media", href: "/admin/media", icon: ImageIcon },
    ],
  },
  {
    key: "product",
    label: "Product",
    icon: Activity,
    shortcut: "p",
    items: [
      { label: "Feedback", href: "/admin/feedback", icon: MessageSquare },
      { label: "Funnels", href: "/admin/funnels", icon: TrendingUp },
      { label: "Flags", href: "/admin/flags", icon: Flag },
      { label: "Experiments", href: "/admin/experiments", icon: FlaskConical },
      { label: "PUYP", href: "/admin/puyp", icon: ShieldCheck },
    ],
  },
  {
    key: "system",
    label: "System",
    icon: Server,
    shortcut: "s",
    items: [
      { label: "Crons", href: "/admin/crons", icon: Gauge },
      { label: "Deploys", href: "/admin/deploys", icon: Zap },
      { label: "Webhooks", href: "/admin/webhooks", icon: Webhook },
      { label: "Errors", href: "/admin/errors", icon: AlertTriangle },
      { label: "Audit", href: "/admin/audit", icon: BarChart3 },
      { label: "SQL", href: "/admin/sql", icon: TerminalSquare },
      { label: "Env", href: "/admin/env", icon: Database },
    ],
  },
];

const THEME_KEY = "medpruef_admin_theme";
const PREV_THEME_KEY = "medpruef_admin_prev_app_theme";
const APP_THEME_ATTR = "data-theme";

type Theme = "light" | "dark";

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [connectionState, setConnectionState] =
    useState<"connected" | "connecting" | "offline">("connecting");
  const [lastEventAt, setLastEventAt] = useState<Date>(new Date());

  // Auth gate. requireAdmin on every /api/admin/* route is the real gate;
  // this is the cosmetic bounce so non-admins don't see a shell of 403s.
  useEffect(() => {
    const session = getStoredSession();
    if (!session?.user?.id) {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/admin")}`);
      return;
    }
    setAuthChecked(true);
  }, [router, pathname]);

  // Theme: apply admin theme on entering /admin/*, restore on leaving.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const prevFromStore = localStorage.getItem(PREV_THEME_KEY);
    const currentAttr = (root.getAttribute(APP_THEME_ATTR) as Theme | null) ?? "light";

    // Record the app-wide theme the first time we mount, so we can put
    // it back when the admin unmounts.
    if (!prevFromStore) {
      localStorage.setItem(PREV_THEME_KEY, currentAttr);
    }

    const stored = getStoredTheme();
    const next: Theme = stored ?? "dark";
    setTheme(next);
    root.setAttribute(APP_THEME_ATTR, next);

    return () => {
      // Restore the app theme when the admin layout unmounts.
      const prev = localStorage.getItem(PREV_THEME_KEY) as Theme | null;
      if (prev) {
        document.documentElement.setAttribute(APP_THEME_ATTR, prev);
        localStorage.removeItem(PREV_THEME_KEY);
      }
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute(APP_THEME_ATTR, next);
  }

  // Derive active section from the pathname.
  useEffect(() => {
    if (!pathname) return setActiveSection(null);
    for (const section of NAV) {
      if (section.href && pathname.startsWith(section.href)) {
        setActiveSection(section.key);
        return;
      }
      for (const item of section.items) {
        if (pathname.startsWith(item.href)) {
          setActiveSection(section.key);
          return;
        }
      }
    }
    setActiveSection(null);
  }, [pathname]);

  // Heartbeat: the app doesn't have a global realtime connection signal
  // yet (each `useAdminRealtime` runs its own channel). For the header
  // we simulate a "connecting → connected" status by listening to the
  // browser's online/offline events and stamping a heartbeat on visibility.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = () => setConnectionState("connected");
    const onOffline = () => setConnectionState("offline");
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    setConnectionState(navigator.onLine ? "connected" : "offline");

    const tick = setInterval(() => setLastEventAt(new Date()), 30_000);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      clearInterval(tick);
    };
  }, []);

  // Keyboard shortcuts.
  const goTo = useCallback(
    (section: SectionKey) => {
      const target = NAV.find((s) => s.key === section);
      if (!target) return;
      const href = target.href ?? target.items[0]?.href;
      if (href) router.push(href);
    },
    [router]
  );

  useEffect(() => {
    let leader = false;
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      // Ignore inside form fields.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        // Only allow the universal shortcuts in fields.
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault();
          setSearchOpen(true);
        }
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (e.key === "Escape") {
        if (searchOpen) setSearchOpen(false);
        if (shortcutsOpen) setShortcutsOpen(false);
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (e.key === "/" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (e.key === "g" && !e.metaKey && !e.ctrlKey && !leader) {
        leader = true;
        if (leaderTimer) clearTimeout(leaderTimer);
        leaderTimer = setTimeout(() => {
          leader = false;
        }, 1200);
        return;
      }

      if (leader) {
        const key = e.key.toLowerCase();
        const section = NAV.find((s) => s.shortcut === key);
        if (section) {
          e.preventDefault();
          goTo(section.key);
          leader = false;
          if (leaderTimer) clearTimeout(leaderTimer);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, searchOpen, shortcutsOpen]);

  const navExpandedByDefault = useMemo<Set<SectionKey>>(() => {
    if (activeSection) return new Set([activeSection]);
    return new Set();
  }, [activeSection]);

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center">
        <div className="h-4 w-4 rounded-full border-2 border-[var(--mp-viridian)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="admin-shell min-h-screen flex" data-admin="1">
      {/*
        Dark-mode-first bootstrap — runs on first paint, before React
        hydration completes, so the tiles render with the right tokens
        even on a hard refresh. The useEffect above keeps the attribute
        in sync afterwards.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){
              try {
                var stored = localStorage.getItem('medpruef_admin_theme');
                var theme = (stored === 'light' || stored === 'dark') ? stored : 'dark';
                document.documentElement.setAttribute('data-theme', theme);
              } catch (e) {
                document.documentElement.setAttribute('data-theme', 'dark');
              }
            })();
          `,
        }}
      />
      {/* ═══ SIDEBAR ═══ */}
      <aside
        className={`${sidebarCollapsed ? "w-[64px]" : "w-[240px]"} flex-shrink-0 border-r border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] transition-all duration-200`}
        aria-label="Admin navigation"
      >
        <div className="sticky top-0 flex flex-col h-screen">
          <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--mp-border-subtle)]">
            <div className="w-8 h-8 rounded-lg bg-[var(--mp-viridian)] flex items-center justify-center flex-shrink-0">
              <Shield size={14} className="text-white" />
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--mp-fg)] truncate">
                  MedPr&uuml;f Ops
                </div>
                <div className="text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-wider">
                  Mission Control
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="p-1 rounded hover:bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${sidebarCollapsed ? "-rotate-90" : "rotate-0"}`}
              />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-2" role="navigation">
            {NAV.map((section) => (
              <NavSectionView
                key={section.key}
                section={section}
                collapsed={sidebarCollapsed}
                activePath={pathname}
                initiallyOpen={navExpandedByDefault.has(section.key)}
              />
            ))}
          </nav>

          <div className="border-t border-[var(--mp-border-subtle)] px-2 py-2 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={14} />
              {!sidebarCollapsed && <span>Shortcuts</span>}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
              title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              {!sidebarCollapsed && (
                <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                clearSession();
                router.replace("/login");
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
            >
              <LogOut size={14} />
              {!sidebarCollapsed && <span>Sign out</span>}
            </button>
          </div>
        </div>
      </aside>

      {/* ═══ MAIN ═══ */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-[var(--mp-surface-raised)] border-b border-[var(--mp-border-subtle)]">
          <div className="flex items-center gap-3 px-4 h-[52px]">
            <ConnectionIndicator state={connectionState} lastEventAt={lastEventAt} />
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-2 py-1.5 text-xs rounded-md border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] min-w-[240px]"
              aria-label="Global search"
            >
              <Search size={13} />
              <span className="flex-1 text-left">Search admins, users, questions…</span>
              <kbd className="font-mono text-[10px] bg-[var(--mp-surface-raised)] border border-[var(--mp-border-subtle)] rounded px-1 py-0.5">
                ⌘K
              </kbd>
            </button>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5"
              title="Refresh current view"
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              href="/"
              className="text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] px-2 py-1"
            >
              Exit admin
            </Link>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-6 bg-[var(--mp-surface-sunken)]">
          {children}
        </main>
      </div>

      {searchOpen && <GlobalSearchDialog onClose={() => setSearchOpen(false)} />}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function NavSectionView({
  section,
  collapsed,
  activePath,
  initiallyOpen,
}: {
  section: NavSection;
  collapsed: boolean;
  activePath: string | null;
  initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);

  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);

  const Icon = section.icon;

  const hasChildren = section.items.length > 0;
  const sectionActive =
    !!section.href && !!activePath && activePath.startsWith(section.href);
  const anyChildActive = section.items.some(
    (i) => activePath?.startsWith(i.href) ?? false
  );

  const rowBase =
    "flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors";
  const rowActive =
    "bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)] font-medium";
  const rowIdle = "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]";

  if (!hasChildren) {
    // Single-landing section (Overview).
    const href = section.href ?? "/admin";
    return (
      <Link
        href={href}
        className={`${rowBase} ${sectionActive ? rowActive : rowIdle} mx-2 my-0.5`}
        title={collapsed ? `${section.label} (g ${section.shortcut})` : undefined}
      >
        <Icon size={16} />
        {!collapsed && <span>{section.label}</span>}
        {!collapsed && (
          <span className="ml-auto inline-flex items-center gap-0.5">
            <ShortcutHint keys="g" />
            <ShortcutHint keys={section.shortcut} />
          </span>
        )}
      </Link>
    );
  }

  return (
    <div className="mx-2 my-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${rowBase} ${anyChildActive ? rowActive : rowIdle} w-full`}
        title={collapsed ? `${section.label} (g ${section.shortcut})` : undefined}
        aria-expanded={open}
      >
        <Icon size={16} />
        {!collapsed && <span className="flex-1 text-left">{section.label}</span>}
        {!collapsed && (
          <>
            <span className="inline-flex items-center gap-0.5">
              <ShortcutHint keys="g" />
              <ShortcutHint keys={section.shortcut} />
            </span>
            <ChevronDown
              size={12}
              className={`transition-transform ${open ? "rotate-0" : "-rotate-90"} text-[var(--mp-fg-muted)]`}
            />
          </>
        )}
      </button>
      {open && !collapsed && (
        <div className="ml-5 mt-0.5 border-l border-[var(--mp-border-subtle)] pl-2 flex flex-col gap-0.5">
          {section.items.map((item) => {
            const ItemIcon = item.icon;
            const active = activePath?.startsWith(item.href) ?? false;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                  active
                    ? "bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)]"
                    : "text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                }`}
              >
                <ItemIcon size={12} />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConnectionIndicator({
  state,
  lastEventAt,
}: {
  state: "connected" | "connecting" | "offline";
  lastEventAt: Date;
}) {
  const color =
    state === "connected"
      ? "bg-emerald-500"
      : state === "connecting"
        ? "bg-amber-500"
        : "bg-red-500";
  const label =
    state === "connected"
      ? "Live"
      : state === "connecting"
        ? "Connecting"
        : "Offline";
  return (
    <div
      className="flex items-center gap-1.5 text-[11px] text-[var(--mp-fg-muted)] font-mono"
      title={`Last heartbeat ${lastEventAt.toLocaleTimeString()}`}
    >
      <span className={`w-2 h-2 rounded-full ${color} ${state === "connected" ? "animate-pulse" : ""}`} />
      <span>{label}</span>
    </div>
  );
}

function GlobalSearchDialog({ onClose }: { onClose: () => void }) {
  // Minimal scaffold. The full search endpoint lands in a follow-up sprint.
  // This modal at least gives Cmd+K a visible destination.
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl bg-[var(--mp-surface-raised)] border border-[var(--mp-border-subtle)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-3 py-3 border-b border-[var(--mp-border-subtle)]">
          <Command size={14} className="text-[var(--mp-fg-muted)]" />
          <input
            autoFocus
            placeholder="Search users, questions, referrals, feedback…"
            className="flex-1 bg-transparent text-sm outline-none text-[var(--mp-fg)] placeholder:text-[var(--mp-fg-muted)]"
          />
          <kbd className="font-mono text-[10px] text-[var(--mp-fg-muted)]">Esc</kbd>
        </div>
        <div className="p-6 text-center text-xs text-[var(--mp-fg-muted)]">
          <LifeBuoy size={24} className="mx-auto mb-2 opacity-60" />
          Global admin search ships in a follow-up sprint. Use the per-tab
          filter for now.
        </div>
      </div>
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg mx-4 rounded-xl bg-[var(--mp-surface-raised)] border border-[var(--mp-border-subtle)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--mp-border-subtle)]">
          <div className="flex items-center gap-2">
            <Keyboard size={14} />
            <span className="text-sm font-semibold text-[var(--mp-fg)]">
              Keyboard shortcuts
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
          >
            Close
          </button>
        </div>
        <div className="p-4 text-xs text-[var(--mp-fg-muted)] grid grid-cols-2 gap-x-6 gap-y-2">
          <ShortcutRow keys="g o" label="Go to Overview" />
          <ShortcutRow keys="g a" label="Go to Control Plane" />
          <ShortcutRow keys="g x" label="Go to Action Queue" />
          <ShortcutRow keys="g w" label="Go to Growth" />
          <ShortcutRow keys="g l" label="Go to Plan" />
          <ShortcutRow keys="g r" label="Go to Revenue" />
          <ShortcutRow keys="g c" label="Go to Content" />
          <ShortcutRow keys="g p" label="Go to Product" />
          <ShortcutRow keys="g s" label="Go to System" />
          <ShortcutRow keys="⌘K" label="Global search" />
          <ShortcutRow keys="/" label="Focus search" />
          <ShortcutRow keys="?" label="This dialog" />
          <ShortcutRow keys="Esc" label="Close dialogs" />
        </div>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      <kbd className="font-mono text-[10px] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-subtle)] rounded px-1.5 py-0.5 text-[var(--mp-fg)]">
        {keys}
      </kbd>
    </div>
  );
}
