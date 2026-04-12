"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { Home, FileText, GraduationCap, TrendingUp, User } from "lucide-react";

type Lang = "de" | "en";

interface BottomNavProps {
  lang: Lang;
  userId?: string;
}

export default function BottomNav({ lang, userId }: BottomNavProps) {
  const pathname = usePathname();

  const isActive = (key: string) => {
    if (key === "home") return pathname === "/";
    if (key === "quiz") return pathname.startsWith("/quiz") || pathname.startsWith("/flashcards");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "progress") return pathname.startsWith("/progress") || pathname.startsWith("/stats");
    if (key === "settings") return pathname.startsWith("/settings") || pathname.startsWith("/profile");
    return false;
  };

  const navItemClass = (key: string) => {
    const active = isActive(key);
    return `flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-xl transition-all duration-200 ${
      active
        ? "text-[#007B5F]"
        : "text-[#A0AEC0] active:text-[#4A5568]"
    }`;
  };

  const quizHref = userId ? `/quiz?topic=random&userId=${userId}` : "/quiz?topic=random";
  const quizActive = isActive("quiz");

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="glass border-t border-[#E4E9F0] shadow-[var(--shadow-elevated)] mx-2 mb-2 rounded-2xl">
        <div className="flex items-end justify-around px-2 pt-2 pb-2.5 relative">
          {/* Home */}
          <Link href="/" className={navItemClass("home")}>
            <Home className="w-5 h-5" />
            <span className={`text-[10px] ${isActive("home") ? "font-semibold text-[#007B5F]" : "font-medium"}`}>
              {t("home", lang)}
            </span>
          </Link>

          {/* Exam */}
          <Link href="/exam" className={navItemClass("exam")}>
            <GraduationCap className="w-5 h-5" />
            <span className={`text-[10px] ${isActive("exam") ? "font-semibold text-[#007B5F]" : "font-medium"}`}>
              {t("exam", lang)}
            </span>
          </Link>

          {/* CENTER: Quiz CTA — raised, prominent */}
          <Link
            href={quizHref}
            className={`flex flex-col items-center -mt-5 transition-transform active:scale-95`}
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${
              quizActive
                ? "bg-[#007B5F] ring-4 ring-[#007B5F]/20"
                : "bg-[#003A8C] ring-4 ring-[#003A8C]/15 hover:bg-[#002d6e]"
            }`}>
              <FileText className="w-6 h-6 text-white" />
            </div>
            <span className={`text-[10px] mt-1 ${quizActive ? "font-bold text-[#007B5F]" : "font-semibold text-[#003A8C]"}`}>
              {t("quiz", lang)}
            </span>
          </Link>

          {/* Progress */}
          <Link href="/progress" className={navItemClass("progress")}>
            <TrendingUp className="w-5 h-5" />
            <span className={`text-[10px] ${isActive("progress") ? "font-semibold text-[#007B5F]" : "font-medium"}`}>
              {t("progress", lang)}
            </span>
          </Link>

          {/* Settings (was Profile) */}
          <Link href="/settings" className={navItemClass("settings")}>
            <User className="w-5 h-5" />
            <span className={`text-[10px] ${isActive("settings") ? "font-semibold text-[#007B5F]" : "font-medium"}`}>
              {t("profile", lang)}
            </span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
