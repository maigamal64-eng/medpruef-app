"use client";

type Lang = "de" | "en";

export default function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center bg-[#191F31] rounded p-0.5 text-xs border border-[#3D4947]">
      <button
        onClick={() => onChange("de")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "de"
            ? "bg-[#6BD8CB] text-[#003732]"
            : "text-[#879391] hover:text-[#BCC9C6]"
        }`}
      >
        DE
      </button>
      <button
        onClick={() => onChange("en")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "en"
            ? "bg-[#6BD8CB] text-[#003732]"
            : "text-[#879391] hover:text-[#BCC9C6]"
        }`}
      >
        EN
      </button>
    </div>
  );
}
