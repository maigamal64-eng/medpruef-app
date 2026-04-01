"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import { getStoredSession } from "@/lib/auth";

type Lang = "de" | "en";

export default function AboutPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} userName={userName} />

      <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#3D4947]">
          <Link href="/" className="text-[#879391] hover:text-[#DCE1FB] text-sm transition-colors">
            ← {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[#DCE1FB]">
            {lang === "de" ? "Über MedPrüf" : "About MedPrüf"}
          </h1>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 rounded border border-[#6BD8CB]/30 bg-[#6BD8CB]/10 flex items-center justify-center text-4xl mx-auto mb-4">
              🏥
            </div>
            <h1 className="text-2xl font-bold text-[#DCE1FB] mb-2">MedPrüf</h1>
            <p className="text-[#BCC9C6] text-base">
              {lang === "de"
                ? "Deine Lernplattform für die Kenntnisprüfung"
                : "Your learning platform for the Kenntnisprüfung"}
            </p>
          </div>

          {/* What is MedPrüf */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 mb-4">
            <h2 className="text-base font-semibold text-[#6BD8CB] mb-3">
              {lang === "de" ? "Was ist MedPrüf?" : "What is MedPrüf?"}
            </h2>
            <p className="text-[#BCC9C6] text-sm leading-relaxed">
              {lang === "de"
                ? "MedPrüf ist eine spezialisierte Lernplattform für ausländische Ärztinnen und Ärzte, die sich auf die deutsche Kenntnisprüfung vorbereiten. Mit über 7.000 Übungsfragen aus allen relevanten Fachgebieten helfen wir dir, die Prüfung erfolgreich zu bestehen."
                : "MedPrüf is a specialized learning platform for foreign doctors preparing for the German Kenntnisprüfung (Knowledge Examination). With over 7,000 practice questions across all relevant specialties, we help you pass the exam successfully."}
            </p>
          </div>

          {/* Target audience */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 mb-4">
            <h2 className="text-base font-semibold text-[#FFB95F] mb-3">
              {lang === "de" ? "Für wen ist MedPrüf?" : "Who is MedPrüf for?"}
            </h2>
            <ul className="space-y-2">
              {(lang === "de"
                ? [
                    "Ärztinnen und Ärzte mit ausländischem Abschluss",
                    "Approbationssuchende in Deutschland und Österreich",
                    "Mediziner, die die Kenntnisprüfung ablegen müssen",
                    "Alle, die ihr medizinisches Wissen auffrischen möchten",
                  ]
                : [
                    "Doctors with foreign medical degrees",
                    "Those seeking medical licensure (Approbation) in Germany/Austria",
                    "Physicians required to take the Kenntnisprüfung",
                    "Anyone looking to refresh their medical knowledge",
                  ]
              ).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#BCC9C6]">
                  <span className="text-[#6BD8CB] mt-0.5 flex-shrink-0">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Kenntnisprüfung info */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 mb-4">
            <h2 className="text-base font-semibold text-[#DCE1FB] mb-3">
              {lang === "de" ? "Die Kenntnisprüfung" : "The Kenntnisprüfung"}
            </h2>
            <p className="text-[#BCC9C6] text-sm leading-relaxed mb-3">
              {lang === "de"
                ? "Die Kenntnisprüfung ist eine staatliche Prüfung für Ärzte mit ausländischer Ausbildung. Sie prüft, ob die medizinischen Kenntnisse dem Stand der deutschen Approbationsordnung entsprechen."
                : "The Kenntnisprüfung is a state examination for doctors with foreign training. It tests whether medical knowledge meets the standards of the German Approbationsordnung (medical licensing regulation)."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: lang === "de" ? "Fragen gesamt" : "Total questions", value: "250" },
                { label: lang === "de" ? "Bestehensschwelle" : "Pass threshold", value: "60%" },
                { label: lang === "de" ? "Prüfungsdauer" : "Exam duration", value: "4h" },
                { label: lang === "de" ? "Fachgebiete" : "Specialties", value: "10" },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#151B2D] rounded p-3 text-center">
                  <p className="text-lg font-bold text-[#6BD8CB] font-mono">{stat.value}</p>
                  <p className="text-[10px] text-[#879391] mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 mb-4">
            <h2 className="text-base font-semibold text-[#DCE1FB] mb-3">
              {lang === "de" ? "Features" : "Features"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: "📝", label: lang === "de" ? "7.000+ Übungsfragen" : "7,000+ Practice Questions" },
                { icon: "🎓", label: lang === "de" ? "Prüfungssimulation" : "Exam Simulation" },
                { icon: "📊", label: lang === "de" ? "Detaillierte Statistiken" : "Detailed Statistics" },
                { icon: "🔥", label: lang === "de" ? "Gamification & XP" : "Gamification & XP" },
                { icon: "🌍", label: lang === "de" ? "Deutsch & Englisch" : "German & English" },
                { icon: "📱", label: lang === "de" ? "Telegram Mini App" : "Telegram Mini App" },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-2 text-sm text-[#BCC9C6]">
                  <span>{f.icon}</span>
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Team */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5 mb-4">
            <h2 className="text-base font-semibold text-[#DCE1FB] mb-3">
              {lang === "de" ? "Team & Kontakt" : "Team & Contact"}
            </h2>
            <p className="text-[#BCC9C6] text-sm leading-relaxed mb-4">
              {lang === "de"
                ? "MedPrüf wird von einem engagierten Team entwickelt, das selbst Erfahrung mit der Approbation in Deutschland hat. Wir wissen, wie herausfordernd dieser Prozess ist."
                : "MedPrüf is developed by a dedicated team with firsthand experience in German medical licensure. We understand how challenging this process can be."}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: "✉️", label: "Telegram", href: "https://t.me/MedPruefBot" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-[#23293C] border border-[#3D4947] rounded text-sm text-[#BCC9C6] hover:border-[#6BD8CB]/40 hover:text-[#DCE1FB] transition-colors"
                >
                  <span>{link.icon}</span>
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Social media */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5">
            <h2 className="text-base font-semibold text-[#DCE1FB] mb-3">
              {lang === "de" ? "Social Media" : "Social Media"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: "📱", label: "Telegram Bot", href: "#" },
                { icon: "🐦", label: "Twitter / X", href: "#" },
                { icon: "📸", label: "Instagram", href: "#" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  className="flex items-center gap-2 px-3 py-2 bg-[#23293C] border border-[#3D4947] rounded text-sm text-[#879391] cursor-pointer"
                >
                  <span>{s.icon}</span>
                  <span>{s.label}</span>
                  <span className="text-[9px] bg-[#FFB95F]/10 text-[#FFB95F] px-1 rounded border border-[#FFB95F]/20">
                    {lang === "de" ? "Bald" : "Soon"}
                  </span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}
