import type { Metadata } from "next";
import OrientationShell from "@/components/orientation/OrientationShell";
import OrientationContent from "@/components/orientation/OrientationContent";
import { guidanceLang } from "@/lib/guidance/facts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Lernfragen, Quellen und Grenzen | MedPrüf",
  description: "Was MedPrüf für österreichische Prüfungen abdeckt, welche Herkunftsfragen offen sind und wo zusätzliche Vorbereitung nötig ist.",
  alternates: { canonical: "/umfang" },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang: value } = await searchParams;
  const lang = guidanceLang(value);
  return <OrientationShell pageId="scope" lang={lang}>
    <OrientationContent pageId="scope" lang={lang} now={new Date()} />
  </OrientationShell>;
}
