"use client";
import { useState, useEffect } from "react";
import { ArrowRight, ArrowLeft, Calendar, Target, BookOpen, CheckCircle2 } from "lucide-react";
import { t } from "@/lib/i18n";

interface OnboardingData {
  examSource: string;
  examDate: string;
  level: string;
  completedAt?: string;
}

interface OnboardingProps {
  lang?: string;
  onComplete: (data: OnboardingData) => void;
}

const examPresets = [
  { value: "1month", label: "In 1 Monat" },
  { value: "3months", label: "In 3 Monaten" },
  { value: "6months", label: "In 6 Monaten" },
  { value: "not_planned", label: "Noch nicht geplant" },
  { value: "custom", label: "Anderes Datum wählen" },
];

const levels = [
  { value: "beginner", label: "Anfänger", description: "Ich fange gerade mit dem Lernen an" },
  { value: "intermediate", label: "Mittelstufe", description: "Ich habe schon etwas gelernt" },
  { value: "advanced", label: "Fortgeschritten", description: "Ich kenne schon viel, will mich perfektionieren" },
];

export default function Onboarding({ lang = "de", onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [data, setData] = useState<Partial<OnboardingData>>({});
  const [customDate, setCustomDate] = useState("");

  const steps = [
    {
      title: "Welche Prüfung bereitest du vor?",
      subtitle: "Wähle deine Zielprüfung aus",
      icon: BookOpen,
    },
    {
      title: "Wann ist deine Prüfung?",
      subtitle: "Damit können wir deinen Lernplan optimieren",
      icon: Calendar,
    },
    {
      title: "Wie schätzt du dein aktuelles Niveau ein?",
      subtitle: "Das hilft uns, den richtigen Schwierigkeitsgrad zu finden",
      icon: Target,
    },
  ];

  const currentStepData = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  const handleNext = () => {
    if (currentStep === 0) {
      // Step 1: Exam selection (SIP is the only active option)
      setData({ ...data, examSource: "SIP" });
    }
    
    if (currentStep === 1) {
      // Step 2: Exam date
      let examDate = data.examDate;
      if (examDate === "custom" && customDate) {
        examDate = customDate;
      }
      setData({ ...data, examDate });
    }

    if (isLastStep) {
      // Final step - complete onboarding
      const completedData: OnboardingData = {
        examSource: data.examSource || "SIP",
        examDate: data.examDate || "not_planned",
        level: data.level || "beginner",
        completedAt: new Date().toISOString(),
      };

      // Save to localStorage
      if (typeof window !== 'undefined') {
        localStorage.setItem("medpruef_onboarding", JSON.stringify(completedData));
        
        // Also save to profile localStorage
        const profileData = {
          targetDate: completedData.examDate,
          examSource: completedData.examSource,
          level: completedData.level,
        };
        localStorage.setItem("medpruef_profile", JSON.stringify(profileData));
      }

      onComplete(completedData);
    } else {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return true; // SIP is auto-selected
      case 1:
        return data.examDate && (data.examDate !== "custom" || customDate);
      case 2:
        return data.level;
      default:
        return false;
    }
  };

  const calculateExamDate = (preset: string) => {
    if (preset === "not_planned") return "Noch nicht geplant";
    if (preset === "custom") return customDate || "Anderes Datum";
    
    const today = new Date();
    const months = preset === "1month" ? 1 : preset === "3months" ? 3 : 6;
    const targetDate = new Date(today.getFullYear(), today.getMonth() + months, today.getDate());
    return targetDate.toLocaleDateString("de-DE");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col overflow-hidden">
        {/* Progress indicator */}
        <div className="px-8 pt-8 shrink-0">
          <div className="flex items-center justify-between mb-8">
            {steps.map((_, index) => (
              <div key={index} className="flex items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                    index <= currentStep
                      ? "bg-[#007B5F] text-white"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {index < currentStep ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : (
                    index + 1
                  )}
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`w-12 h-0.5 mx-2 transition-all ${
                      index < currentStep ? "bg-[#007B5F]" : "bg-gray-200"
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-8 flex-1 overflow-y-auto">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-[#007B5F]/10 flex items-center justify-center mx-auto mb-4">
              <currentStepData.icon className="w-8 h-8 text-[#007B5F]" />
            </div>
            <h2 className="text-2xl font-bold text-[#1A2B3C] mb-2">
              {currentStepData.title}
            </h2>
            <p className="text-gray-600">{currentStepData.subtitle}</p>
          </div>

          <div className="space-y-4">
            {/* Step 1: Exam Selection */}
            {currentStep === 0 && (
              <div className="space-y-3">
                <div
                  className="p-4 rounded-xl border-2 border-[#007B5F] bg-[#007B5F]/5 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-[#1A2B3C]">SIP Staatsexamen</h3>
                      <p className="text-sm text-gray-600">Kenntnisprüfung Medizin (Wien, Österreich)</p>
                    </div>
                    <div className="w-6 h-6 rounded-full border-2 border-[#007B5F] bg-[#007B5F] flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    </div>
                  </div>
                </div>
                <div className="p-4 rounded-xl border border-gray-200 bg-gray-50 opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-500">Andere Prüfungen</h3>
                      <p className="text-sm text-gray-400">Werden bald verfügbar sein</p>
                    </div>
                    <div className="text-sm text-gray-400">Demnächst</div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Exam Date */}
            {currentStep === 1 && (
              <div className="space-y-3">
                {examPresets.map((preset) => (
                  <div key={preset.value}>
                    <button
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                        data.examDate === preset.value
                          ? "border-[#007B5F] bg-[#007B5F]/5"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                      onClick={() => setData({ ...data, examDate: preset.value })}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{preset.label}</span>
                        {data.examDate === preset.value && (
                          <CheckCircle2 className="w-5 h-5 text-[#007B5F]" />
                        )}
                      </div>
                      {preset.value !== "custom" && preset.value !== "not_planned" && (
                        <span className="text-sm text-gray-500">
                          {calculateExamDate(preset.value)}
                        </span>
                      )}
                    </button>
                    
                    {preset.value === "custom" && data.examDate === "custom" && (
                      <input
                        type="date"
                        value={customDate}
                        onChange={(e) => setCustomDate(e.target.value)}
                        className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#007B5F]/20 focus:border-[#007B5F]"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Step 3: Level */}
            {currentStep === 2 && (
              <div className="space-y-3">
                {levels.map((level) => (
                  <button
                    key={level.value}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      data.level === level.value
                        ? "border-[#007B5F] bg-[#007B5F]/5"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                    onClick={() => setData({ ...data, level: level.value })}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-[#1A2B3C]">{level.label}</h3>
                        <p className="text-sm text-gray-600">{level.description}</p>
                      </div>
                      {data.level === level.value && (
                        <CheckCircle2 className="w-5 h-5 text-[#007B5F]" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="h-4" />
        </div>

        {/* Navigation */}
        <div className="px-8 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between bg-white">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              currentStep === 0
                ? "text-gray-400 cursor-not-allowed"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            <ArrowLeft className="w-4 h-4" />
            Zurück
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed()}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg font-medium transition-all ${
              canProceed()
                ? "bg-[#007B5F] text-white hover:bg-[#007B5F]/90"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isLastStep ? "Starten" : "Weiter"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}