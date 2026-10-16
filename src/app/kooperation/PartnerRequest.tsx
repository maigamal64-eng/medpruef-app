"use client";
/** Request form of /kooperation: the existing contact form with topic "partner" plus the two measurement events. */
import { useEffect } from "react";
import SupportContactForm from "@/components/SupportContactForm";
import { trackFunnelEvent } from "@/lib/funnel-events";

export default function PartnerRequest({ lang, title, lead }: { lang: "de" | "en"; title: string; lead: string }) {
  useEffect(() => { trackFunnelEvent("partner_page_view", { surface: lang }, { once: true }); }, [lang]);
  return (
    <section className="mt-10" aria-labelledby="partner-request-title" data-testid="partner-request">
      <h2 id="partner-request-title" className="text-lg font-bold">{title}</h2>
      <p className="mt-2 text-[15px] leading-relaxed">{lead}</p>
      <SupportContactForm lang={lang} defaultTopic="partner" className="mt-4" onSent={() => trackFunnelEvent("partner_request_sent", { surface: lang })} />
    </section>
  );
}
