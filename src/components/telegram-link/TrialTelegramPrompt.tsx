"use client";
/**
 * Home prompt (a-trial-phone-gate): shown only while /api/auth/me reports
 * trial_telegram_link (a new account that could start the 3-day trial except
 * that no Telegram is linked, and TELEGRAM_LINK_ENABLED is on). "Später"
 * hides it for 3 days on this device for this account. Nothing is fetched
 * until the learner taps the button.
 */
import { useEffect, useState } from "react";
import { useLang, renderLang } from "@/lib/i18n";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { safeStorage } from "@/lib/safe-storage";
import TelegramTrialLink from "./TelegramTrialLink";

const KEY = "medpruef_trial_tg_later_v1:";
const LATER_MS = 3 * 86_400_000;

export default function TrialTelegramPrompt({ userId, className = "" }: { userId: string; className?: string }) {
  const lang = renderLang(useLang());
  const { trialTelegramLink, reverseTrialEndsAt } = useUserTier();
  const [hidden, setHidden] = useState(true);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    const raw = Number(safeStorage.getItem(KEY + userId) ?? "");
    setHidden(Number.isFinite(raw) && raw > Date.now());
  }, [userId]);

  if (!linked && (!trialTelegramLink || reverseTrialEndsAt || hidden || userId.startsWith("guest_"))) return null;
  if (linked && reverseTrialEndsAt) return null; // the trial line takes over
  const later = () => { safeStorage.setItem(KEY + userId, String(Date.now() + LATER_MS)); setHidden(true); };
  return <TelegramTrialLink lang={lang} mode="trial" onLater={later} onLinked={() => setLinked(true)} className={className} />;
}
