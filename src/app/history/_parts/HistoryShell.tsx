"use client";

/**
 * UX-GLOBAL-09 / UX-EXM-36: the standard learner shell (Sidebar on desktop,
 * BottomNav on phones) for the History list and the exam detail route.
 */
import { useEffect, useState } from "react";
import { AppLayout } from "@/components/ui";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import PartialTranslationNote from "@/components/PartialTranslationNote";
import { getStoredSession } from "@/lib/auth";
import { useLang } from "@/lib/i18n";

export default function HistoryShell({ children }: { children: React.ReactNode }) {
  const lang = useLang();
  const [userId, setUserId] = useState<string | undefined>();
  useEffect(() => { setUserId(getStoredSession()?.user?.id); }, []);
  return (
    <AppLayout sidebar={<Sidebar lang={lang} userId={userId} />} bottomNav={<BottomNav lang={lang} userId={userId} />}>
      <div className="main-content">
        {/* pb-24 keeps the last row clear of the feedback launcher (EXM-41). */}
        <main className="min-h-screen bg-[var(--mp-bg)] px-4 lg:px-8 py-6 pb-24 overflow-x-hidden">
          <div className="max-w-3xl mx-auto">
            <PartialTranslationNote />
            {children}
          </div>
        </main>
      </div>
    </AppLayout>
  );
}
