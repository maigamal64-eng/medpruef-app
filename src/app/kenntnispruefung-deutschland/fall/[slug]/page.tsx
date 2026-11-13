import { notFound } from "next/navigation";
import { deKpEnabled } from "@/lib/de-kp";
import { deKpLang } from "@/lib/de-kp/copy";
import DeKpRunner from "@/components/de-kp/DeKpRunner";

export const dynamic = "force-dynamic";

export default async function DeKpCasePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string | string[]; src?: string | string[] }> }) {
  if (!deKpEnabled()) notFound();
  const { slug } = await params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) notFound();
  const q = await searchParams;
  const src = Array.isArray(q.src) ? q.src[0] : q.src;
  return <DeKpRunner slug={slug} lang={deKpLang(q.lang)} source={src === "landing" ? "de_kp_landing" : src === "hub" ? "de_kp_hub" : null} />;
}
