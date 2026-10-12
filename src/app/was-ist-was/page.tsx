import type { Metadata } from "next";
import OrientationShell from "@/components/orientation/OrientationShell";
import OrientationContent from "@/components/orientation/OrientationContent";
import { guidanceLang } from "@/lib/guidance/facts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Prüfungsnamen in Österreich verstehen | MedPrüf",
  description: "Stichprobentest, SIP, KMP und Sprachprüfungen einordnen und den passenden Übungsumfang prüfen.",
  alternates: { canonical: "/was-ist-was" },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const { lang: value } = await searchParams;
  const lang = guidanceLang(value);
  return <OrientationShell pageId="decoder" lang={lang}>
    <OrientationContent pageId="decoder" lang={lang} now={new Date()} />
  </OrientationShell>;
}
