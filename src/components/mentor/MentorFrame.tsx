"use client";

/**
 * Shared page frame for the mentor screens: the app layout (sidebar and
 * bottom nav) plus the learner session and language. Every mentor route
 * renders inside it so chrome, language and sign-in handling stay identical.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain } from "lucide-react";
import { AppLayout, EmptyState } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { getStoredSession } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { mentorT, type MentorUiLang } from "@/lib/i18n-mentor";
import { keyboardIsOpen } from "./r1-shell-state";
import { LEGAL_LINKS, legalLang } from "@/components/LegalFooter";

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
  const pathname = usePathname();
  const isChat = pathname === "/mentor" || pathname === "/mentor/chat";
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [visibleHeight, setVisibleHeight] = useState<number | null>(null);
  useEffect(() => {
    if (!isChat || !window.visualViewport) return;
    const viewport = window.visualViewport;
    let baseline = window.innerHeight;
    const update = () => {
      baseline = Math.max(baseline, window.innerHeight);
      setVisibleHeight(viewport.height);
      setKeyboardOpen(keyboardIsOpen(baseline, viewport.height));
    };
    const rotate = () => { baseline = window.innerHeight; update(); };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("orientationchange", rotate);
    document.addEventListener("focusout", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("orientationchange", rotate);
      document.removeEventListener("focusout", update);
    };
  }, [isChat]);
  const sidebar = (
    <Sidebar lang={session.navLang} userId={session.userId} userName={session.userName} totalXp={session.totalXp} />
  );
  const bottomNav = isChat && keyboardOpen ? null : <BottomNav lang={session.navLang} userId={session.userId} />;

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
            {/* The chat routes hide the site footer; signed-out visitors still get the legal links (ECG section 5). */}
            {isChat && <ul data-mentor-legal className="mt-6 flex flex-wrap justify-center gap-x-4 text-[12px] text-[var(--mp-fg-muted)]">{LEGAL_LINKS.map(l => { const label = l.label[legalLang(session.uiLang)]; return <li key={l.href}>{l.href.startsWith("mailto:") ? <a href={l.href} className="flex min-h-11 items-center underline-offset-2 hover:underline">{label}</a> : <Link href={l.href} className="flex min-h-11 items-center underline-offset-2 hover:underline">{label}</Link>}</li>; })}</ul>}
          </div>
        </main>
      </AppLayout>
    );
  }

  return (
    <>
      {/* Compact phone nav for the chat (a-mentor-mobile-2 shell-6): written for the
          nav > ul > li markup; every tab, including the More button, is 44 px and the
          raised Practise icon is compacted instead of squashed. The chat main sizes
          itself to the visible height minus the status banner, so the layout drops
          its 100dvh minimum (a banner would otherwise scroll the document). */}
      {isChat && <style>{`
        .app-layout.mentor-chat-frame { min-height: 0; }
        @media (max-width: 1023px) {
          .mentor-chat-frame { --mobile-nav-clearance: calc(46px + env(safe-area-inset-bottom, 0px)); }
          .mentor-chat-frame .bottom-nav { height: var(--mobile-nav-clearance); padding-bottom: env(safe-area-inset-bottom, 0px); }
          .mentor-chat-frame .bottom-nav > ul { height: 45px; padding-top: 0; padding-bottom: 0; align-items: center; }
          .mentor-chat-frame .bottom-nav li > :is(a, button) { display: flex; flex: 1 1 0; min-width: 44px; height: 44px; min-height: 44px; margin-top: 0 !important; padding-top: 1px !important; padding-bottom: 1px !important; gap: 0; justify-content: center; }
          .mentor-chat-frame .bottom-nav li > :is(a, button) > span:last-child { margin-top: 0; line-height: 14px; font-size: 12px; }
          .mentor-chat-frame .bottom-nav li > :is(a, button) svg { width: 18px; height: 18px; }
          .mentor-chat-frame .bottom-nav .mp-bottom-nav__raised > span:first-child { width: 40px; height: 24px; border-radius: 8px; box-shadow: none; }
        }
      `}</style>}
      {isChat && visibleHeight !== null && <style>{`.mentor-chat-frame { --mentor-visible-height: ${Math.round(visibleHeight)}px; }`}</style>}
      <AppLayout className={isChat ? `mentor-frame mentor-chat-frame ${keyboardOpen ? "[&_.main-content]:!pb-0" : ""}` : "mentor-frame"} sidebar={sidebar} bottomNav={bottomNav}>
        {children}
      </AppLayout>
    </>
  );
}
