"use client";
/**
 * iOS install coach on Home (UX-ONB-44, UX-HOME-54). Shown once, in real iOS
 * Safari that is not running standalone, after the 10th answered question,
 * as the announcement queue's install card: never on a first visit, never in
 * Telegram, Instagram, Gmail or other in-app browsers (adding to the Home
 * screen is impossible there), never in the installed app. Non-modal, no
 * auto-dismiss; "Verstanden" ends it for good. Text steps carry the
 * instruction (the icon strip is never the only one) and the copy promises
 * app-like access, not offline study (pick-offline A). Settings re-offers it.
 */
import { useEffect, useRef, useState } from "react";
import IosInstallGuide from "@/components/master-pwa/IosInstallGuide";
import { readInstallEnv, resolveIosInstallState } from "@/lib/master-pwa/ios-install";
import { dismissSurface, useAnnouncementSlot } from "@/lib/announcements/queue";
import { safeStorage } from "@/lib/safe-storage";
import { t, type Lang } from "@/lib/i18n";
import { trackEvent } from "@/lib/tracker";

export const IOS_COACH_DONE_KEY = "medpruef_ios_coach_done";
export const IOS_COACH_MIN_ANSWERS = 10;

export function iosCoachEligible(input: { state: string; totalAnswered: number | null; done: boolean }): boolean {
  return input.state === "ready" && !input.done && (input.totalAnswered ?? 0) >= IOS_COACH_MIN_ANSWERS;
}

export default function HomeIosInstallCard({ lang, totalAnswered }: { lang: Lang; totalAnswered: number | null }) {
  const [eligible, setEligible] = useState(false);
  const shown = useRef(false);
  useEffect(() => {
    let done = false;
    try { done = safeStorage.getItem(IOS_COACH_DONE_KEY) === "1"; } catch { /* storage blocked: show at most this visit */ }
    setEligible(iosCoachEligible({ state: resolveIosInstallState(readInstallEnv()), totalAnswered, done }));
  }, [totalAnswered]);
  const granted = useAnnouncementSlot("install_card", eligible);
  useEffect(() => {
    if (granted && !shown.current) { shown.current = true; trackEvent("pwa_coach_shown", { platform: "ios" }); }
  }, [granted]);
  if (!granted) return null;
  const acknowledge = () => {
    try { safeStorage.setItem(IOS_COACH_DONE_KEY, "1"); } catch { /* blocked */ }
    dismissSurface("install_card", "no_interest");
    setEligible(false);
  };
  return (
    <div className="mb-6" data-testid="home-ios-coach">
      <IosInstallGuide lang={lang} />
      <button type="button" onClick={acknowledge} className="mt-2 mp-btn mp-btn--secondary min-h-11">{t("a22_ios_coach_ok", lang)}</button>
    </div>
  );
}
