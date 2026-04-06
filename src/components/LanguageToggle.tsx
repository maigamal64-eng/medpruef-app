"use client";

type Lang = "de" | "en";

export default function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center bg-[#FFFFFF] rounded-lg shadow-[var(--shadow-xs)] p-0.5 text-xs border border-[#E4E9F0]">
      <button
        onClick={() => onChange("de")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "de"
            ? "bg-[#007B5F] text-[#003732]"
            : "text-[#A0AEC0] hover:text-[#4A5568]"
        }`}
      >
        DE
      </button>
      <button
        onClick={() => onChange("en")}
        className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
          lang === "en"
            ? "bg-[#007B5F] text-[#003732]"
            : "text-[#A0AEC0] hover:text-[#4A5568]"
        }`}
      >
        EN
      </button>
    </div>
  );
}
