import React from "react";
import type { GuidanceFact, GuidanceLang } from "@/lib/guidance/facts";
import { formatGuidanceDate } from "@/lib/guidance/facts";
import { guidanceCopy } from "@/lib/i18n-lb-guidance";

export default function FactStamp({ fact, lang }: { fact: GuidanceFact; lang: GuidanceLang }) {
  const c = guidanceCopy[lang];
  return <p className="!text-xs !leading-relaxed !mt-3 break-words" data-fact-stamp={fact.id}>
    <strong>{c[fact.status]}</strong>{" · "}{c.checked}{" "}{formatGuidanceDate(fact.read_on, lang)}{" "}{c.against}{" "}
    <a href={fact.source_url} target="_blank" rel="noreferrer">{fact.source_label}</a>{", "}{fact.edition}
  </p>;
}
