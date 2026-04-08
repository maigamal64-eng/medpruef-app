"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { Home, FileText, GraduationCap, TrendingUp, BarChart3, User } from "lucide-react";

type Lang = "de" | "en";

interface BottomNavProps {
  lang: Lang;
  userId?: string;
}

export default function BottomNav({ lang, userId }: BottomNavProps) {
  const pathname = usePathname();

  const iconClass = "w-5 h-5";
  const items = [
    { href: "/", icon: <Home className={iconClass} />, label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz?topic=random", icon: <FileText className={iconClass} />, label: t("quiz", lang), key: "quiz" },
    { href: "/exam", icon: <GraduationCap className={iconClass} />, label: t("exam", lang), key: "exam", highlight: true },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: <BarChart3 className={iconClass} />, label: t("stats", lang), key: "stats" },
    { href: "/progress", icon: <TrendingUp className={iconClass} />, label: t("progress", lang), key: "progress" },
    { href: "/profile", icon: <User className={iconClass} />, label: t("profile", lang), key: "profile" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz") || pathname.startsWith("/flashcards");
    if (key === "stats") return pathname.startsWith("/stats");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "progress") return pathname.startsWith("/progress");
    if (key === "profile") return pathname.startsWith("/profile") || pathname.startsWith("/settings");
    return false;
  };

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="glass border-t border-[#E4E9F0] shadow-[var(--shadow-elevated)] mx-3 mb-2 rounded-2xl">
        <div className="flex items-center justify-around px-1 py-3">
          {items.map((item) => {
            const active = isActive(item.key);
            const examHighlight = item.highlight && !active;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-1.5 px-3 rounded transition-all duration-200 ${
                  active
                    ? item.highlight
                      ? "text-[#F4A261]"
                      : "text-[#007B5F]"
                    : examHighlight
                    ? "text-[#F4A261]/60 active:text-[#F4A261]"
                    : "text-[#A0AEC0]/70 active:text-[#4A5568]"
                }`}
              >
                <span className={`transition-transform duration-200 ${active ? "scale-110" : ""}`}>
                  {item.icon}
                </span>
                <span className={`text-[9px] ${active ? (item.highlight ? "text-[#F4A261] font-semibold" : "text-[#007B5F] font-semibold") : examHighlight ? "text-[#F4A261]/60 font-medium" : "font-medium"}`}>
                  {item.label}
                </span>
                {active && (
                  <div className={`w-1 h-1 rounded-full mt-0.5 ${item.highlight ? "bg-[#F4A261]" : "bg-[#007B5F]"}`} />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
