"use client";
/**
 * The one-time Home card after the reverse trial ended (a-trial-end-decision).
 * Asked only for an account without paid access (the trial's own access has
 * ended), shown once: the server keeps a marker (trial_end_card_shown with
 * surface home) and the device keeps one too. Queue surface "trial_end".
 */
import { useEffect, useState } from "react";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import TrialEndCard from "./TrialEndCard";
import { homeSeenOnDevice, markHomeSeen, useTrialEnd } from "./useTrialEnd";

export default function TrialEndHomeCard({ userId, lang, className = "" }: { userId: string; lang: string; className?: string }) {
  const { isPaid, isLoading } = useUserTier();
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(homeSeenOnDevice(userId)); }, [userId]);
  const data = useTrialEnd("home", !isLoading && !isPaid && !hidden);
  const wants = Boolean(data && data.view.state === "ended" && data.view.homeSeen === false);
  const granted = useAnnouncementSlot("trial_end", wants);
  useEffect(() => {
    if (!granted) return;
    markHomeSeen(userId);
  }, [granted, userId]);
  if (!granted || !data) return null;
  return (
    <TrialEndCard
      surface="home"
      data={data}
      lang={lang}
      className={className}
      onLater={() => { dismissSurface("trial_end", "later"); setHidden(true); }}
    />
  );
}
