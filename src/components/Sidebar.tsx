"use client";

import { useState, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { authFetch as fetch } from "@/lib/authFetch";
import { t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { Home, FileText, GraduationCap, BarChart3, TrendingUp, Map, Settings, Sparkles, PanelLeftClose, PanelLeftOpen, Layers, Crown, CalendarDays, Gift } from "lucide-react";
import ExamSwitcherInline from "./ExamSwitcherInline";
import { NavItem } from "@/components/ui";
import {
  EXAM_SOURCES,
  getStoredExamSource,
  setStoredExamSource,
  type ExamSourceId,
} from "@/lib/topics";
import { useUserTier } from "@/lib/hooks/useUserTier";

type Lang = "de" | "en";

/**
 * Abbreviation shown in the 40px collapsed-rail exam chip.
 * Keep these ≤3 chars — the chip is 40×40 with mono/tabular-nums type.
 */
const EXAM_ABBR: Record<ExamSourceId, string> = {
  kenntnispruefung: "SIP",
  kmp_innsbruck: "STP",
  pharma: "PHA",
};

interface SidebarProps {
  lang: Lang;
  userId?: string;
  userName?: string;
  totalXp?: number;
  streak?: number;
  accuracy?: number;
}

const COLLAPSE_KEY = "medpruef_sidebar_collapsed";

/**
 * Compact 40×40 exam chip shown ONLY in the collapsed sidebar rail.
 * Keeps users oriented which exam they're prepping for (SIP / STP / PHA)
 * when the expanded ExamSwitcherInline is hidden. Clicking the chip opens
 * a small dropdown — same switch semantics as the expanded switcher
 * (persist localStorage + server preference + soft reload).
 *
 * Not rendered in expanded mode (that's ExamSwitcherInline's job) and
 * never on mobile (the sidebar itself is hidden under 1024px).
 */
function CollapsedExamChip() {
  const [active, setActive] = useState<ExamSourceId>("kenntnispruefung");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setActive(getStoredExamSource());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!mounted) {
    // Prevent SSR/CSR hydration mismatch + layout shift
    return <div className="h-10 my-2" aria-hidden />;
  }

  const activeExam = EXAM_SOURCES.find((e) => e.id === active) ?? EXAM_SOURCES[0];
  const abbr = EXAM_ABBR[activeExam.id as ExamSourceId];

  const switchTo = (id: ExamSourceId) => {
    if (id === active) {
      setOpen(false);
      return;
    }
    setActive(id);
    setStoredExamSource(id);
    setOpen(false);

    try {
      const session = localStorage.getItem("medpruef_session");
      const parsed = session ? JSON.parse(session) : null;
      const userId = parsed?.user?.id;
      if (userId && !userId.startsWith("guest_")) {
        fetch("/api/user/exam-preference", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, activeExam: id }),
        }).catch(() => {});
      }
    } catch {}

    window.dispatchEvent(new CustomEvent("medpruef:examChanged", { detail: { examSource: id } }));
    setTimeout(() => window.location.reload(), 50);
  };

  return (
    <div ref={rootRef} className="flex justify-center my-2">
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            // Anchor dropdown to the right edge of the collapsed rail
            const left = Math.min(rect.right + 8, window.innerWidth - 272);
            setDropdownPos({ top: rect.top, left });
          }
          setOpen((o) => !o);
        }}
        className="w-10 h-10 flex items-center justify-center rounded-xl
                   bg-[var(--mp-viridian)]/15 hover:bg-[var(--mp-viridian)]/25
                   border border-[var(--mp-viridian)]/30
                   text-[var(--mp-accent-teal)]
                   font-mono tabular-nums text-[11px] font-bold tracking-tight
                   transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Prüfung: ${activeExam.fullName}`}
        title={activeExam.fullName}
      >
        {abbr}
      </button>

      {open && dropdownPos && (
        <div
          className="fixed w-64 bg-white dark:bg-slate-800
                     border border-slate-200 dark:border-slate-700
                     rounded-xl shadow-xl overflow-hidden"
          style={{ top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
          role="listbox"
        >
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700">
            Prüfung / Exam
          </div>
          {EXAM_SOURCES.map((exam) => {
            const isActive = exam.id === active;
            return (
              <button
                key={exam.id}
                onClick={() => switchTo(exam.id)}
                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors
                            ${isActive
                              ? "bg-[var(--mp-accent-teal)]/10 text-[var(--mp-accent-teal)]"
                              : "hover:bg-slate-50 dark:hover:bg-slate-700/50 text-slate-700 dark:text-slate-200"
                            }`}
                role="option"
                aria-selected={isActive}
              >
                <span className="text-lg mt-0.5 leading-none">{exam.badge}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium flex items-center gap-2">
                    <span className="truncate">{exam.label}</span>
                    {isActive && (
                      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" className="flex-shrink-0">
                        <path d="M7.5 13.5L4 10l1.4-1.4 2.1 2.1 7-7L16 5.1z" />
                      </svg>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {exam.fullName}
                  </div>
                  {exam.questions > 0 && (
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">
                      {exam.questions.toLocaleString("de-DE")} Fragen
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ lang, userId, userName, totalXp = 0 }: SidebarProps) {
  const pathname = usePathname();
  const xpInfo = getLevelFromXP(totalXp);
  const [collapsed, setCollapsed] = useState(false);
  // Invite-only referral program gate (2026-06-25). The nudge-dot and
  // any referral link text are suppressed for accounts not enrolled.
  const { referralsEnabled } = useUserTier();
  // Rescue-sprint §4.7 (2026-04-24): amber nudge-dot on the
  // Empfehlungen nav link until the user has copied their referral
  // code at least once. `null` = unknown (don't show dot yet),
  // `false` = NOT yet copied (show dot), `true` = copied (hide dot).
  // Fetched from /api/referrals/status once per mount. Intentionally
  // non-blocking — a failed fetch just hides the dot.
  const [hasCopiedCode, setHasCopiedCode] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    }
  }, []);

  // Fetch referral copy state — skipped for guests + when we have no
  // userId at all (unauth surfaces borrow the sidebar too in theory).
  useEffect(() => {
    if (!userId || userId.startsWith("guest_")) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/referrals/status", {
          skipAuthRedirect: true,
        });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled) return;
        setHasCopiedCode(Boolean(data?.referralCodeCopiedAt));
      } catch {
        /* non-critical — dot just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Auto-hide on quiz/exam for distraction-free testing
  if (pathname.startsWith("/quiz") || pathname.startsWith("/exam")) {
    return null;
  }

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  };

  // Rescue-sprint §4.7: amber nudge-dot on Empfehlungen until the user
  // has copied their code at least once. `hasCopiedCode === false`
  // means we KNOW they haven't copied; `null` (still loading / guest)
  // hides the dot. Only show dot for non-guest authed users who are
  // enrolled in the invite-only referral program (referralsEnabled).
  const referralsDot: boolean = Boolean(
    userId && !userId.startsWith("guest_") && hasCopiedCode === false && referralsEnabled
  );

  const navItems: Array<{
    href: string;
    icon: React.ReactNode;
    label: string;
    key: string;
    dot?: boolean;
    dotTooltip?: string;
  }> = [
    { href: "/", icon: <Home className="w-5 h-5" />, label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?setup=1&userId=${userId}` : "/quiz?setup=1", icon: <FileText className="w-5 h-5" />, label: t("quiz", lang), key: "quiz" },
    { href: "/library", icon: <Layers className="w-5 h-5" />, label: lang === "de" ? "Bibliothek" : "Library", key: "library" },
    { href: "/exam", icon: <GraduationCap className="w-5 h-5" />, label: t("exam", lang), key: "exam" },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: <BarChart3 className="w-5 h-5" />, label: t("stats", lang), key: "stats" },
    { href: "/progress", icon: <TrendingUp className="w-5 h-5" />, label: t("progress", lang), key: "progress" },
    { href: "/curriculum", icon: <Map className="w-5 h-5" />, label: t("curriculum", lang), key: "curriculum" },
    { href: "/study-plan", icon: <CalendarDays className="w-5 h-5" />, label: lang === "de" ? "Lernplan" : "Study Plan", key: "study-plan" },
    // Empfehlungen / Referrals is invite-only (2026-06-25): only accounts an
    // admin has flagged (referralsEnabled) see the nav link at all. The
    // /referrals page itself fails closed too, but a non-enrolled user must
    // not even see the entry point.
    ...(referralsEnabled
      ? [
          {
            href: "/referrals",
            icon: <Gift className="w-5 h-5" />,
            label: lang === "de" ? "Empfehlungen" : "Referrals",
            key: "referrals",
            dot: referralsDot,
            dotTooltip: lang === "de" ? "Dein Empfehlungscode wartet." : "Your referral code is waiting.",
          },
        ]
      : []),
    { href: "/pricing", icon: <Crown className="w-5 h-5" />, label: lang === "de" ? "Preise" : "Pricing", key: "pricing" },
  ];

  const bottomItems = [
    { href: "/changelog", icon: <Sparkles className="w-5 h-5" />, label: lang === "de" ? "Neuigkeiten" : "What's New", key: "changelog" },
    { href: "/settings", icon: <Settings className="w-5 h-5" />, label: t("settings", lang), key: "settings" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "library") return pathname.startsWith("/library") || pathname.startsWith("/flashcards");
    return pathname.startsWith(`/${key === "stats" ? "stats" : key}`);
  };

  return (
    <aside className={`sidebar flex flex-col transition-all duration-300 ease-out ${collapsed ? "!w-[68px]" : ""}`}>
      {/* Logo */}
      <div className={`border-b border-white/[0.06] ${collapsed ? "px-3 pt-4 pb-2" : "px-5 pt-5 pb-3"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
          <img src="/brand/logomark.svg" alt="MedPrüf" className="w-8 h-8 flex-shrink-0" style={{ filter: 'brightness(0) invert(1)' }} />
          {!collapsed && (
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">
                <span>Med</span><span className="text-[var(--mp-accent-teal)]">Prüf</span>
              </h1>
              <p className="text-[10px] text-[var(--mp-fg-subtle)] leading-tight">{t("exam_prep", lang)}</p>
            </div>
          )}
        </div>
      </div>

      {/* User + Exam — compact card */}
      {userName && !collapsed && (
        <div className="mx-3 mt-3 mb-1 p-2.5 rounded-xl bg-[#002952]">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-[var(--mp-viridian)] flex items-center justify-center text-xs font-bold text-white ring-2 ring-[var(--mp-accent-teal)]/30 flex-shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{userName}</p>
              <p className="text-[10px] text-[var(--mp-fg-subtle)]">
                {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
              </p>
            </div>
          </div>
          <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden mb-2">
            <div className="h-full bg-[var(--mp-accent-teal)] rounded-full" style={{ width: `${xpInfo.progress}%` }} />
          </div>
          <ExamSwitcherInline variant="sidebar" className="w-full" />
        </div>
      )}
      {userName && collapsed && (
        <>
          <div className="flex justify-center my-2" title={`${userName} · ${xpInfo.rank} · Lv.${xpInfo.level}`}>
            <div className="w-9 h-9 rounded-full bg-[var(--mp-viridian)] flex items-center justify-center text-xs font-bold text-white ring-2 ring-[var(--mp-accent-teal)]/30 relative">
              {userName.charAt(0).toUpperCase()}
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[var(--mp-accent-teal)] rounded-full border-2 border-[var(--mp-oxford-blue)]" />
            </div>
          </div>
          {/* DD-10: exam chip — keeps the collapsed rail exam-aware */}
          <CollapsedExamChip />
        </>
      )}

      {/* Main Navigation */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mt-3`}>
        {navItems.map((item) => (
          <NavItem
            key={item.key}
            context="sidebar"
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={isActive(item.key)}
            collapsed={collapsed}
            dot={item.dot}
            dotTooltip={item.dotTooltip}
          />
        ))}
      </nav>

      <div className="flex-1" />

      {/* Bottom items */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mb-1`}>
        {bottomItems.map((item) => (
          <NavItem
            key={item.key}
            context="sidebar"
            href={item.href}
            icon={item.icon}
            label={item.label}
            active={isActive(item.key)}
            collapsed={collapsed}
          />
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className={`border-t border-white/[0.06] ${collapsed ? "px-2 py-2" : "px-4 py-2"}`}>
        <button
          onClick={toggleCollapse}
          className={`flex items-center ${collapsed ? "justify-center w-9 h-9 mx-auto" : "gap-2 w-full px-3 py-2"} rounded-xl text-[var(--mp-fg-subtle)]/60 hover:text-white hover:bg-white/5 transition-colors`}
          title={collapsed ? (lang === "de" ? "Seitenleiste ausklappen" : "Expand sidebar") : (lang === "de" ? "Seitenleiste einklappen" : "Collapse sidebar")}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          {!collapsed && <span className="text-xs">{lang === "de" ? "Einklappen" : "Collapse"}</span>}
        </button>
      </div>
    </aside>
  );
}
