import ExtrasSurface from "@/components/exam-extras/ExtrasSurface";
import { extraLanguage } from "@/lib/exam-extras";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  return <ExtrasSurface page="aenderungen" lang={extraLanguage(params.lang)} explicit={typeof params.lang === "string"} />;
}
