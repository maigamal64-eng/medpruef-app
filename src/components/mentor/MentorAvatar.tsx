import { Brain } from "lucide-react";
import { MENTOR_NAMES, type MentorUiLang } from "@/lib/i18n-mentor";
/** Shared mentor identity. The text badge does not rely on the icon alone. */
export default function MentorAvatar({lang,className=""}:{lang:MentorUiLang;className?:string}) {
  return <span aria-hidden className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-oxford-blue)] text-white ${className}`}>
    <Brain className="h-5 w-5" />
    <span className="absolute -bottom-1 -end-1 rounded border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-1 text-[12px] font-semibold text-[var(--mp-fg)]">{MENTOR_NAMES[lang].badge}</span>
  </span>;
}
