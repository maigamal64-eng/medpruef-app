import Link from "next/link";
import GuidanceShell from "@/components/guidance/GuidanceShell";
import { type GuidanceFact, type GuidanceLang } from "@/lib/guidance/facts";
import data from "@/lib/guidance-data/wien-route.data.json";
import { wienRouteCopy } from "@/lib/i18n-lb-wien-route";
import ContactAddresses from "./ContactAddresses";

export type WienRoutePageId = keyof typeof wienRouteCopy.de.pages;

export default function WienRoutePage({ pageId, lang, initialNow }: { pageId: WienRoutePageId; lang: GuidanceLang; initialNow: string }) {
  const copy = wienRouteCopy[lang];
  const page = copy.pages[pageId];
  const facts = (data.facts as GuidanceFact[]).filter((fact) => fact.applies_to.includes(pageId));
  return <GuidanceShell pageId={pageId} lang={lang} title={page.title} lede={page.lede} initialNow={initialNow} facts={facts}>
    {pageId === "kontakte" && <ContactAddresses lang={lang} />}
    <nav aria-label={copy.navigation} className="not-prose mt-8 border-t border-[var(--mp-border)] pt-6">
      <h2 className="mb-4 text-lg font-semibold">{copy.navigation}</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(copy.pages) as WienRoutePageId[]).filter((id) => id !== pageId).map((id) => <li key={id} className="min-w-0">
          <Link href={`/wien-route/${id}?lang=${lang}`} className="block rounded-xl border border-[var(--mp-border)] p-4 font-semibold underline-offset-4 hover:underline">{copy.pages[id].title}</Link>
        </li>)}
      </ul>
    </nav>
  </GuidanceShell>;
}
