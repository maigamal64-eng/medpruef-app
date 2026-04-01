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
    <div className="fixed inset-0 bg-[#0C1324] z-50 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded border border-[#6BD8CB]/30 bg-[#6BD8CB]/10 flex items-center justify-center text-3xl mx-auto mb-4">
            🏥
          </div>
          <h1 className="text-2xl font-bold text-[#DCE1FB] mb-2">MedPrüf</h1>
          <p className="text-[#879391] text-sm">
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
              className="w-full flex items-center gap-4 bg-[#191F31] border border-[#3D4947] hover:border-[#6BD8CB]/50 hover:bg-[#1E2640] rounded p-4 text-left transition-all active:scale-[0.98] group"
            >
              <span className="text-2xl">{exam.badge}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[#DCE1FB] text-sm">{exam.fullName}</span>
                  {exam.id !== "all" && (
                    <span className="text-[10px] font-mono bg-[#6BD8CB]/10 text-[#6BD8CB] px-1.5 py-0.5 rounded border border-[#6BD8CB]/20">
                      {exam.id}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#879391] font-mono mt-0.5">
                  {exam.questions.toLocaleString("de-DE")}{" "}
                  {lang === "de" ? "Fragen" : "questions"}
                </div>
              </div>
              <span className="text-[#6BD8CB] opacity-0 group-hover:opacity-100 transition-opacity text-lg">
                →
              </span>
            </button>
          ))}
        </div>

        <p className="text-center text-[10px] text-[#879391]/60 mt-6">
          {lang === "de"
            ? "Du kannst dies jederzeit im Profil ändern"
            : "You can change this anytime in your profile"}
        </p>
      </div>
    </div>
  );
}
