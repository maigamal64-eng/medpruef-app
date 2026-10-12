import WienRoutePage from "@/components/wien-route/WienRoutePage";
import { guidanceLang } from "@/lib/guidance/facts";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  const params = await searchParams;
  return <WienRoutePage pageId="studierendenstatus" lang={guidanceLang(params.lang)} initialNow={new Date().toISOString()} />;
}
