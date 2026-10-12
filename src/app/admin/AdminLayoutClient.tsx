"use client";

/**
 * Admin shell (a18, ADM-11 A): menu grouped around the founder's jobs.
 *
 *  - Sidebar from ./_components/admin-nav.ts: Today · Inbox · Learners ·
 *    Money · Content · Growth · System. Inbox items carry count chips from
 *    /api/admin/inbox (one load in AdminChromeProvider, polled every 60 s
 *    while visible). A count that failed to load reads "--", never 0.
 *  - Collapsed desktop rail (UX-ADM-28): a section icon expands the rail
 *    with that section open.
 *  - Phones and tablets (<1024px): bottom bar Today / Inbox / Find / Money /
 *    More with 44px targets (ADM-14 A); the drawer holds the full menu.
 *  - Top bar: menu button with the Inbox total, the page title (set by
 *    AdminPageShell, which also sets the tab title), Find learner, Exit.
 *    No top-bar Refresh: each page owns its Refresh (UX-ADM-29, ADM-Q21).
 *  - Keyboard: g + t/i/u/m/c/g/s (old g o, g r, g w still work), / focuses
 *    Find learner, ? lists shortcuts, Esc closes.
 *  - Theme (UX-ADM-38): the admin applies its own theme; the public app's
 *    theme is saved per tab in sessionStorage and put back when the admin
 *    unmounts, so a second admin tab cannot leave the app in admin dark mode.
 *    Every storage access goes through safeStorage.
 *
 * Server-side, every /api/admin/* route is guarded by requireAdmin(); this
 * client layout just does the UX courtesy of bouncing unauthenticated visitors
 * before they see a page of 403 shells.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Inbox,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Search,
  Shield,
  Sun,
  Wallet,
} from "lucide-react";
import { clearSession, getStoredSession } from "@/lib/auth";
import { safeSessionStorage, safeStorage } from "@/lib/safe-storage";
import { AdminAccessProvider, useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { ShortcutHint } from "./_components/primitives";
import { SignOutEverywhere } from "./_components/SignOutEverywhere";
import { FindLearner, FIND_LEARNER_INPUT_ID } from "./_components/FindLearner";
import { ADMIN_NAV, SHORTCUT_ALIASES, sumCounts, type InboxKey, type NavSection, type SectionKey } from "./_components/admin-nav";
import { AdminChromeProvider, useAdminChrome, type InboxState } from "./_components/admin-chrome";

const THEME_KEY = "medpruef_admin_theme";
const PREV_THEME_KEY = "medpruef_admin_prev_app_theme";
const APP_THEME_ATTR = "data-theme";

type Theme = "light" | "dark";

function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const v = safeStorage.getItem(THEME_KEY);
  return v === "light" || v === "dark" ? v : null;
}

function focusFindLearner(): boolean {
  const input = document.getElementById(FIND_LEARNER_INPUT_ID);
  if (!(input instanceof HTMLInputElement)) return false;
  input.focus();
  return true;
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAccessProvider>
      <AdminChromeGate>
        <AdminLayoutContent>{children}</AdminLayoutContent>
      </AdminChromeGate>
    </AdminAccessProvider>
  );
}

function AdminChromeGate({ children }: { children: React.ReactNode }) {
  const { can, loading, error } = useAdminPermissions();
  const enabled = !loading && !error && (can("content.read") || can("feedback.read") || can("revenue.read") || can("access.manage"));
  return <AdminChromeProvider enabled={enabled}>{children}</AdminChromeProvider>;
}

type Badge = { total: number; unknown: boolean };

function AdminLayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { can, roles, loading: permissionsLoading, error: permissionsError } = useAdminPermissions();
  const { inbox, refreshInbox, pageTitle } = useAdminChrome();
  const actorIsOwner = roles.some((role) => role.key === "owner");
  const [authChecked, setAuthChecked] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [compactAdmin, setCompactAdmin] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionKey | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [browserOffline, setBrowserOffline] = useState(false);
  /** A section the shell asked to open (rail click, bottom-bar Inbox). */
  const [forcedOpen, setForcedOpen] = useState<{ key: SectionKey; n: number } | null>(null);
  const openNavButtonRef = useRef<HTMLButtonElement>(null);
  const closeNavButtonRef = useRef<HTMLButtonElement>(null);
  const navAsideRef = useRef<HTMLElement>(null);

  const openSection = useCallback((key: SectionKey) => {
    setForcedOpen((prev) => ({ key, n: (prev?.n ?? 0) + 1 }));
  }, []);

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
    if (session.user.role !== "admin") {
      router.replace("/");
      return;
    }
    setAuthChecked(true);
  }, [router, pathname]);

  // Theme: apply the admin theme on entering /admin/*, restore the app's
  // theme on leaving. The app theme is remembered per tab (sessionStorage).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const currentAttr = (root.getAttribute(APP_THEME_ATTR) as Theme | null) ?? "light";
    if (!safeSessionStorage.getItem(PREV_THEME_KEY)) {
      safeSessionStorage.setItem(PREV_THEME_KEY, currentAttr);
    }
    const next: Theme = getStoredTheme() ?? "dark";
    setTheme(next);
    root.setAttribute(APP_THEME_ATTR, next);

    return () => {
      const prev = safeSessionStorage.getItem(PREV_THEME_KEY);
      if (prev === "light" || prev === "dark") {
        document.documentElement.setAttribute(APP_THEME_ATTR, prev);
      }
      safeSessionStorage.removeItem(PREV_THEME_KEY);
    };
    // Run once on mount.
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    safeStorage.setItem(THEME_KEY, next);
    document.documentElement.setAttribute(APP_THEME_ATTR, next);
  }

  // Derive active section from the pathname.
  useEffect(() => {
    if (!pathname) return setActiveSection(null);
    for (const section of ADMIN_NAV) {
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

  // Counts follow navigation too, so a closed item drops off the badge.
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) { firstPath.current = false; return; }
    void refreshInbox();
  }, [pathname, refreshInbox]);

  // Report browser connectivity only when offline. A green server or
  // realtime health signal is not available to this shell.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setBrowserOffline(!navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  const visibleNav = useMemo(() => {
    if (permissionsLoading || permissionsError) return [];
    return ADMIN_NAV.map((section) => {
      if (section.permission && !can(section.permission)) return null;
      const items = section.items.filter((item) => can(item.permission) && (!item.ownerOnly || actorIsOwner));
      if (!section.href && items.length === 0) return null;
      return { ...section, items };
    }).filter((section): section is NavSection => section !== null);
  }, [actorIsOwner, can, permissionsError, permissionsLoading]);

  const landingFor = useCallback(
    (key: SectionKey) => {
      const target = visibleNav.find((s) => s.key === key);
      return target ? target.href ?? target.items[0]?.href ?? null : null;
    },
    [visibleNav],
  );

  // Inbox total for the menu button and the bottom bar: the visible inbox items only.
  const inboxBadge = useMemo<Badge>(() => {
    const keys = visibleNav.find((s) => s.key === "inbox")?.items.flatMap((i) => i.badgeKeys ?? []) ?? [];
    return sumCounts(inbox.counts, keys, inbox.failed);
  }, [inbox, visibleNav]);
  const canFind = !permissionsLoading && !permissionsError && can("users.read");

  // Keyboard shortcuts.
  useEffect(() => {
    let leader = false;
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) {
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

      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !leader) {
        if (focusFindLearner()) e.preventDefault();
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
        const sectionKey = ADMIN_NAV.find((s) => s.shortcut === key)?.key ?? SHORTCUT_ALIASES[key];
        leader = false;
        if (leaderTimer) clearTimeout(leaderTimer);
        const href = sectionKey ? landingFor(sectionKey) : null;
        if (href) {
          e.preventDefault();
          router.push(href);
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adminNavOpen, landingFor, shortcutsOpen, router]);

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

  const railCollapsed = sidebarCollapsed && !compactAdmin;

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
            {!railCollapsed && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[var(--mp-fg)] truncate">
                  MedPr&uuml;f Ops
                </div>
                <div className="text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-wider">
                  Admin
                </div>
              </div>
            )}
            {compactAdmin && (
              <button
                ref={closeNavButtonRef}
                type="button"
                onClick={() => setAdminNavOpen(false)}
                className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-lg text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
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
                inbox={inbox}
                collapsed={railCollapsed}
                activePath={pathname}
                initiallyOpen={activeSection === section.key}
                forcedOpen={forcedOpen?.key === section.key ? forcedOpen.n : 0}
                onRailExpand={() => {
                  // UX-ADM-28: a section icon on the collapsed rail opens the rail on that section.
                  setSidebarCollapsed(false);
                  openSection(section.key);
                }}
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
              {!railCollapsed && <span>Shortcuts</span>}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
              title={`Switch to ${theme === "dark" ? "light" : "dark"}`}
            >
              {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
              {!railCollapsed && (
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
              {!railCollapsed && <span>Sign out</span>}
            </button>
            <SignOutEverywhere collapsed={railCollapsed} />
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
              className="lg:hidden relative inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] shrink-0"
              aria-label={`Open admin navigation${inboxBadge.unknown ? ", inbox count unavailable" : inboxBadge.total > 0 ? `, ${inboxBadge.total} waiting in Inbox` : ""}`}
            >
              <Menu size={18} />
              <CornerBadge badge={inboxBadge} />
            </button>
            {pageTitle && (
              <div className="min-w-0 max-w-[40%] sm:max-w-[45%] truncate text-sm font-semibold text-[var(--mp-fg)]" data-testid="admin-topbar-title">
                {pageTitle}
              </div>
            )}
            {browserOffline && <BrowserOfflineStatus />}
            <div className="flex-1 min-w-0 flex justify-end">
              <FindLearner />
            </div>
            <Link
              href="/"
              className="inline-flex min-h-11 items-center text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] px-1 sm:px-2 shrink-0"
            >
              Exit admin
            </Link>
          </div>
        </header>

        <main className={`flex-1 min-w-0 p-3 sm:p-6 bg-[var(--mp-surface-sunken)] ${compactAdmin ? "pb-[calc(5rem+env(safe-area-inset-bottom))]" : ""}`}>
          {children}
        </main>
      </div>

      {compactAdmin && !permissionsLoading && !permissionsError && (
        <AdminBottomBar
          pathname={pathname}
          todayHref={landingFor("today")}
          moneyHref={landingFor("money")}
          showInbox={visibleNav.some((s) => s.key === "inbox")}
          inboxBadge={inboxBadge}
          canFind={canFind}
          onInbox={() => { openSection("inbox"); setAdminNavOpen(true); }}
          onMore={() => setAdminNavOpen(true)}
        />
      )}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

/** Count chip: a number when known and above 0, "--" when it failed to load. */
function InboxBadge({ badge, label }: { badge: Badge; label: string }) {
  if (badge.unknown) {
    return (
      <span className="ml-auto min-w-5 rounded-full border border-[var(--mp-border-subtle)] px-1.5 py-0.5 text-center font-mono text-[11px] leading-none text-[var(--mp-fg-muted)]" aria-label={`${label}: count unavailable`} title="Count could not be loaded">
        --
      </span>
    );
  }
  if (badge.total <= 0) return null;
  return (
    <span className="ml-auto min-w-5 rounded-full bg-[var(--mp-error)] px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold leading-none text-white" aria-label={`${badge.total} open ${label}`}>
      {badge.total > 99 ? "99+" : badge.total}
    </span>
  );
}

/** Small badge pinned to an icon button (menu button, bottom bar). */
function CornerBadge({ badge }: { badge: Badge }) {
  if (!badge.unknown && badge.total <= 0) return null;
  return (
    <span
      aria-hidden
      data-testid="admin-inbox-corner-badge"
      className={`absolute -top-0.5 right-0 min-w-4 rounded-full px-1 py-px text-center font-mono text-[10px] font-semibold leading-tight ${badge.unknown ? "border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] text-[var(--mp-fg-muted)]" : "bg-[var(--mp-error)] text-white"}`}
    >
      {badge.unknown ? "--" : badge.total > 99 ? "99+" : badge.total}
    </span>
  );
}

function NavSectionView({
  section,
  inbox,
  collapsed,
  activePath,
  initiallyOpen,
  forcedOpen,
  onRailExpand,
}: {
  section: NavSection;
  inbox: InboxState;
  collapsed: boolean;
  activePath: string | null;
  initiallyOpen: boolean;
  /** Increments when the shell asks this section to open. */
  forcedOpen: number;
  onRailExpand: () => void;
}) {
  const [open, setOpen] = useState(initiallyOpen || section.key === "inbox");
  const keys = section.items.flatMap((item) => item.badgeKeys ?? []) as InboxKey[];
  const sectionBadge = sumCounts(inbox.counts, keys, inbox.failed);

  useEffect(() => {
    if (initiallyOpen) setOpen(true);
  }, [initiallyOpen]);
  useEffect(() => {
    if (forcedOpen > 0) setOpen(true);
  }, [forcedOpen]);

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
    // Single-landing section (Today, Growth).
    const href = section.href ?? "/admin";
    return (
      <Link
        href={href}
        aria-current={sectionActive ? "page" : undefined}
        className={`${rowBase} ${sectionActive ? rowActive : rowIdle} mx-2 my-0.5`}
        title={collapsed ? `${section.label} (g ${section.shortcut})` : undefined}
        aria-label={collapsed ? section.label : undefined}
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
        onClick={() => {
          if (collapsed) onRailExpand();
          else setOpen((v) => !v);
        }}
        className={`${rowBase} ${anyChildActive ? rowActive : rowIdle} relative w-full`}
        title={collapsed ? `${section.label} (g ${section.shortcut})` : undefined}
        aria-label={collapsed ? `${section.label}, open menu` : undefined}
        aria-expanded={collapsed ? false : open}
      >
        <Icon size={16} />
        {collapsed && (sectionBadge.unknown || sectionBadge.total > 0) && (
          <span aria-hidden className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${sectionBadge.unknown ? "bg-[var(--mp-fg-muted)]" : "bg-[var(--mp-error)]"}`} />
        )}
        {!collapsed && <span className="flex-1 text-left">{section.label}</span>}
        {!collapsed && !open && <InboxBadge badge={sectionBadge} label={`${section.label.toLowerCase()} items`} />}
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
              className={`flex min-h-9 items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors max-lg:min-h-11 max-lg:text-sm ${
                  active
                    ? "bg-[var(--mp-viridian)]/12 text-[var(--mp-viridian)]"
                    : "text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                }`}
              >
                <ItemIcon size={12} />
                {item.label}
                {item.badgeKeys ? <InboxBadge badge={sumCounts(inbox.counts, item.badgeKeys, inbox.failed)} label={item.label.toLowerCase()} /> : null}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Phone and tablet bar (ADM-11 A, ADM-14 A): the daily jobs one tap away. */
function AdminBottomBar({
  pathname,
  todayHref,
  moneyHref,
  showInbox,
  inboxBadge,
  canFind,
  onInbox,
  onMore,
}: {
  pathname: string | null;
  todayHref: string | null;
  moneyHref: string | null;
  showInbox: boolean;
  inboxBadge: Badge;
  canFind: boolean;
  onInbox: () => void;
  onMore: () => void;
}) {
  const cell = "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium";
  const idle = "text-[var(--mp-fg-muted)]";
  const active = "text-[var(--mp-viridian)]";
  const onToday = Boolean(todayHref && pathname?.startsWith(todayHref));
  const onMoney = ["/admin/payments", "/admin/subscriptions", "/admin/referrals", "/admin/mentor"].some((h) => pathname?.startsWith(h));
  return (
    <nav
      aria-label="Admin quick navigation"
      data-testid="admin-bottom-bar"
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {todayHref && (
        <Link href={todayHref} className={`${cell} ${onToday ? active : idle}`} aria-current={onToday ? "page" : undefined}>
          <LayoutDashboard size={18} aria-hidden />
          Today
        </Link>
      )}
      {showInbox && (
        <button
          type="button"
          onClick={onInbox}
          className={`${cell} ${idle}`}
          aria-label={`Inbox${inboxBadge.unknown ? ", count unavailable" : inboxBadge.total > 0 ? `, ${inboxBadge.total} waiting` : ""}`}
        >
          <span className="relative px-2">
            <Inbox size={18} aria-hidden />
            <CornerBadge badge={inboxBadge} />
          </span>
          Inbox
        </button>
      )}
      {canFind && (
        <button type="button" onClick={() => focusFindLearner()} className={`${cell} ${idle}`}>
          <Search size={18} aria-hidden />
          Find
        </button>
      )}
      {moneyHref && (
        <Link href={moneyHref} className={`${cell} ${onMoney ? active : idle}`} aria-current={onMoney ? "page" : undefined}>
          <Wallet size={18} aria-hidden />
          Money
        </Link>
      )}
      <button type="button" onClick={onMore} className={`${cell} ${idle}`}>
        <MoreHorizontal size={18} aria-hidden />
        More
      </button>
    </nav>
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
      aria-label="Keyboard shortcuts"
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
            className="min-h-11 px-2 text-xs text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
          >
            Close
          </button>
        </div>
        <div className="p-4 text-xs text-[var(--mp-fg-muted)] grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
          {ADMIN_NAV.map((section) => (
            <ShortcutRow key={section.key} keys={`g ${section.shortcut}`} label={`Go to ${section.label}`} />
          ))}
          <ShortcutRow keys="/" label="Find learner" />
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
