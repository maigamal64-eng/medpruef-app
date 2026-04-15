"use client";
import { useState } from "react";
import { ArrowRight, ArrowLeft, Calendar, Target, BookOpen, CheckCircle2, Moon, Sun, Zap, GraduationCap } from "lucide-react";
import { getStoredTheme, setStoredTheme } from "./ThemeProvider";

interface OnboardingData {
  examSource: string;
  examDate: string;
  level: string;
  dailyGoal: number;
  language: string;
  darkMode: boolean;
  completedAt?: string;
}

interface OnboardingProps {
  lang?: string;
  onComplete: (data: OnboardingData) => void;
}

const STEPS = [
  { title: { de: "Welche Prüfung?", en: "Which exam?" }, subtitle: { de: "Wähle dein Ziel", en: "Choose your target" }, icon: GraduationCap },
  { title: { de: "Wann ist deine Prüfung?", en: "When is your exam?" }, subtitle: { de: "Für deinen persönlichen Lernplan", en: "For your personalized study plan" }, icon: Calendar },
  { title: { de: "Tägliches Lernziel", en: "Daily study goal" }, subtitle: { de: "Wie viele Fragen pro Tag?", en: "How many questions per day?" }, icon: Target },
  { title: { de: "Dein Wissensstand", en: "Your current level" }, subtitle: { de: "Damit wir den richtigen Start finden", en: "So we find the right starting point" }, icon: BookOpen },
  { title: { de: "Personalisierung", en: "Personalization" }, subtitle: { de: "Deine Einstellungen", en: "Your preferences" }, icon: Zap },
];

const examPresets = [
  { value: "1month", label: { de: "In 1 Monat", en: "In 1 month" } },
  { value: "3months", label: { de: "In 3 Monaten", en: "In 3 months" } },
  { value: "6months", label: { de: "In 6 Monaten", en: "In 6 months" } },
  { value: "not_planned", label: { de: "Noch nicht geplant", en: "Not planned yet" } },
  { value: "custom", label: { de: "Anderes Datum", en: "Custom date" } },
];

const levels = [
  { value: "beginner", label: { de: "Anfänger", en: "Beginner" }, desc: { de: "Ich fange gerade an", en: "Just starting my preparation" }, emoji: "🌱" },
  { value: "intermediate", label: { de: "Mittelstufe", en: "Intermediate" }, desc: { de: "Ich habe schon etwas gelernt", en: "I've done some studying already" }, emoji: "📚" },
  { value: "advanced", label: { de: "Fortgeschritten", en: "Advanced" }, desc: { de: "Will mich perfektionieren", en: "Fine-tuning my knowledge" }, emoji: "🎯" },
];

const goalPresets = [10, 20, 30, 50];

