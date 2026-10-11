import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Wien: Anmeldung und Prüfungsregeln | MedPrüf",
  description: "Offizielle Quellen zu SIP4a, SIP5a, Rezeptierkunde und Gerichtsmedizin für Nostrifizierungswerber der MedUni Wien in Österreich.",
};

export default function WienRouteLayout({ children }: { children: ReactNode }) { return children; }
