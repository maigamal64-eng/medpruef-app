"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { Home, FileText, GraduationCap, BarChart3, TrendingUp, Map, Settings, Sparkles, PanelLeftClose, PanelLeftOpen, Layers } from "lucide-react";
import ExamSwitcherInline from "./ExamSwitcherInline";

type Lang = "de" | "en";

interface SidebarProps {
  lang: Lang;
  userId?: string;
  userName?: string;
  totalXp?: number;
  streak?: number;
  accuracy?: number;
}

const COLLAPSE_KEY = "medpruef_sidebar_collapsed";

export default function Sidebar({ lang, userId, userName, totalXp = 0 }: SidebarProps) {
  const pathname = usePathname();
  const xpInfo = getLevelFromXP(totalXp);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    }
  }, []);

  // Auto-hide on quiz/exam for distraction-free testing
  if (pathname.startsWith("/quiz") || pathname.startsWith("/exam")) {
    return null;
  }

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  };

  const navItems = [
    { href: "/", icon: <Home className="w-5 h-5" />, label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz", icon: <FileText className="w-5 h-5" />, label: t("quiz", lang), key: "quiz" },
    { href: "/flashcards", icon: <Layers className="w-5 h-5" />, label: t("flashcards", lang), key: "flashcards" },
    { href: "/exam", icon: <GraduationCap className="w-5 h-5" />, label: t("exam", lang), key: "exam" },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: <BarChart3 className="w-5 h-5" />, label: t("stats", lang), key: "stats" },
    { href: "/progress", icon: <TrendingUp className="w-5 h-5" />, label: t("progress", lang), key: "progress" },
    { href: "/curriculum", icon: <Map className="w-5 h-5" />, label: t("curriculum", lang), key: "curriculum" },
  ];

  const bottomItems = [
    { href: "/changelog", icon: <Sparkles className="w-5 h-5" />, label: lang === "de" ? "Neuigkeiten" : "What's New", key: "changelog" },
    { href: "/settings", icon: <Settings className="w-5 h-5" />, label: t("settings", lang), key: "settings" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    return pathname.startsWith(`/${key === "stats" ? "stats" : key}`);
  };

  const navLinkClass = (key: string) => {
    const active = isActive(key);
    const base = collapsed
      ? "flex items-center justify-center w-9 h-9 mx-auto rounded-lg mb-0.5 transition-all duration-150"
      : "flex items-center gap-3 px-3 py-2.5 rounded-r-xl mb-px transition-all duration-150";

    if (active) {
      return collapsed
        ? `${base} bg-[#007B5F]/20 text-[#00A896] font-semibold`
        : `${base} bg-[#007B5F]/20 text-[#00A896] font-semibold border-l-[3px] border-l-[#00A896]`;
    }
    return `${base} text-[#A0AEC0] hover:bg-white/5 hover:text-white`;
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
                <span>Med</span><span className="text-[#00A896]">Prüf</span>
              </h1>
              <p className="text-[10px] text-[#A0AEC0] leading-tight">{t("exam_prep", lang)}</p>
            </div>
          )}
        </div>
      </div>

      {/* User + Exam — compact card */}
      {userName && !collapsed && (
        <div className="mx-3 mt-3 mb-1 p-2.5 rounded-xl bg-[#002952]">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-full bg-[#007B5F] flex items-center justify-center text-xs font-bold text-white ring-2 ring-[#00A896]/30 flex-shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{userName}</p>
              <p className="text-[10px] text-[#A0AEC0]">
                {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
              </p>
            </div>
          </div>
          <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden mb-2">
            <div className="h-full bg-[#00A896] rounded-full" style={{ width: `${xpInfo.progress}%` }} />
          </div>
          <ExamSwitcherInline variant="sidebar" className="w-full" />
        </div>
      )}
      {userName && collapsed && (
        <div className="flex justify-center my-2" title={`${userName} · ${xpInfo.rank} · Lv.${xpInfo.level}`}>
          <div className="w-9 h-9 rounded-full bg-[#007B5F] flex items-center justify-center text-xs font-bold text-white ring-2 ring-[#00A896]/30 relative">
            {userName.charAt(0).toUpperCase()}
            <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#00A896] rounded-full border-2 border-[#001B3D]" />
          </div>
        </div>
      )}

      {/* Main Navigation */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mt-3`}>
        {navItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key)} title={collapsed ? item.label : undefined}>
            <span className={isActive(item.key) ? "opacity-100" : "opacity-70"}>{item.icon}</span>
            {!collapsed && (
              <span className="text-[13px]">{item.label}</span>
            )}
          </Link>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Bottom items */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mb-1`}>
        {bottomItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key)} title={collapsed ? item.label : undefined}>
            <span className={isActive(item.key) ? "opacity-100" : "opacity-70"}>{item.icon}</span>
            {!collapsed && (
              <span className="text-[13px]">{item.label}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* Collapse toggle */}
      <div className={`border-t border-white/[0.06] ${collapsed ? "px-2 py-2" : "px-4 py-2"}`}>
        <button
          onClick={toggleCollapse}
          className={`flex items-center ${collapsed ? "justify-center w-9 h-9 mx-auto" : "gap-2 w-full px-3 py-2"} rounded-xl text-[#A0AEC0]/60 hover:text-white hover:bg-white/5 transition-colors`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          {!collapsed && <span className="text-xs">{lang === "de" ? "Einklappen" : "Collapse"}</span>}
        </button>
      </div>
    </aside>
  );
}
