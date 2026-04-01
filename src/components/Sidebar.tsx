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
        ? "flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 bg-[#FFB95F]/12 text-[#FFB95F] font-medium border border-[#FFB95F]/20"
        : "flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 bg-[#6BD8CB]/12 text-[#6BD8CB] font-medium border border-[#6BD8CB]/20";
    }
    return `flex items-center gap-3 px-3 py-2.5 rounded mb-0.5 transition-all duration-150 text-[#BCC9C6] hover:bg-[#191F31] hover:text-[#DCE1FB] ${
      highlight ? "hover:text-[#FFB95F]" : ""
    }`;
  };

  return (
    <aside className="sidebar flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-6 pb-4 border-b border-[#3D4947]">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded border border-[#6BD8CB]/30 bg-[#6BD8CB]/10 flex items-center justify-center text-base font-bold text-[#6BD8CB]">
            M
          </div>
          <div>
            <h1 className="text-base font-bold text-[#DCE1FB] tracking-tight">MedPrüf</h1>
            <p className="text-[11px] text-[#879391] leading-tight">{t("exam_prep", lang)}</p>
          </div>
        </div>
      </div>

      {/* User card */}
      {userName && (
        <div className="mx-4 my-4 p-3 rounded bg-[#191F31] border border-[#3D4947]">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded bg-[#6BD8CB]/15 border border-[#6BD8CB]/30 flex items-center justify-center text-sm font-bold text-[#6BD8CB]">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#DCE1FB]">{userName}</p>
              <p className="text-xs text-[#879391]">
                {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
              </p>
            </div>
          </div>
          <div className="h-1 bg-[#23293C] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#6BD8CB] rounded-full animate-progress"
              style={{ width: `${xpInfo.progress}%` }}
            />
          </div>
          <p className="text-[10px] text-[#879391] mt-1 font-mono">
            {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
          </p>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="px-3 mb-2">
        <p className="text-[10px] uppercase tracking-wider text-[#879391] font-semibold px-2 mb-2">
          {t("navigation", lang)}
        </p>
        {mainNavItems.map((item) => (
          <Link key={item.key} href={item.href} className={navLinkClass(item.key, item.highlight)}>
            <span className="text-base">{item.icon}</span>
            <span className="text-sm">{item.label}</span>
            {item.highlight && !isActive(item.key) && (
              <span className="ml-auto text-[9px] font-medium bg-[#FFB95F]/12 text-[#FFB95F] px-1.5 py-0.5 rounded border border-[#FFB95F]/20">
                Neu
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* Secondary Navigation */}
      <nav className="px-3 mb-4">
        <p className="text-[10px] uppercase tracking-wider text-[#879391] font-semibold px-2 mb-2">
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
          <p className="text-[10px] uppercase tracking-wider text-[#879391] font-semibold px-2 mb-2">
            {t("your_stats", lang)}
          </p>
          <div className="grid grid-cols-3 gap-2 px-2">
            <div className="text-center">
              <p className="text-base font-bold text-[#FFB95F] font-mono">{totalXp}</p>
              <p className="text-[10px] text-[#879391]">XP</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#FFB4AB] font-mono">🔥{streak}</p>
              <p className="text-[10px] text-[#879391]">{t("streak", lang)}</p>
            </div>
            <div className="text-center">
              <p className="text-base font-bold text-[#4EDEA3] font-mono">{accuracy}%</p>
              <p className="text-[10px] text-[#879391]">{t("accuracy", lang)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Topics list */}
      <div className="px-3 flex-1 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-[#879391] font-semibold px-2 mb-2">
          {t("topics", lang)}
        </p>
        <div className="space-y-0.5">
          {Object.entries(TOPIC_CONFIG).map(([topic, config]) => (
            <Link
              key={topic}
              href={userId ? `/quiz?topic=${encodeURIComponent(topic)}&userId=${userId}` : "#"}
              className="flex items-center gap-2.5 px-3 py-2 rounded text-[#BCC9C6] hover:bg-[#191F31] hover:text-[#DCE1FB] transition-all duration-150"
            >
              <span className="text-sm">{config.icon}</span>
              <span className="text-xs truncate">{topic}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-[#3D4947]">
        <p className="text-[10px] text-[#879391] text-center font-mono">MedPrüf v1.0</p>
      </div>
    </aside>
  );
}
