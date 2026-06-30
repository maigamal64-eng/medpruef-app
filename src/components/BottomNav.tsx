"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { t } from "@/lib/i18n";
import { Home, FileText, GraduationCap, TrendingUp, Layers } from "lucide-react";
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
    if (key === "quiz") return pathname.startsWith("/quiz");
    if (key === "exam") return pathname.startsWith("/exam");
    if (key === "library") return pathname.startsWith("/library") || pathname.startsWith("/flashcards");
    if (key === "progress") return pathname.startsWith("/progress") || pathname.startsWith("/stats");
    return false;
  };

  // Generic "Quiz" entry opens the customization builder (FEEDBACK #4a:
  // choosing Quiz must offer customization, not silently dump into the full
  // bank). Topic cards still deep-link with ?topic=… and resume from there.
  const quizHref = userId ? `/quiz?setup=1&userId=${userId}` : "/quiz?setup=1";
  const quizActive = isActive("quiz");
  const libraryActive = isActive("library");

  return (
    <nav className="bottom-nav fixed bottom-0 left-0 right-0 z-50 safe-area-bottom">
      <div className="glass border-t border-[var(--mp-border)] shadow-[var(--shadow-elevated)] mx-2 max-[340px]:mx-1 mb-2 rounded-2xl">
        {/* px-1 + compact per-item padding: the bar carries FOUR flanking
            slots (2 + 2) around the raised center CTA — a symmetric 5-slot
            nav. `whitespace-nowrap` keeps the longest label (Karteikarten)
            on one line; the max-[340px] guards stay as harmless headroom. */}
        <div className="flex items-end justify-around px-1 max-[340px]:px-0.5 pt-2 pb-2.5 relative">
          {/* Home */}
          <NavItem context="bottom" href="/" icon={<Home className="w-5 h-5" />} label={t("home", lang)} active={isActive("home")} className="!px-1 max-[340px]:!px-0.5 whitespace-nowrap" />

          {/* Exam */}
          <NavItem context="bottom" href="/exam" icon={<GraduationCap className="w-5 h-5" />} label={t("exam", lang)} active={isActive("exam")} className="!px-1 max-[340px]:!px-0.5 whitespace-nowrap" />

          {/* CENTER: Library CTA — raised, prominent. The personal study home
              (flash-notes + question-flashcard review, reached from inside).
              Promoted to the centerpiece per [name]; Quiz keeps a full flanking
              slot so it stays equally reachable. Highlights on /library + /flashcards. */}
          <Link
            href="/library"
            aria-label={lang === "de" ? "Bibliothek" : "Library"}
            className="flex flex-col items-center -mt-5 transition-transform active:scale-95"
          >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg ${
              libraryActive
                ? "bg-[var(--mp-viridian)] ring-4 ring-[var(--mp-viridian)]/20"
                : "bg-[var(--mp-cta-blue)] ring-4 ring-[var(--mp-cta-blue)]/15 hover:bg-[var(--mp-cta-blue-hover)]"
            }`}>
              <Layers className="w-6 h-6 text-white" />
            </div>
            <span className={`text-[10px] mt-1 ${libraryActive ? "font-bold text-[var(--mp-viridian)]" : "font-semibold text-[var(--mp-cta-blue)]"}`}>
              {lang === "de" ? "Bibliothek" : "Library"}
            </span>
          </Link>

          {/* Quiz — flanking slot (moved off the center CTA so the Library is
              the centerpiece; Quiz stays one tap away). */}
          <NavItem context="bottom" href={quizHref} icon={<FileText className="w-5 h-5" />} label={t("quiz", lang)} active={quizActive} className="!px-1 max-[340px]:!px-0.5 whitespace-nowrap" />

          {/* Progress — rightmost flanking slot. Profile/Settings moved OFF
              the bottom nav (it split 2-left vs 3-right around the raised CTA);
              Settings is reachable via the home-header avatar → /settings. */}
          <NavItem context="bottom" href="/progress" icon={<TrendingUp className="w-5 h-5" />} label={t("progress", lang)} active={isActive("progress")} className="!px-1 max-[340px]:!px-0.5 whitespace-nowrap" />
        </div>
      </div>
    </nav>
  );
}
