import GuidanceShell from "@/components/guidance/GuidanceShell";
import { guidanceLang } from "@/lib/guidance/facts";
import { guidanceMetadataFor } from "@/lib/seo/gsc";

// a-seo-from-gsc: own canonical (the root default pointed at /landing).
export const generateMetadata = guidanceMetadataFor("/wien-route/sip-regeln");

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  return <GuidanceShell pageId="sip-regeln" lang={guidanceLang(params.lang)} initialNow={new Date().toISOString()} />;
}
