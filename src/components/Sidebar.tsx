"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { TOPIC_CONFIG } from "@/lib/topics";

type Lang = "de" | "en";

interface SidebarProps {
  lang: Lang;
  userId?: string;
  userName?: string;
  totalXp?: number;
  streak?: number;
  accuracy?: number;
}

export default function Sidebar({ lang, userId, userName, totalXp = 0, streak = 0, accuracy = 0 }: SidebarProps) {
  const pathname = usePathname();
  const xpInfo = getLevelFromXP(totalXp);

  const navItems = [
    { href: "/", icon: "🏠", label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz", icon: "📝", label: t("quiz", lang), key: "quiz" },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: "📊", label: t("stats", lang), key: "stats" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "stats") return pathname.startsWith("/stats");
    return false;
  };

  return (
    <aside className="sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0891B2] to-[#065F73] flex items-center justify-center text-lg font-bold shadow-lg">
            M
          </div>
          <div>
            <h1 className="text-lg font-bold text-white tracking-tight">MedPrüf</h1>
            <p className="text-[11px] text-[#94A3B8] leading-tight">{t("exam_prep", lang)}</p>
          </div>
        </div>
      </div>

      {/* User card */}
      {userName && (
        <div className="mx-4 mb-4 p-3 rounded-xl bg-[#1E293B]/60 border border-[#334155]/50">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#0891B2] to-[#065F73] flex items-center justify-center text-sm font-bold">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{userName}</p>
              <p className="text-xs text-[#94A3B8]">{xpInfo.rank} · Lv.{xpInfo.level}</p>
            </div>
          </div>
          {/* XP bar */}
          <div className="h-1.5 bg-[#334155] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#0891B2] to-[#22D3EE] rounded-full animate-progress"
              style={{ width: `${xpInfo.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-[#64748B] mt-1">
            {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
          </p>
        </div>
      )}

      {/* Navigation */}
      <nav className="px-3 mb-4">
        <p className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold px-2 mb-2">
          {t("navigation", lang)}
        </p>
        {navItems.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-all duration-150 ${
              isActive(item.key)
                ? "bg-[#0891B2]/15 text-[#22D3EE] font-medium"
                : "text-[#94A3B8] hover:bg-[#1E293B]/60 hover:text-white"
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span className="text-sm">{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Quick stats */}
      {userName && (
        <div className="px-3 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold px-2 mb-2">
            {t("your_stats", lang)}
          </p>
          <div className="grid grid-cols-3 gap-2 px-2">
            <div className="text-center">
              <p className="text-base font-bold text-[#F59E0B]">{totalXp}</p>
              <p className="text-[10px] text-[#64748B]">XP</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#EF4444]">🔥{streak}</p>
              <p className="text-[10px] text-[#64748B]">{t("streak", lang)}</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#10B981]">{accuracy}%</p>
              <p className="text-[10px] text-[#64748B]">{t("accuracy", lang)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Topics list */}
      <div className="px-3 flex-1 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-[#64748B] font-semibold px-2 mb-2">
          {t("topics", lang)}
        </p>
        <div className="space-y-0.5">
          {Object.entries(TOPIC_CONFIG).map(([topic, config]) => (
            <Link
              key={topic}
              href={userId ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}` : "#"}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-[#94A3B8] hover:bg-[#1E293B]/60 hover:text-white transition-all duration-150"
            >
              <span className="text-sm">{config.icon}</span>
              <span className="text-xs truncate">{topic}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#334155]/30">
        <p className="text-[10px] text-[#64748B] text-center">MedPrüf v1.0</p>
      </div>
    </aside>
  );
}
