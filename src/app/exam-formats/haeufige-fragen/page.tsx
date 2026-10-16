import ExtrasSurface from "@/components/exam-extras/ExtrasSurface";
import { extraLanguage } from "@/lib/exam-extras";
import { guidanceMetadataFor } from "@/lib/seo/gsc";

// a-seo-from-gsc: own canonical (the root default pointed at /landing).
export const generateMetadata = guidanceMetadataFor("/exam-formats/haeufige-fragen");

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  return <ExtrasSurface page="haeufige-fragen" lang={extraLanguage(params.lang)} explicit={typeof params.lang === "string"} />;
}
