"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import { getStoredSession } from "@/lib/auth";
import { FileText, GraduationCap, BarChart3, Flame, Globe, Smartphone, Send, Share2, Camera, Check } from "lucide-react";

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

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            ← {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C]">
            {lang === "de" ? "Über MedPrüf" : "About MedPrüf"}
          </h1>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>

        <div className="px-4 lg:px-8 py-6 max-w-2xl mx-auto stagger">
          {/* Hero */}
          <div className="text-center mb-8">
            <div className="w-20 h-20 rounded border border-[#007B5F]/30 bg-[#007B5F]/10 flex items-center justify-center text-4xl mx-auto mb-4">
              <img src="/brand/logo-mark.png" alt="MedPrüf" className="w-12 h-12" />
            </div>
            <img src="/brand/logo-full.png" alt="MedPrüf" className="h-10 mx-auto" />
            <p className="text-[#4A5568] text-base">
              {lang === "de"
                ? "Deine Lernplattform für die Kenntnisprüfung"
                : "Your learning platform for the Kenntnisprüfung"}
            </p>
          </div>

          {/* Authority Seal */}
          <div className="text-center mb-6">
            <img src="/brand/seal.png" alt="MedPrüf Official Seal" className="w-32 mx-auto" />
          </div>

          {/* What is MedPrüf */}
          <div className="card rounded-2xl p-6 mb-4">
            <h2 className="text-base font-semibold text-[#007B5F] mb-3">
              {lang === "de" ? "Was ist MedPrüf?" : "What is MedPrüf?"}
            </h2>
            <p className="text-[#4A5568] text-sm leading-relaxed">
              {lang === "de"
                ? "MedPrüf ist eine spezialisierte Lernplattform für ausländische Ärztinnen und Ärzte, die sich auf die österreichische Kenntnisprüfung (Wien) vorbereiten. Mit über 7.000 Übungsfragen aus allen relevanten Fachgebieten helfen wir dir, die Prüfung erfolgreich zu bestehen."
                : "MedPrüf is a specialized learning platform for foreign doctors preparing for the Austrian Kenntnisprüfung (Vienna). With over 7,000 practice questions across all relevant specialties, we help you pass the exam successfully."}
            </p>
          </div>

          {/* Target audience */}
          <div className="card rounded-2xl p-6 mb-4">
            <h2 className="text-base font-semibold text-[#F4A261] mb-3">
              {lang === "de" ? "Für wen ist MedPrüf?" : "Who is MedPrüf for?"}
            </h2>
            <ul className="space-y-2">
              {(lang === "de"
                ? [
                    "Ärztinnen und Ärzte mit ausländischem Abschluss",
                    "Approbationssuchende in Österreich (Wien)",
                    "Mediziner, die die Kenntnisprüfung ablegen müssen",
                    "Alle, die ihr medizinisches Wissen auffrischen möchten",
                  ]
                : [
                    "Doctors with foreign medical degrees",
                    "Those seeking medical licensure (Approbation) in Austria (Vienna)",
                    "Physicians required to take the Kenntnisprüfung",
                    "Anyone looking to refresh their medical knowledge",
                  ]
              ).map((item, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-[#4A5568]">
                  <Check className="w-4 h-4 text-[#007B5F] mt-0.5 flex-shrink-0" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Kenntnisprüfung info */}
          <div className="card rounded-2xl p-6 mb-4">
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Die Kenntnisprüfung" : "The Kenntnisprüfung"}
            </h2>
            <p className="text-[#4A5568] text-sm leading-relaxed mb-3">
              {lang === "de"
                ? "Die Kenntnisprüfung ist eine staatliche Prüfung für Ärzte mit ausländischer Ausbildung. Sie prüft, ob die medizinischen Kenntnisse dem Stand der österreichischen Ärzteausbildungsordnung (ÄAO) entsprechen."
                : "The Kenntnisprüfung is a state examination for doctors with foreign training. It tests whether medical knowledge meets the standards of the Austrian Ärzteausbildungsordnung (ÄAO)."}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: lang === "de" ? "Fragen gesamt" : "Total questions", value: "250" },
                { label: lang === "de" ? "Bestehensschwelle" : "Pass threshold", value: "60%" },
                { label: lang === "de" ? "Prüfungsdauer" : "Exam duration", value: "4h" },
                { label: lang === "de" ? "Fachgebiete" : "Specialties", value: "10" },
              ].map((stat) => (
                <div key={stat.label} className="bg-[#FFFFFF] rounded-xl p-3 text-center">
                  <p className="text-2xl font-black text-[#007B5F] font-mono">{stat.value}</p>
                  <p className="text-[10px] text-[#A0AEC0] mt-1">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Features */}
          <div className="card rounded-2xl p-6 mb-4">
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Features" : "Features"}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: <FileText className="w-4 h-4" />, label: lang === "de" ? "7.000+ Übungsfragen" : "7,000+ Practice Questions" },
                { icon: <GraduationCap className="w-4 h-4" />, label: lang === "de" ? "Prüfungssimulation" : "Exam Simulation" },
                { icon: <BarChart3 className="w-4 h-4" />, label: lang === "de" ? "Detaillierte Statistiken" : "Detailed Statistics" },
                { icon: <Flame className="w-4 h-4" />, label: lang === "de" ? "Gamification & XP" : "Gamification & XP" },
                { icon: <Globe className="w-4 h-4" />, label: lang === "de" ? "Deutsch & Englisch" : "German & English" },
                { icon: <Smartphone className="w-4 h-4" />, label: lang === "de" ? "Telegram Mini App" : "Telegram Mini App" },
              ].map((f) => (
                <div key={f.label} className="flex items-center gap-2 text-sm text-[#4A5568]">
                  {f.icon}
                  <span>{f.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Team */}
          <div className="card rounded-2xl p-6 mb-4">
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Team & Kontakt" : "Team & Contact"}
            </h2>
            <p className="text-[#4A5568] text-sm leading-relaxed mb-4">
              {lang === "de"
                ? "MedPrüf wird von einem engagierten Team entwickelt, das selbst Erfahrung mit der Approbation in Österreich hat. Wir wissen, wie herausfordernd dieser Prozess ist."
                : "MedPrüf is developed by a dedicated team with firsthand experience in Austrian medical licensure. We understand how challenging this process can be."}
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: <Send className="w-4 h-4" />, label: "Telegram", href: "https://t.me/MedPruefBot" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-3 py-2 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-sm text-[#4A5568] hover:border-[#007B5F]/40 hover:text-[#1A2B3C] transition-colors"
                >
                  {link.icon}
                  <span>{link.label}</span>
                </a>
              ))}
            </div>
          </div>

          {/* Social media */}
          <div className="card rounded-2xl p-6">
            <h2 className="text-base font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Social Media" : "Social Media"}
            </h2>
            <div className="flex flex-wrap gap-2">
              {[
                { icon: <Smartphone className="w-4 h-4" />, label: "Telegram Bot", href: "#" },
                { icon: <Share2 className="w-4 h-4" />, label: "Twitter / X", href: "#" },
                { icon: <Camera className="w-4 h-4" />, label: "Instagram", href: "#" },
              ].map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  className="flex items-center gap-2 px-3 py-2 bg-[#F7F9FC] border border-[#E4E9F0] rounded text-sm text-[#A0AEC0] cursor-pointer"
                >
                  {s.icon}
                  <span>{s.label}</span>
                  <span className="text-[9px] bg-[#F4A261]/10 text-[#F4A261] px-1 rounded border border-[#F4A261]/20">
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