export default function Onboarding({ lang = "de", onComplete }: OnboardingProps) {
  const l = lang as "de" | "en";
  const [step, setStep] = useState(0);
  const [data, setData] = useState<Partial<OnboardingData>>({
    examSource: "kenntnispruefung",
    dailyGoal: 20,
    language: lang,
    darkMode: getStoredTheme() === "dark",
  });
  const [customDate, setCustomDate] = useState("");

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const totalSteps = STEPS.length;

  const canProceed = () => {
    switch (step) {
      case 0: return true; // SIP auto-selected
      case 1: return data.examDate && (data.examDate !== "custom" || customDate);
      case 2: return (data.dailyGoal ?? 0) >= 5;
      case 3: return !!data.level;
      case 4: return true; // preferences always valid
      default: return false;
    }
  };

  const handleFinish = () => {
    let examDate = data.examDate || "not_planned";
    if (examDate === "custom" && customDate) examDate = customDate;

    const completed: OnboardingData = {
      examSource: data.examSource || "kenntnispruefung",
      examDate,
      level: data.level || "beginner",
      dailyGoal: data.dailyGoal || 20,
      language: data.language || "de",
      darkMode: data.darkMode || false,
      completedAt: new Date().toISOString(),
    };

    // Persist all settings
    localStorage.setItem("medpruef_onboarding", JSON.stringify(completed));
    localStorage.setItem("medpruef_profile", JSON.stringify({
      targetDate: examDate !== "not_planned" ? examDate : "",
      examSource: completed.examSource,
      level: completed.level,
    }));
    if (data.language) localStorage.setItem("medpruef-lang", data.language);
    if (data.darkMode) {
      setStoredTheme("dark");
    } else {
      setStoredTheme("light");
    }

    onComplete(completed);
  };

  const handleNext = () => {
    if (isLast) {
      handleFinish();
    } else {
      setStep(step + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#001B3D]/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-[var(--shadow-modal)] max-w-lg w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className="px-6 pt-5 pb-3 shrink-0">
          <div className="flex items-center justify-between mb-4">
            {STEPS.map((_, i) => (
              <div key={i} className="flex items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i < step ? "bg-[#007B5F] text-white" : i === step ? "bg-[#003A8C] text-white ring-4 ring-[#003A8C]/20" : "bg-[#E4E9F0] text-[#A0AEC0]"
                }`}>
                  {i < step ? <CheckCircle2 className="w-5 h-5" /> : i + 1}
                </div>
                {i < totalSteps - 1 && (
                  <div className={`w-8 h-0.5 mx-1 transition-all ${i < step ? "bg-[#007B5F]" : "bg-[#E4E9F0]"}`} />
                )}
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#A0AEC0] text-center">
            {l === "de" ? `Schritt ${step + 1} von ${totalSteps}` : `Step ${step + 1} of ${totalSteps}`}
          </p>
        </div>

        {/* Content */}
        <div className="px-6 flex-1 overflow-y-auto">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl bg-[#003A8C]/10 flex items-center justify-center mx-auto mb-3">
              <currentStep.icon className="w-7 h-7 text-[#003A8C]" />
            </div>
            <h2 className="text-xl font-bold text-[#1A2B3C] mb-1">{currentStep.title[l]}</h2>
            <p className="text-sm text-[#A0AEC0]">{currentStep.subtitle[l]}</p>
          </div>

          {/* Step 1: Exam */}
          {step === 0 && (
            <div className="space-y-3">
              <div className="p-4 rounded-xl border-2 border-[#007B5F] bg-[#007B5F]/5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-[#1A2B3C]">SIP Kenntnisprüfung</h3>
                    <p className="text-sm text-[#A0AEC0]">{l === "de" ? "Kenntnisprüfung Medizin (Wien, Österreich)" : "Medical Knowledge Exam (Vienna, Austria)"}</p>
                    <p className="text-xs text-[#007B5F] font-mono mt-1">7.567 {l === "de" ? "Fragen" : "questions"} · 10 {l === "de" ? "Fachgebiete" : "specialties"}</p>
                  </div>
                  <CheckCircle2 className="w-6 h-6 text-[#007B5F]" />
                </div>
              </div>
              <div className="p-4 rounded-xl border border-[#E4E9F0] bg-[#F7F9FC] opacity-50">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-[#A0AEC0]">{l === "de" ? "Weitere Prüfungen" : "More exams"}</h3>
                    <p className="text-sm text-[#A0AEC0]">{l === "de" ? "Bald verfügbar" : "Coming soon"}</p>
                  </div>
                  <span className="text-xs text-[#A0AEC0] bg-[#E4E9F0] px-2 py-0.5 rounded">{l === "de" ? "Bald" : "Soon"}</span>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Exam Date */}
          {step === 1 && (
            <div className="space-y-2.5">
              {examPresets.map((preset) => (
                <div key={preset.value}>
                  <button
                    className={`w-full p-3.5 rounded-xl border-2 text-left transition-all ${
                      data.examDate === preset.value ? "border-[#003A8C] bg-[#003A8C]/5" : "border-[#E4E9F0] hover:border-[#A0AEC0]"
                    }`}
                    onClick={() => setData({ ...data, examDate: preset.value })}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{preset.label[l]}</span>
                      {data.examDate === preset.value && <CheckCircle2 className="w-5 h-5 text-[#003A8C]" />}
                    </div>
                  </button>
                  {preset.value === "custom" && data.examDate === "custom" && (
                    <input
                      type="date"
                      value={customDate}
                      onChange={(e) => setCustomDate(e.target.value)}
                      className="mt-2 w-full px-3 py-2.5 border border-[#E4E9F0] rounded-xl focus:outline-none focus:border-[#003A8C] text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Step 3: Daily Goal */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="text-center">
                <span className="text-5xl font-black font-display text-[#003A8C]">{data.dailyGoal || 20}</span>
                <p className="text-sm text-[#A0AEC0] mt-1">{l === "de" ? "Fragen pro Tag" : "questions per day"}</p>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={data.dailyGoal || 20}
                onChange={(e) => setData({ ...data, dailyGoal: parseInt(e.target.value) })}
                className="w-full accent-[#003A8C]"
              />
              <div className="flex justify-between text-xs text-[#A0AEC0]">
                <span>5</span>
                <span>25</span>
                <span>50</span>
                <span>75</span>
                <span>100</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {goalPresets.map((g) => (
                  <button
                    key={g}
                    onClick={() => setData({ ...data, dailyGoal: g })}
                    className={`py-2 rounded-xl text-sm font-semibold border transition-all ${
                      data.dailyGoal === g ? "bg-[#003A8C] text-white border-[#003A8C]" : "bg-white border-[#E4E9F0] text-[#4A5568] hover:border-[#003A8C]"
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[#A0AEC0] text-center">
                {(data.dailyGoal || 20) <= 15
                  ? (l === "de" ? "🌱 Entspannt — perfekt zum Anfangen" : "🌱 Relaxed — perfect to start")
                  : (data.dailyGoal || 20) <= 30
                  ? (l === "de" ? "📚 Empfohlen — gute Balance" : "📚 Recommended — good balance")
                  : (data.dailyGoal || 20) <= 50
                  ? (l === "de" ? "🔥 Intensiv — schneller Fortschritt" : "🔥 Intense — fast progress")
                  : (l === "de" ? "⚡ Hardcore — maximaler Fortschritt" : "⚡ Hardcore — maximum progress")}
              </p>
            </div>
          )}

          {/* Step 4: Level */}
          {step === 3 && (
            <div className="space-y-3">
              {levels.map((level) => (
                <button
                  key={level.value}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                    data.level === level.value ? "border-[#003A8C] bg-[#003A8C]/5" : "border-[#E4E9F0] hover:border-[#A0AEC0]"
                  }`}
                  onClick={() => setData({ ...data, level: level.value })}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{level.emoji}</span>
                    <div className="flex-1">
                      <h3 className="font-semibold text-[#1A2B3C]">{level.label[l]}</h3>
                      <p className="text-sm text-[#A0AEC0]">{level.desc[l]}</p>
                    </div>
                    {data.level === level.value && <CheckCircle2 className="w-5 h-5 text-[#003A8C]" />}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 5: Preferences */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Language */}
              <div className="p-4 rounded-xl border border-[#E4E9F0]">
                <p className="text-sm font-semibold text-[#1A2B3C] mb-3">{l === "de" ? "Sprache" : "Language"}</p>
                <div className="grid grid-cols-2 gap-2">
                  {[{ val: "de", label: "Deutsch 🇩🇪" }, { val: "en", label: "English 🇬🇧" }].map((opt) => (
                    <button
                      key={opt.val}
                      onClick={() => setData({ ...data, language: opt.val })}
                      className={`py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                        data.language === opt.val ? "bg-[#003A8C] text-white border-[#003A8C]" : "bg-white border-[#E4E9F0] text-[#4A5568]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dark mode */}
              <div className="p-4 rounded-xl border border-[#E4E9F0]">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-[#1A2B3C]">{l === "de" ? "Dunkles Design" : "Dark Mode"}</p>
                    <p className="text-xs text-[#A0AEC0]">{l === "de" ? "Augen schonen beim Nachtlernen" : "Easy on eyes for night study"}</p>
                  </div>
                  <button
                    onClick={() => setData({ ...data, darkMode: !data.darkMode })}
                    className={`w-14 h-7 rounded-full transition-colors flex items-center px-1 ${
                      data.darkMode ? "bg-[#003A8C]" : "bg-[#E4E9F0]"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-full bg-white shadow-sm transition-transform flex items-center justify-center ${
                      data.darkMode ? "translate-x-7" : ""
                    }`}>
                      {data.darkMode ? <Moon className="w-3 h-3 text-[#003A8C]" /> : <Sun className="w-3 h-3 text-[#F4A261]" />}
                    </div>
                  </button>
                </div>
              </div>

              {/* Summary */}
              <div className="p-4 rounded-xl bg-[#F7F9FC] border border-[#E4E9F0]">
                <p className="text-xs font-semibold text-[#A0AEC0] uppercase tracking-wider mb-2">{l === "de" ? "Zusammenfassung" : "Summary"}</p>
                <div className="space-y-1 text-sm text-[#4A5568]">
                  <p>📋 SIP Kenntnisprüfung (Wien)</p>
                  <p>📅 {data.examDate === "not_planned" || !data.examDate ? (l === "de" ? "Noch nicht geplant" : "Not planned") : data.examDate}</p>
                  <p>🎯 {data.dailyGoal || 20} {l === "de" ? "Fragen/Tag" : "questions/day"}</p>
                  <p>📊 {levels.find(lv => lv.value === data.level)?.label[l] || (l === "de" ? "Nicht gewählt" : "Not selected")}</p>
                </div>
              </div>
            </div>
          )}

          <div className="h-4" />
        </div>

        {/* Navigation */}
        <div className="px-6 py-4 border-t border-[#E4E9F0] shrink-0 flex items-center justify-between bg-white">
          <button
            onClick={() => step > 0 && setStep(step - 1)}
            disabled={step === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all text-sm ${
              step === 0 ? "text-[#E4E9F0] cursor-not-allowed" : "text-[#4A5568] hover:text-[#1A2B3C]"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            {l === "de" ? "Zurück" : "Back"}
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className="btn-primary px-6 py-2.5 rounded-xl text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLast ? (l === "de" ? "Los geht's!" : "Let's go!") : (l === "de" ? "Weiter" : "Next")}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
