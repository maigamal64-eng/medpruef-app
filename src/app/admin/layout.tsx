"use client";

/**
 * Admin shell — mission-control deck.
 *
 * §2.1 + §2.11 of the April 23 admin revamp sprint.
 *
 * Structure:
 *  - Collapsible sidebar (Overview · Revenue · Content · Product · System)
 *  - Top bar with route refresh and browser-offline notice
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  ChevronDown,
  CreditCard,
  Database,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  Image as ImageIcon,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  RefreshCw,
  Rocket,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Sun,
  Ticket,
  Users,
  Wallet,
  Webhook,
  Zap,
} from "lucide-react";
import { clearSession, getStoredSession } from "@/lib/auth";
import { AdminAccessProvider, useAdminPermissions, type AdminPermission } from "@/lib/admin/useAdminPermissions";
import { ShortcutHint } from "./_components/primitives";

type SectionKey =
  | "overview"
  | "launch"
  | "growth"
  | "revenue"
  | "content"
  | "product"
  | "system";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Users;
  permission: AdminPermission;
  description?: string;
  /** Reserved for future gating (e.g., pay-wall specific routes). */
  experimental?: boolean;
  ownerOnly?: boolean;
}

interface NavSection {
  key: SectionKey;
  label: string;
  icon: typeof LayoutDashboard;
  shortcut: string;
  items: NavItem[];
  permission?: AdminPermission;
  /** For sections with a single "landing" href (Overview). */
  href?: string;
}

