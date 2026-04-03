"use client";

import { EXAM_SOURCES, setStoredExamSource, type ExamSourceId } from "@/lib/topics";

interface Props {
  lang: "de" | "en";
  onSelect: (id: ExamSourceId) => void;
}

export default function ExamSelector({ lang, onSelect }: Props) {
  const handle = (id: ExamSourceId) => {
    setStoredExamSource(id);
    onSelect(id);
  };

  return (
    <div className="fixed inset-0 bg-[#F7F9FC] z-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded border border-[#007B5F]/30 bg-[#007B5F]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            🏥
          </div>
          <h1 className="text-2xl font-bold text-[#1A2B3C] mb-2">MedPrüf</h1>
          <p className="text-[#A0AEC0] text-sm">
            {lang === "de"
              ? "Welche Prüfung bereitest du vor?"
              : "Which exam are you preparing for?"}
          </p>
        </div>

        {/* Options */}
        <div className="space-y-2.5">
          {EXAM_SOURCES.map((exam) => (
            <button
              key={exam.id}
              onClick={() => handle(exam.id)}
              className="w-full flex items-center gap-4 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#007B5F]/50 hover:bg-[#1E2640] rounded p-4 text-left transition-all active:scale-[0.98] group"
            >
              <span className="text-2xl">{exam.badge}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#1A2B3C] text-sm">{exam.fullName}</span>
                  {exam.id !== "all" && (
                    <span className="text-[10px] font-mono bg-[#007B5F]/10 text-[#007B5F] px-1.5 py-0.5 rounded border border-[#007B5F]/20">
                      {exam.id}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#A0AEC0] font-mono mt-0.5">
                  {exam.questions.toLocaleString("de-DE")}{" "}
                  {lang === "de" ? "Fragen" : "questions"}
                </div>
              </div>
              <span className="text-[#007B5F] opacity-0 group-hover:opacity-100 transition-opacity text-lg">
                →
              </span>
            </button>
          ))}
        </div>

        <p className="text-center text-[10px] text-[#A0AEC0]/60 mt-6">
          {lang === "de"
            ? "Du kannst dies jederzeit im Profil ändern"
            : "You can change this anytime in your profile"}
        </p>
      </div>
    </div>
  );
}
