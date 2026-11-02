/**
 * Copy of the A2 Home pointer (growth pass 2 Nov 2026), byte-exact from
 * reports/growth-weekly/2026-11-02/approved/in-app-lines.json (sha256
 * 315a2b1a8ae37e06d8afd6b396250d70d9e8eb72362c51dc33bf3cb998935143, Lektor
 * APPROVE round 2): a2-spt-next-track-pointer and its optional line
 * a2-pharma-sample-line. a2-gm-line stays out (Gerichtsmedizin practice not
 * live). German and English only; any other language reads English.
 */
export type SptLang = "de" | "en";

export const A2_POINTER: Record<SptLang, { title: string; body: string; cta: string; sampleLine: string }> = {
  de: {
    title: "Nach dem Stichprobentest geht es weiter",
    body: "Nach dem Stichprobentest folgen für fast alle Nostrifikantinnen und Nostrifikanten Rezeptierkunde und Gerichtsmedizin. Ihr Lernstand bleibt gespeichert.",
    cta: "Rezeptierkunde üben",
    sampleLine: "Die kostenlose Probe gilt auch für die Fragenbank Rezeptierkunde.",
  },
  en: {
    title: "After the Stichprobentest the route continues",
    body: "After the Stichprobentest, Rezeptierkunde and Gerichtsmedizin follow for almost every Nostrifikant. Your progress stays saved.",
    cta: "Practise Rezeptierkunde",
    sampleLine: "The free sample covers the Rezeptierkunde question bank as well.",
  },
};

export function sptLang(lang: string | null | undefined): SptLang {
  if (lang === "de") return "de";
  return "en";
}
