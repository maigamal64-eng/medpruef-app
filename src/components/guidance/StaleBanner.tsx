import React from "react";
import { isFactStale, type GuidanceFact, type GuidanceLang } from "@/lib/guidance/facts";
import { guidanceCopy } from "@/lib/i18n-lb-guidance";

export default function StaleBanner({ facts, lang, now }: { facts: GuidanceFact[]; lang: GuidanceLang; now: Date }) {
  if (!facts.some((fact) => isFactStale(fact, now))) return null;
  return <p role="status" className="rounded-xl border border-[var(--mp-border)] p-4 font-semibold">{guidanceCopy[lang].stale}</p>;
}
