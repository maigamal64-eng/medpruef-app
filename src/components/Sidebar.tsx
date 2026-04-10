"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { TOPIC_CONFIG } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";
import { Home, FileText, GraduationCap, BarChart3, TrendingUp, BookOpen, Info, User, Flame, PanelLeftClose, PanelLeftOpen, Layers, Settings, Map, Sparkles } from "lucide-react";

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

export default function Sidebar({ lang, userId, userName, totalXp = 0, streak = 0, accuracy = 0 }: SidebarProps) {
  const pathname = usePathname();
  const xpInfo = getLevelFromXP(totalXp);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    }
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  };

  const mainNavItems = [
    { href: "/", icon: <Home className="w-5 h-5" />, label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz", icon: <FileText className="w-5 h-5" />, label: t("quiz", lang), key: "quiz" },
    { href: "/flashcards", icon: <Layers className="w-5 h-5" />, label: t("flashcards", lang), key: "flashcards" },
    { href: "/exam", icon: <GraduationCap className="w-5 h-5" />, label: t("exam", lang), key: "exam", highlight: true },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: <BarChart3 className="w-5 h-5" />, label: t("stats", lang), key: "stats" },
    { href: "/progress", icon: <TrendingUp className="w-5 h-5" />, label: t("progress", lang), key: "progress" },
    { href: "/curriculum", icon: <Map className="w-5 h-5" />, label: t("curriculum", lang), key: "curriculum" },
  ];

  const secondaryNavItems = [
    { href: "/materials", icon: <BookOpen className="w-5 h-5" />, label: t("materials", lang), key: "materials" },
    { href: "/changelog", icon: <Sparkles className="w-5 h-5" />, label: lang === "de" ? "Neuigkeiten" : "What's New", key: "changelog" },
    { href: "/about", icon: <Info className="w-5 h-5" />, label: t("about", lang), key: "about" },
    { href: "/profile", icon: <User className="w-5 h-5" />, label: t("profile", lang), key: "profile" },
    { href: "/settings", icon: <Settings className="w-5 h-5" />, label: t("settings", lang), key: "settings" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "flashcards") return pathname.startsWith("/flashcards");
    if (key === "stats") return pathname.startsWith("/stats");
    if (key === "progress") return pathname.startsWith("/progress");
    if (key === "curriculum") return pathname.startsWith("/curriculum");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "materials") return pathname.startsWith("/materials");
    if (key === "about") return pathname.startsWith("/about");
    if (key === "profile") return pathname.startsWith("/profile");
    if (key === "settings") return pathname.startsWith("/settings");
    if (key === "changelog") return pathname.startsWith("/changelog");
    return false;
  };

  const navLinkClass = (key: string, highlight?: boolean) => {
    const active = isActive(key);
    const base = collapsed
      ? "flex items-center justify-center w-10 h-10 mx-auto rounded-xl mb-1 transition-all duration-150"
      : "flex items-center gap-3.5 px-3 py-3 rounded-r-xl mb-0.5 transition-all duration-150";

    if (active) {
      const colors = highlight
        ? "bg-[#F4A261]/15 text-[#F4A261] font-semibold"
        : "bg-[#007B5F]/20 text-[#00A896] font-semibold";
      return collapsed
        ? `${base} ${colors}`
        : `${base} ${colors} border-l-[3px] ${highlight ? "border-l-[#F4A261]" : "border-l-[#00A896]"}`;
    }
    return `${base} text-[#A0AEC0] hover:bg-white/5 hover:text-white ${highlight ? "hover:text-[#F4A261]" : ""}`;
  };

  const iconClass = (key: string) => isActive(key) ? "opacity-100" : "opacity-70";

  return (
    <aside className={`sidebar flex flex-col transition-all duration-300 ease-out ${collapsed ? "!w-[68px]" : ""}`}>
      {/* Logo */}
      <div className={`border-b border-white/[0.06] ${collapsed ? "px-3 pt-5 pb-3" : "px-5 pt-6 pb-4"}`}>
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-3"}`}>
          <img src="/brand/logomark.svg" alt="MedPrüf" className="w-9 h-9 flex-shrink-0" style={{ filter: 'brightness(0) invert(1)' }} />
          {!collapsed && (
            <div>
              <h1 className="text-base font-bold text-white tracking-tight">
                <span>Med</span><span className="text-[#00A896]">Prüf</span>
              </h1>
              <p className="text-[11px] text-[#A0AEC0] leading-tight">{t("exam_prep", lang)}</p>
            </div>
          )}
        </div>
      </div>

      {/* User card */}
      {userName && !collapsed && (
        <div className="mx-4 my-4 p-3 rounded-xl bg-[#002952]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-[#007B5F] flex items-center justify-center text-sm font-bold text-white ring-2 ring-[#00A896]/30">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{userName}</p>
              <p className="text-xs text-[#A0AEC0]">
                {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
              </p>
            </div>
          </div>
          <div className="h-1 bg-white/[0.08] rounded-full overflow-hidden">
            <div className="h-full bg-[#00A896] rounded-full animate-progress" style={{ width: `${xpInfo.progress}%` }} />
          </div>
          <p className="text-[10px] text-[#A0AEC0]/70 mt-1 font-mono">
            {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
          </p>
        </div>
      )}
      {userName && collapsed && (
        <div className="flex justify-center my-3" title={`${userName} · ${xpInfo.rank} · Lv.${xpInfo.level}`}>
          <div className="w-10 h-10 rounded-full bg-[#007B5F] flex items-center justify-center text-sm font-bold text-white ring-2 ring-[#00A896]/30 relative">
            {userName.charAt(0).toUpperCase()}
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#00A896] rounded-full border-2 border-[#001B3D]" />
          </div>
        </div>
      )}

      {/* Main Navigation */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mt-4 mb-2`}>
        {!collapsed && (
          <p className="text-[10px] uppercase tracking-widest text-[#A0AEC0]/50 font-semibold px-2 mb-2">
            {t("navigation", lang)}
          </p>
        )}
        {mainNavItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key, item.highlight)} title={collapsed ? item.label : undefined}>
            <span className={iconClass(item.key)}>{item.icon}</span>
            {!collapsed && (
              <span className={`${isActive(item.key) ? "text-[15px]" : "text-[14px]"}`}>{item.label}</span>
            )}
            {!collapsed && item.highlight && !isActive(item.key) && (
              <span className="ml-auto text-[9px] font-semibold bg-[#F4A261] text-white px-1.5 py-0.5 rounded">
                Neu
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Secondary Navigation */}
      <nav className={`${collapsed ? "px-2" : "px-3"} mt-4 mb-2`}>
        {!collapsed && (
          <p className="text-[10px] uppercase tracking-widest text-[#A0AEC0]/50 font-semibold px-2 mb-2">
            {lang === "de" ? "Mehr" : "More"}
          </p>
        )}
        {secondaryNavItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key)} title={collapsed ? item.label : undefined}>
            <span className={iconClass(item.key)}>{item.icon}</span>
            {!collapsed && (
              <span className={`${isActive(item.key) ? "text-[15px]" : "text-[14px]"}`}>{item.label}</span>
            )}
          </Link>
        ))}
      </nav>

      {/* Quick stats — only expanded */}
      {userName && !collapsed && (
        <div className="px-4 mb-4">
          <div className="bg-[#002952] rounded-xl p-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00A896]" />
                  <p className="text-base font-bold text-white font-mono">{totalXp}</p>
                </div>
                <p className="text-[10px] text-[#A0AEC0]/70">XP</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F4A261]" />
                  <p className="text-base font-bold text-white font-mono flex items-center justify-center gap-1"><Flame className="w-3.5 h-3.5 text-[#F4A261]" />{streak}</p>
                </div>
                <p className="text-[10px] text-[#A0AEC0]/70">{t("streak", lang)}</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1.5 mb-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#003A8C]" />
                  <p className="text-base font-bold text-white font-mono">{accuracy}%</p>
                </div>
                <p className="text-[10px] text-[#A0AEC0]/70">{t("accuracy", lang)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Topics list — only expanded */}
      {!collapsed && (
        <div className="px-3 mt-4 mb-2 flex-1 overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-[#A0AEC0]/50 font-semibold px-2 mb-2">
            {t("topics", lang)}
          </p>
          <div className="space-y-0.5">
            {Object.entries(TOPIC_CONFIG).map(([topic, config]) => (
              <Link
                key={topic}
                href={userId ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}` : "#"}
                className="flex items-center gap-2.5 px-3 py-2 text-[13px] text-[#A0AEC0] hover:text-white hover:bg-white/5 rounded-lg transition-colors duration-150"
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: config.color }} />
                <span className="truncate">{topic}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {collapsed && <div className="flex-1" />}

      {/* Collapse toggle */}
      <div className={`border-t border-white/[0.06] ${collapsed ? "px-2 py-3" : "px-4 py-3"}`}>
        <button
          onClick={toggleCollapse}
          className={`flex items-center ${collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-2 w-full px-3 py-2"} rounded-xl text-[#A0AEC0]/60 hover:text-white hover:bg-white/5 transition-colors`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          {!collapsed && <span className="text-xs">{lang === "de" ? "Einklappen" : "Collapse"}</span>}
        </button>
      </div>
    </aside>
  );
}
