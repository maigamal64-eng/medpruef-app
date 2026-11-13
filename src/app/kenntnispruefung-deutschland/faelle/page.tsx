import { notFound } from "next/navigation";
import { deKpEnabled } from "@/lib/de-kp";
import { deKpLang } from "@/lib/de-kp/copy";
import DeKpHub from "@/components/de-kp/DeKpHub";

export const dynamic = "force-dynamic";

export default async function DeKpHubPage({ searchParams }: { searchParams: Promise<{ lang?: string | string[] }> }) {
  if (!deKpEnabled()) notFound();
  return <DeKpHub lang={deKpLang((await searchParams).lang)} />;
}
