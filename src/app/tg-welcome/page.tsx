/**
 * Telegram Mini App welcome (a-tg-miniapp-welcome). A real 404 unless
 * TG_MINIAPP_WELCOME_ENABLED is the literal "true" (middleware rewrite plus
 * notFound() here). The bot's exam buttons open it inside Telegram.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { parseTgWelcomeQuery, tgMiniappWelcomeEnabled } from "@/lib/tg-welcome";
import TgWelcomeClient from "./TgWelcomeClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "MedPrüf",
  robots: { index: false, follow: false },
};

export default async function TgWelcomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!tgMiniappWelcomeEnabled()) notFound();
  const sp = await searchParams;
  const { exam, lang } = parseTgWelcomeQuery({ exam: sp.exam, lang: sp.lang });
  return <TgWelcomeClient exam={exam} lang={lang} />;
}
