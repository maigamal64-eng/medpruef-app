import { entryLang } from "./entry-copy";
import { MENTOR_KEYS, mentorT, type MentorKey, type MentorUiLang } from "@/lib/i18n-mentor";

export function formatMentorDate(iso: string | null | undefined, lang: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString({ de: "de-AT", en: "en-GB" }[entryLang(lang)], { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" });
}

export function mentorPackageName(id: string | undefined, lang: string): string | null {
  if (!id) return null;
  const key = `pkg_name_${id}`;
  if (!(MENTOR_KEYS as readonly string[]).includes(key)) return null;
  return mentorT(key as MentorKey, entryLang(lang) as MentorUiLang);
}
