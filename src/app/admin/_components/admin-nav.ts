/**
 * Admin menu model (a18, ADM-11 A): grouped around the founder's jobs.
 *
 *   Today · Inbox · Learners · Money · Content · Growth · System
 *
 * Inbox holds every queue that waits on a person (Feedback, Question
 * reports, Note reports, PUYP proofs, Ops approvals) with count chips from
 * /api/admin/inbox. Every route that existed before the regroup is still in
 * the menu; only labels and grouping changed. System lands on its first
 * permitted child, never /admin/system (next.config.ts redirects that).
 *
 * The shell (AdminLayoutClient), the shortcut handler, the shortcut dialog,
 * the phone bottom bar and AdminPageShell (tab titles) all read this one
 * list, so a regroup is one edit.
 */

import {
  AlertTriangle,
  BarChart3,
  CreditCard,
  Database,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  NotebookPen,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sprout,
  Ticket,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import type { AdminPermission } from "@/lib/admin/useAdminPermissions";

export type SectionKey = "today" | "inbox" | "learners" | "money" | "content" | "growth" | "system";

/** Keys returned by GET /api/admin/inbox. */
export const INBOX_KEYS = [
  "feedback",
  "question_reports",
  "note_reports",
  "puyp",
  "ops_actions",
  "referral_payouts",
  "referral_rewards",
] as const;
export type InboxKey = (typeof INBOX_KEYS)[number];

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Users;
  permission: AdminPermission;
  ownerOnly?: boolean;
  /** Open-item counts from /api/admin/inbox summed into this item's badge. */
  badgeKeys?: InboxKey[];
}

export interface NavSection {
  key: SectionKey;
  label: string;
  icon: typeof LayoutDashboard;
  /** Second key after the "g" leader. */
  shortcut: string;
  items: NavItem[];
  permission?: AdminPermission;
  /** Single-landing sections (Today, Growth). */
  href?: string;
}

export const ADMIN_NAV: NavSection[] = [
  {
    key: "today",
    label: "Today",
    icon: LayoutDashboard,
    shortcut: "t",
    permission: "overview.read",
    href: "/admin/overview",
    items: [],
  },
  {
    key: "inbox",
    label: "Inbox",
    icon: Inbox,
    shortcut: "i",
    items: [
      { label: "Feedback", href: "/admin/feedback", icon: MessageSquare, permission: "feedback.read", badgeKeys: ["feedback"] },
      { label: "Question reports", href: "/admin/flagged", icon: ShieldAlert, permission: "content.read", badgeKeys: ["question_reports"] },
      { label: "Note reports", href: "/admin/note-reports", icon: NotebookPen, permission: "content.read", badgeKeys: ["note_reports"] },
      { label: "PUYP proofs", href: "/admin/puyp", icon: ShieldCheck, permission: "revenue.read", badgeKeys: ["puyp"] },
      // a-pricing-v2: Guarantee Ticket renewal on proof (TICKET_RENEWAL_ENABLED).
      { label: "Ticket renewals", href: "/admin/ticket-renewals", icon: Ticket, permission: "revenue.read" },
      // a17 (UX-ADM-13): agent-prepared actions waiting for the owner.
      { label: "Ops approvals", href: "/admin/ops", icon: ShieldCheck, permission: "access.manage", ownerOnly: true, badgeKeys: ["ops_actions"] },
    ],
  },
  {
    key: "learners",
    label: "Learners",
    icon: Users,
    shortcut: "u",
    items: [
      { label: "Learners", href: "/admin/users", icon: Users, permission: "users.read" },
    ],
  },
  {
    key: "money",
    label: "Money",
    icon: Wallet,
    shortcut: "m",
    items: [
      { label: "Payments", href: "/admin/payments", icon: CreditCard, permission: "revenue.read" },
      { label: "Paid roster", href: "/admin/subscriptions", icon: Ticket, permission: "revenue.read" },
      { label: "Referrals", href: "/admin/referrals", icon: GitBranch, permission: "revenue.read", badgeKeys: ["referral_payouts", "referral_rewards"] },
      { label: "AI Mentor", href: "/admin/mentor", icon: Gauge, permission: "revenue.read" },
    ],
  },
  {
    key: "content",
    label: "Content",
    icon: FileText,
    shortcut: "c",
    items: [
      { label: "Questions", href: "/admin/questions", icon: FileText, permission: "content.read" },
      { label: "Media", href: "/admin/media", icon: ImageIcon, permission: "content.read" },
    ],
  },
  {
    key: "growth",
    label: "Growth",
    icon: Sprout,
    shortcut: "g",
    permission: "revenue.read",
    href: "/admin/growth",
    items: [],
  },
  {
    key: "system",
    label: "System",
    icon: Server,
    shortcut: "s",
    items: [
      { label: "Crons", href: "/admin/crons", icon: Gauge, permission: "system.read" },
      { label: "Deploys", href: "/admin/deploys", icon: Zap, permission: "system.read" },
      { label: "Errors", href: "/admin/errors", icon: AlertTriangle, permission: "system.read" },
      { label: "Audit", href: "/admin/audit", icon: BarChart3, permission: "system.read" },
      { label: "Env", href: "/admin/env", icon: Database, permission: "system.read" },
      { label: "Flags", href: "/admin/flags", icon: Flag, permission: "system.read" },
      { label: "Admins & roles", href: "/admin/access", icon: ShieldCheck, permission: "access.manage" },
    ],
  },
];

/** Old "g" shortcuts kept working after the regroup. */
export const SHORTCUT_ALIASES: Record<string, SectionKey> = { o: "today", r: "money", w: "growth" };

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`) || pathname.startsWith(`${href}?`);
}

/** The menu entry for a pathname, or null. */
export function navEntryFor(pathname: string | null | undefined): { section: NavSection; item: NavItem | null } | null {
  if (!pathname) return null;
  for (const section of ADMIN_NAV) {
    if (section.href && matches(pathname, section.href)) return { section, item: null };
    for (const item of section.items) {
      if (matches(pathname, item.href)) return { section, item };
    }
  }
  return null;
}

/**
 * Badge value for these keys. A key the server could not read is "failed"
 * and makes the whole badge unknown ("--"), never a smaller number. A null
 * that is not failed means "not offered to this admin" and is skipped.
 */
export function sumCounts(
  counts: Partial<Record<InboxKey, number | null>>,
  keys: readonly InboxKey[],
  failed: ReadonlySet<InboxKey> | readonly InboxKey[] = [],
): { total: number; unknown: boolean } {
  const failedSet = failed instanceof Set ? failed : new Set(failed as readonly InboxKey[]);
  let total = 0;
  let unknown = false;
  for (const key of keys) {
    if (failedSet.has(key)) unknown = true;
    const n = counts[key];
    if (typeof n === "number") total += n;
  }
  return { total, unknown };
}

/** "(3) Feedback · MedPrüf Admin": the open count leads on queue pages. */
export function adminDocumentTitle(title: string, count: number | null | undefined): string {
  return `${typeof count === "number" && count > 0 ? `(${count > 99 ? "99+" : count}) ` : ""}${title} · MedPrüf Admin`;
}
