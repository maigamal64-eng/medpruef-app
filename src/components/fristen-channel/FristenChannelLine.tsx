import { ExternalLink } from "lucide-react";
import { FRISTEN_CHANNEL_URL, fristenCopy, type FristenLang } from "@/lib/fristen-channel";

/** a-channel-inflow: one line linking the owned Fristen channel. Callers check the flag. */
export default function FristenChannelLine({ lang, surface, className = "" }: { lang: FristenLang; surface: "calendar" | "lernplan"; className?: string }) {
  return (
    <p className={`min-w-0 text-sm leading-relaxed ${className}`} data-testid="fristen-channel-line" data-surface={surface}>
      <span>{fristenCopy("page_line", lang)}</span>{" "}
      <a
        href={FRISTEN_CHANNEL_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1 font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2"
      >
        {fristenCopy("page_link", lang)}
        <ExternalLink className="size-3 shrink-0" aria-hidden />
      </a>
    </p>
  );
}
