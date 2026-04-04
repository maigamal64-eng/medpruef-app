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
    { href: "/exam", icon: "🎓", label: t("exam", lang), key: "exam", highlight: true },
    { href: "/mentor", icon: "🧠", label: "Mentor", key: "mentor" },
    { href: userId ? `/stats?userId=${userId}` : "/stats", icon: "📊", label: t("stats", lang), key: "stats" },
    { href: "/profile", icon: "👤", label: t("profile", lang), key: "profile" },
  ];

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "stats") return pathname.startsWith("/stats");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "mentor") return pathname.startsWith("/mentor");
    if (key === "profile") return pathname.startsWith("/profile");
    return false;
  };

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="bg-[#FFFFFF] border-t border-[#E4E9F0]">
        <div className="flex items-center justify-around px-1 py-2">
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
                    : "text-[#A0AEC0] active:text-[#4A5568]"
                }`}
              >
                <span className={`text-lg transition-transform duration-200 ${active ? "scale-110" : ""}`}>
                  {item.icon}
                </span>
                <span className={`text-[9px] font-medium ${active ? (item.highlight ? "text-[#F4A261]" : "text-[#007B5F]") : examHighlight ? "text-[#F4A261]/60" : ""}`}>
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
