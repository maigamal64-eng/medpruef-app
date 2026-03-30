"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";

type Lang = "de" | "en";

interface BottomNavProps {
  lang: Lang;
  userId?: string;
}

export default function BottomNav({ lang, userId }: BottomNavProps) {
  const pathname = usePathname();

  const items = [
    { href: "/", icon: "🏠", label: t("home", lang), key: "home" },
    { href: userId ? `/quiz?topic=random&userId=${userId}` : "/quiz?topic=random", icon: "📝", label: t("quiz", lang), key: "quiz" },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: "📊", label: t("stats", lang), key: "stats" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "stats") return pathname.startsWith("/stats");
    return false;
  };

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="bg-[#0F172A]/95 backdrop-blur-xl border-t border-[#334155]/50">
        <div className="flex items-center justify-around px-4 py-2">
          {items.map((item) => {
            const active = isActive(item.key);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 py-1.5 px-5 rounded-xl transition-all duration-200 ${
                  active
                    ? "text-[#0891B2]"
                    : "text-[#64748B] active:text-[#94A3B8]"
                }`}
              >
                <span className={`text-xl transition-transform duration-200 ${active ? "scale-110" : ""}`}>
                  {item.icon}
                </span>
                <span className={`text-[10px] font-medium ${active ? "text-[#0891B2]" : ""}`}>
                  {item.label}
                </span>
                {active && (
                  <div className="w-1 h-1 rounded-full bg-[#0891B2] mt-0.5" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