const NAV: NavSection[] = [
  {
    key: "overview",
    label: "Overview",
    icon: LayoutDashboard,
    shortcut: "o",
    permission: "overview.read",
    href: "/admin/overview",
    items: [],
  },
  {
    key: "launch",
    label: "Plan & Actions",
    icon: Rocket,
    shortcut: "l",
    permission: "overview.read",
    href: "/admin/launch",
    items: [],
  },
  {
    key: "growth",
    label: "Channels",
    icon: Sprout,
    shortcut: "w",
    permission: "overview.read",
    href: "/admin/growth",
    items: [],
  },
  {
    key: "revenue",
    label: "Revenue",
    icon: Wallet,
    shortcut: "r",
    items: [
      { label: "Users", href: "/admin/users", icon: Users, permission: "users.read" },
      { label: "Payments", href: "/admin/payments", icon: CreditCard, permission: "revenue.read" },
      { label: "Subscriptions", href: "/admin/subscriptions", icon: Ticket, permission: "revenue.read" },
      { label: "Referrals", href: "/admin/referrals", icon: GitBranch, permission: "revenue.read" },
      { label: "Waitlist", href: "/admin/waitlist", icon: BellRing, permission: "revenue.read" },
    ],
  },
  {
    key: "content",
    label: "Content",
    icon: FileText,
    shortcut: "c",
    items: [
      { label: "Questions", href: "/admin/questions", icon: FileText, permission: "content.read" },
      { label: "Question reports", href: "/admin/flagged", icon: ShieldAlert, permission: "content.read" },
      { label: "Media", href: "/admin/media", icon: ImageIcon, permission: "content.read" },
    ],
  },
  {
    key: "product",
    label: "Product",
    icon: Activity,
    shortcut: "p",
    items: [
      { label: "Feedback", href: "/admin/feedback", icon: MessageSquare, permission: "feedback.read" },
      { label: "Flags", href: "/admin/flags", icon: Flag, permission: "system.read" },
      { label: "PUYP", href: "/admin/puyp", icon: ShieldCheck, permission: "revenue.read" },
      { label: "Mentor cost", href: "/admin/mentor", icon: Gauge, permission: "revenue.read" },
    ],
  },
  {
    key: "system",
    label: "System",
    icon: Server,
    shortcut: "s",
    items: [
      { label: "Crons", href: "/admin/crons", icon: Gauge, permission: "system.read" },
      { label: "Deploys", href: "/admin/deploys", icon: Zap, permission: "system.read" },
      { label: "Webhooks", href: "/admin/webhooks", icon: Webhook, permission: "system.read" },
      { label: "Errors", href: "/admin/errors", icon: AlertTriangle, permission: "system.read" },
      { label: "Audit", href: "/admin/audit", icon: BarChart3, permission: "system.read" },
      { label: "Env", href: "/admin/env", icon: Database, permission: "system.read" },
      { label: "Admins & roles", href: "/admin/access", icon: ShieldCheck, permission: "access.manage" },
      { label: "Ops approvals", href: "/admin/ops", icon: ShieldCheck, permission: "access.manage", ownerOnly: true },
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
  return (
    <AdminAccessProvider>
      <AdminLayoutContent>{children}</AdminLayoutContent>
    </AdminAccessProvider>
  );
}

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { can, roles, loading: permissionsLoading, error: permissionsError } = useAdminPermissions();
  const actorIsOwner = roles.some((role) => role.key === "owner");
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [compactAdmin, setCompactAdmin] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [browserOffline, setBrowserOffline] = useState(false);
  const openNavButtonRef = useRef<HTMLButtonElement>(null);
  const closeNavButtonRef = useRef<HTMLButtonElement>(null);
  const navAsideRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setAdminNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const sync = () => setCompactAdmin(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!adminNavOpen) return;
    closeNavButtonRef.current?.focus();
    const trigger = openNavButtonRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
      if (compactAdmin) trigger?.focus();
    };
  }, [adminNavOpen, compactAdmin]);

  // Auth gate. requireAdmin on every /api/admin/* route is the real gate;
  // this is the cosmetic bounce so non-admins don't see a shell of 403s.
  useEffect(() => {
    const session = getStoredSession();
    if (!session?.user?.id) {
      router.replace(`/login?next=${encodeURIComponent((pathname || "/admin") + window.location.search)}`);
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

  // Report browser connectivity only when offline. A green server or
  // realtime health signal is not available to this shell.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setBrowserOffline(!navigator.onLine);
    const onOnline = () => sync();
    const onOffline = () => sync();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    sync();
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Keyboard shortcuts.
  const goTo = useCallback(
    (section: SectionKey) => {
      const target = NAV.find((s) => s.key === section && (!s.permission || can(s.permission)));
      if (!target) return;
      const href = target.href ?? target.items.find((item) => can(item.permission))?.href;
      if (href) router.push(href);
    },
    [can, router]
  );

  useEffect(() => {
    let leader = false;
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      // Ignore inside form fields.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      if (e.key === "Escape") {
        if (adminNavOpen) setAdminNavOpen(false);
        if (shortcutsOpen) setShortcutsOpen(false);
        return;
      }

      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen(true);
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
  }, [adminNavOpen, goTo, shortcutsOpen]);

  useEffect(() => {
    if (!adminNavOpen || !compactAdmin) return;
    const aside = navAsideRef.current;
    if (!aside) return;
    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== "Tab" || !aside) return;
      const focusable = Array.from(aside.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    aside.addEventListener("keydown", keepFocusInside);
    return () => aside.removeEventListener("keydown", keepFocusInside);
  }, [adminNavOpen, compactAdmin]);

  const navExpandedByDefault = useMemo<Set<SectionKey>>(() => {
    if (activeSection) return new Set([activeSection]);
    return new Set();
  }, [activeSection]);

  const visibleNav = useMemo(() => {
    if (permissionsLoading || permissionsError) return [];
    return NAV.map((section) => {
      if (section.permission && !can(section.permission)) return null;
      const items = section.items.filter((item) => can(item.permission) && (!item.ownerOnly || actorIsOwner));
      if (!section.href && items.length === 0) return null;
      return { ...section, items };
    }).filter((section): section is NavSection => section !== null);
  }, [actorIsOwner, can, permissionsError, permissionsLoading]);

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
      {compactAdmin && adminNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/55 lg:hidden"
          aria-label="Dismiss admin navigation backdrop"
          onClick={() => setAdminNavOpen(false)}
        />
      )}
      <aside
        ref={navAsideRef}
        aria-hidden={compactAdmin && !adminNavOpen}
        inert={compactAdmin && !adminNavOpen}
        role={compactAdmin ? "dialog" : undefined}
        aria-modal={compactAdmin && adminNavOpen ? true : undefined}
        className={`${compactAdmin ? "fixed z-50 w-[min(320px,88vw)] transition-transform" : `static z-auto ${sidebarCollapsed ? "w-[64px]" : "w-[240px]"} transition-[width]`} inset-y-0 left-0 flex-shrink-0 border-r border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] duration-200 ${compactAdmin && !adminNavOpen ? "-translate-x-full" : "translate-x-0"}`}
        aria-label="Admin navigation"
      >
        <div className="sticky top-0 flex flex-col h-dvh">
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
            {compactAdmin && (
              <button
                ref={closeNavButtonRef}
                type="button"
                onClick={() => setAdminNavOpen(false)}
                className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
                aria-label="Close admin navigation"
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((v) => !v)}
              className="hidden lg:inline-flex p-1 rounded hover:bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <ChevronDown
                size={14}
                className={`transition-transform ${sidebarCollapsed ? "-rotate-90" : "rotate-0"}`}
              />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-2" role="navigation" aria-label="Admin navigation">
            {visibleNav.map((section) => (
              <NavSectionView
                key={section.key}
                section={section}
                collapsed={sidebarCollapsed && !compactAdmin}
                activePath={pathname}
                initiallyOpen={navExpandedByDefault.has(section.key)}
              />
            ))}
            {permissionsLoading && (
              <p className="px-4 py-3 text-xs text-[var(--mp-fg-muted)]" role="status">Loading admin access…</p>
            )}
            {!permissionsLoading && permissionsError && (
              <p className="mx-3 my-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200" role="alert">
                Admin access could not be verified. Navigation is hidden until access is available.
              </p>
            )}
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
          <div className="flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-[52px] min-w-0">
            <button
              ref={openNavButtonRef}
              type="button"
              onClick={() => setAdminNavOpen(true)}
              className="lg:hidden inline-flex items-center justify-center w-9 h-9 rounded-lg text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] shrink-0"
              aria-label="Open admin navigation"
            >
              <Menu size={18} />
            </button>
            {browserOffline && <BrowserOfflineStatus />}
            <div className="flex-1 min-w-0" />
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1.5 shrink-0"
              title="Refresh current view"
            >
              <RefreshCw size={12} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <Link
              href="/"
              className="text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] px-1 sm:px-2 py-1 shrink-0"
            >
              Exit admin
            </Link>
          </div>
        </header>

        <main className="flex-1 min-w-0 p-3 sm:p-6 bg-[var(--mp-surface-sunken)]">
          {children}
        </main>
      </div>

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
              aria-current={active ? "page" : undefined}
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

function BrowserOfflineStatus() {
  return (
    <div role="status" className="flex shrink-0 items-center gap-1.5 text-[11px] text-amber-300">
      <span className="h-2 w-2 rounded-full bg-amber-400" />
      <span>Browser offline</span>
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
          <ShortcutRow keys="g l" label="Go to Plan & Actions" />
          <ShortcutRow keys="g w" label="Go to Channels" />
          <ShortcutRow keys="g r" label="Go to Revenue" />
          <ShortcutRow keys="g c" label="Go to Content" />
          <ShortcutRow keys="g p" label="Go to Product" />
          <ShortcutRow keys="g s" label="Go to System" />
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
