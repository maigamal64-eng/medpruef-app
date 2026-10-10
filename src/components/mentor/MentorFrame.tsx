"use client";

/**
 * Shared page frame for the mentor screens: the app layout (sidebar and
 * bottom nav) plus the learner session and language. Every mentor route
 * renders inside it so chrome, language and sign-in handling stay identical.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain } from "lucide-react";
import { AppLayout, EmptyState } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { getStoredSession } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";

export interface MentorSession {
  uiLang: MentorUiLang;
  navLang: "de" | "en";
  userId: string;
  userName: string;
  totalXp: number;
  resolved: boolean;
}

export function useMentorSession(): MentorSession {
  const uiLang = useLang();
  const [s, setS] = useState({ userId: "", userName: "", totalXp: 0, resolved: false });
  useEffect(() => {
    const session = getStoredSession();
    const id = session?.user?.id ?? "";
    setS({
      userId: id && !id.startsWith("guest_") ? id : "",
      userName: session?.user?.first_name ?? "",
      totalXp: session?.gamification?.total_xp ?? 0,
      resolved: true,
    });
  }, []);
  return { uiLang, navLang: uiLang === "de" ? "de" : "en", ...s };
}

export default function MentorFrame({
  session,
  children,
  requireSignIn = true,
}: {
  session: MentorSession;
  children: React.ReactNode;
  requireSignIn?: boolean;
}) {
  const sidebar = (
    <Sidebar lang={session.navLang} userId={session.userId} userName={session.userName} totalXp={session.totalXp} />
  );
  const bottomNav = <BottomNav lang={session.navLang} userId={session.userId} />;

  if (requireSignIn && session.resolved && !session.userId) {
    return (
      <AppLayout sidebar={sidebar} bottomNav={bottomNav}>
        <main className="main-content flex min-h-dvh flex-col items-center justify-center bg-[var(--mp-bg)] px-4">
          <div className="w-full max-w-md">
            <EmptyState
              icon={<Brain className="h-10 w-10" aria-hidden />}
              title={mentorT("page_title", session.uiLang)}
              body={mentorT("err_unauthenticated", session.uiLang)}
              action={
                <Link href="/login?next=%2Fmentor" className="mp-btn mp-btn--primary mt-2">
                  {mentorT("btn_signin", session.uiLang)}
                </Link>
              }
            />
          </div>
        </main>
      </AppLayout>
    );
  }

  return (
    <AppLayout sidebar={sidebar} bottomNav={bottomNav}>
      {children}
    </AppLayout>
  );
}
