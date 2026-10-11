import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Prüfungsformate in Österreich | MedPrüf",
  description: "SIP4a, SIP5a, Stichprobentest, Rezeptierkunde und Gerichtsmedizin: datierte Quellen zu Format, Punkten und Prüfungsregeln in Österreich.",
};
export default function ExamFormatsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
