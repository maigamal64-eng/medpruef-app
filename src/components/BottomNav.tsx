"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { Home, FileText, GraduationCap, TrendingUp, User } from "lucide-react";
import { NavItem } from "@/components/ui";

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

  const quizHref = userId ? `/quiz?topic=random&userId=${userId}` : "/quiz?topic=random";
  const quizActive = isActive("quiz");

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="glass border-t border-[var(--mp-border)] shadow-[var(--shadow-elevated)] mx-2 mb-2 rounded-2xl">
        <div className="flex items-end justify-around px-2 pt-2 pb-2.5 relative">
          {/* Home */}
          <NavItem context="bottom" href="/" icon={<Home className="w-5 h-5" />} label={t("home", lang)} active={isActive("home")} />

          {/* Exam */}
          <NavItem context="bottom" href="/exam" icon={<GraduationCap className="w-5 h-5" />} label={t("exam", lang)} active={isActive("exam")} />

          {/* CENTER: Quiz CTA — raised, prominent. Bespoke — no NavItem
              variant exists for a raised floating CTA. Preserved exactly. */}
          <Link
            href={quizHref}
            className="flex flex-col items-center -mt-5 transition-transform active:scale-95"
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${
              quizActive
                ? "bg-[var(--mp-viridian)] ring-4 ring-[var(--mp-viridian)]/20"
                : "bg-[var(--mp-cta-blue)] ring-4 ring-[var(--mp-cta-blue)]/15 hover:bg-[var(--mp-cta-blue-hover)]"
            }`}>
              <FileText className="w-6 h-6 text-white" />
            </div>
            <span className={`text-[10px] mt-1 ${quizActive ? "font-bold text-[var(--mp-viridian)]" : "font-semibold text-[var(--mp-cta-blue)]"}`}>
              {t("quiz", lang)}
            </span>
          </Link>

          {/* Progress */}
          <NavItem context="bottom" href="/progress" icon={<TrendingUp className="w-5 h-5" />} label={t("progress", lang)} active={isActive("progress")} />

          {/* Settings (was Profile) */}
          <NavItem context="bottom" href="/settings" icon={<User className="w-5 h-5" />} label={t("profile", lang)} active={isActive("settings")} />
        </div>
      </div>
    </nav>
  );
}
