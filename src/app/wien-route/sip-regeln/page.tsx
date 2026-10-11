import GuidanceShell from "@/components/guidance/GuidanceShell";
import { guidanceLang } from "@/lib/guidance/facts";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  return <GuidanceShell pageId="sip-regeln" lang={guidanceLang(params.lang)} initialNow={new Date().toISOString()} />;
}
