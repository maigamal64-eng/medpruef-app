"use client";

type Lang = "de" | "en";

export default function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center bg-[#1E293B] rounded-full p-0.5 text-xs border border-[#334155]/50">
      <button
        onClick={() => onChange("de")}
        className={`px-3 py-1.5 rounded-full font-medium transition-all duration-200 ${
          lang === "de"
            ? "bg-[#0891B2] text-white shadow-sm"
            : "text-[#64748B] hover:text-[#94A3B8]"
        }`}
      >
        DE
      </button>
      <button
        onClick={() => onChange("en")}
        className={`px-3 py-1.5 rounded-full font-medium transition-all duration-200 ${
          lang === "en"
            ? "bg-[#0891B2] text-white shadow-sm"
            : "text-[#64748B] hover:text-[#94A3B8]"
        }`}
      >
        EN
      </button>
    </div>
  );
}
