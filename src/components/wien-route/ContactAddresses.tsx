"use client";

import React, { useState } from "react";
import data from "@/lib/guidance-data/wien-route.data.json";
import { wienRouteCopy } from "@/lib/i18n-lb-wien-route";
import FactStamp from "@/components/guidance/FactStamp";
import type { GuidanceFact, GuidanceLang } from "@/lib/guidance/facts";

export default function ContactAddresses({ lang }: { lang: GuidanceLang }) {
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const copy = wienRouteCopy[lang];
  return <section>
    <h2>{copy.contactHeading}</h2>
    <p>{copy.contactNote}</p>
    {data.contacts.map((contact) => {
      const address = [contact.local, contact.domain].join("@");
      const fact = data.facts.find((entry) => entry.id === contact.source_fact_id) as GuidanceFact;
      return <article key={contact.id} className="my-4 rounded-xl border border-[var(--mp-border)] p-4">
        <h3 className="!mt-0">{contact.label[lang]}</h3>
        <button type="button" aria-expanded={!!visible[contact.id]} aria-controls={`contact-${contact.id}`} className="underline underline-offset-4" onClick={() => setVisible((current) => ({ ...current, [contact.id]: !current[contact.id] }))}>
          {visible[contact.id] ? copy.hide : copy.reveal}{": "}{contact.label[lang]}
        </button>
        <div id={`contact-${contact.id}`} hidden={!visible[contact.id]}>
          {visible[contact.id] && <p className="break-all"><a href={`mailto:${address}`}>{address}</a></p>}
        </div>
        <FactStamp fact={fact} lang={lang} />
      </article>;
    })}
  </section>;
}
