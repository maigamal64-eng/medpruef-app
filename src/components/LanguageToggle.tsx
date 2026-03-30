"use client";

type Lang = 'de' | 'en'

export default function LanguageToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="flex items-center bg-slate-800 rounded-full p-0.5 text-xs">
      <button
        onClick={() => onChange('de')}
        className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
          lang === 'de' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        DE
      </button>
      <button
        onClick={() => onChange('en')}
        className={`px-2.5 py-1 rounded-full font-medium transition-colors ${
          lang === 'en' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-200'
        }`}
      >
        EN
      </button>
    </div>
  )
}
