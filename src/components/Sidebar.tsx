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

  const mainNavItems = [
    { href: "/", icon: "🏠", label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz", icon: "📝", label: t("quiz", lang), key: "quiz" },
    { href: "/exam", icon: "🎓", label: t("exam", lang), key: "exam", highlight: true },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: "📊", label: t("stats", lang), key: "stats" },
  ];

  const secondaryNavItems = [
    { href: "/materials", icon: "📚", label: t("materials", lang), key: "materials" },
    { href: "/about", icon: "ℹ️", label: t("about", lang), key: "about" },
    { href: "/profile", icon: "👤", label: t("profile", lang), key: "profile" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "stats") return pathname.startsWith("/stats");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "materials") return pathname.startsWith("/materials");
    if (key === "about") return pathname.startsWith("/about");
    if (key === "profile") return pathname.startsWith("/profile");
    return false;
  };

  const navLinkClass = (key: string, highlight?: boolean) => {
    const active = isActive(key);
    if (active) {
      return highlight
        ? "flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 bg-[#F4A261]/12 text-[#F4A261] font-medium border border-[#F4A261]/20"
        : "flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 bg-[#129B7F]/12 text-[#129B7F] font-medium border border-[#129B7F]/20";
    }
    return `flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 text-[#4A5568] hover:bg-[#FFFFFF] hover:text-[#152B4E] ${
      highlight ? "hover:text-[#F4A261]" : ""
    }`;
  };

  return (
    <aside className="sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4 border-b border-[#E4E9F0]">
        <div className="flex items-center gap-3">
          <img src="/brand/logo-mark.png" alt="MedPrüf" className="w-9 h-9" />
          <div>
            <h1 className="text-base font-bold text-[#152B4E] tracking-tight">
              <span>Med</span><span className="text-[#129B7F]">Prüf</span>
            </h1>
            <p className="text-[11px] text-[#A0AEC0] leading-tight">{t("exam_prep", lang)}</p>
          </div>
        </div>
      </div>

      {/* User card */}
      {userName && (
        <div className="mx-4 my-4 p-3 rounded bg-[#FFFFFF] border border-[#E4E9F0]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded bg-[#129B7F]/15 border border-[#129B7F]/30 flex items-center justify-center text-sm font-bold text-[#129B7F]">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#152B4E]">{userName}</p>
              <p className="text-xs text-[#A0AEC0]">
                {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
              </p>
            </div>
          </div>
          <div className="h-1 bg-[#F7F9FC] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#129B7F] rounded-full animate-progress"
              style={{ width: `${xpInfo.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-[#A0AEC0] mt-1 font-mono">
            {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
          </p>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="px-3 mb-2">
        <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold px-2 mb-2">
          {t("navigation", lang)}
        </p>
        {mainNavItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key, item.highlight)}>
            <span className="text-base">{item.icon}</span>
            <span className="text-sm">{item.label}</span>
            {item.highlight && !isActive(item.key) && (
              <span className="ml-auto text-[9px] font-medium bg-[#F4A261]/12 text-[#F4A261] px-1.5 py-0.5 rounded border border-[#F4A261]/20">
                Neu
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Secondary Navigation */}
      <nav className="px-3 mb-4">
        <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold px-2 mb-2">
          {lang === "de" ? "Mehr" : "More"}
        </p>
        {secondaryNavItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key)}>
            <span className="text-base">{item.icon}</span>
            <span className="text-sm">{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* Quick stats */}
      {userName && (
        <div className="px-3 mb-4">
          <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold px-2 mb-2">
            {t("your_stats", lang)}
          </p>
          <div className="grid grid-cols-3 gap-2 px-2">
            <div className="text-center">
              <p className="text-base font-bold text-[#F4A261] font-mono">{totalXp}</p>
              <p className="text-[10px] text-[#A0AEC0]">XP</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#D64545] font-mono">🔥{streak}</p>
              <p className="text-[10px] text-[#A0AEC0]">{t("streak", lang)}</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#00A896] font-mono">{accuracy}%</p>
              <p className="text-[10px] text-[#A0AEC0]">{t("accuracy", lang)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Topics list */}
      <div className="px-3 flex-1 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-[#A0AEC0] font-semibold px-2 mb-2">
          {t("topics", lang)}
        </p>
        <div className="space-y-0.5">
          {Object.entries(TOPIC_CONFIG).map(([topic, config]) => (
            <Link
              key={topic}
              href={userId ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}` : "#"}
              className="flex items-center gap-2.5 px-3 py-2 rounded text-[#4A5568] hover:bg-[#FFFFFF] hover:text-[#152B4E] transition-all duration-150"
            >
              <span className="text-sm">{config.icon}</span>
              <span className="text-xs truncate">{topic}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#E4E9F0]">
        <p className="text-[10px] text-[#A0AEC0] text-center font-mono">MedPrüf v1.0</p>
      </div>
    </aside>
  );
}
