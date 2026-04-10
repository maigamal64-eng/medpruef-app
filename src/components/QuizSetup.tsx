"use client";

import { useEffect, useState } from "react";
import { Play, Clock, Hash, Tag, BookOpen, Calendar, X } from "lucide-react";
import { getTopicConfig } from "@/lib/topics";
import TopicIcon from "@/components/TopicIcon";

type Lang = "de" | "en";

export interface QuizConfig {
  topics: string[];          // empty = all topics
  tags: string[];            // empty = no tag filter
  targetCount: number;       // total questions in this quiz
  timeLimitMin: number | null; // null = no time limit
  examDateFrom: string | null; // YYYY-MM
  examDateTo: string | null;
  examSource: string;
}

interface TopicCount {
  topic: string;
  count: number;
}

interface Props {
  lang: Lang;
  examSource: string;
  initialTopic?: string | null; // pre-select if user came from a topic link
  onStart: (config: QuizConfig) => void;
}

const COUNT_PRESETS = [10, 20, 30, 50, 100];
const TIME_PRESETS: Array<{ value: number | null; label: { de: string; en: string } }> = [
  { value: null, label: { de: "Kein Limit", en: "No limit" } },
  { value: 5, label: { de: "5 Min", en: "5 min" } },
  { value: 10, label: { de: "10 Min", en: "10 min" } },
  { value: 20, label: { de: "20 Min", en: "20 min" } },
  { value: 45, label: { de: "45 Min", en: "45 min" } },
];

export default function QuizSetup({ lang, examSource, initialTopic, onStart }: Props) {
  const [topicCounts, setTopicCounts] = useState<TopicCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(
    new Set(initialTopic && initialTopic !== "random" ? [initialTopic] : [])
  );
  const [tagInput, setTagInput] = useState("");
  const [targetCount, setTargetCount] = useState<number>(20);
  const [timeLimitMin, setTimeLimitMin] = useState<number | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [examDateFrom, setExamDateFrom] = useState("");
  const [examDateTo, setExamDateTo] = useState("");

  // Fetch topic list with counts on mount
  useEffect(() => {
    setLoading(true);
    fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "topics", examSource }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTopicCounts(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [examSource]);

  const toggleTopic = (topic: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const totalAvailable = topicCounts
    .filter((t) => selectedTopics.size === 0 || selectedTopics.has(t.topic))
    .reduce((sum, t) => sum + t.count, 0);

  const handleStart = () => {
    const tags = tagInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    onStart({
      topics: Array.from(selectedTopics),
      tags,
      targetCount: Math.min(targetCount, totalAvailable || targetCount),
      timeLimitMin,
      examDateFrom: examDateFrom || null,
      examDateTo: examDateTo || null,
      examSource,
    });
  };

  return (
    <div className="min-h-screen bg-[#F7F9FC] dark:bg-[#0F172A] py-8 px-4">
      <div className="max-w-3xl mx-auto animate-scale-in">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#007B5F]/10 border border-[#007B5F]/30 mb-3">
            <BookOpen className="w-7 h-7 text-[#007B5F]" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#1A2B3C] dark:text-[#E2E8F0] font-display">
            {lang === "de" ? "Quiz konfigurieren" : "Customize your quiz"}
          </h1>
          <p className="text-sm text-[#A0AEC0] mt-1">
            {lang === "de"
              ? "Wähle Themen, Anzahl und Zeitlimit"
              : "Pick topics, count, and time limit"}
          </p>
        </div>

        <div className="space-y-5">
          {/* Topics */}
          <section className="card rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0] flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#007B5F]" />
                {lang === "de" ? "Fachgebiete" : "Subjects"}
                <span className="text-xs text-[#A0AEC0] font-normal">
                  ({selectedTopics.size === 0
                    ? lang === "de"
                      ? "alle"
                      : "all"
                    : `${selectedTopics.size} ${lang === "de" ? "ausgewählt" : "selected"}`})
                </span>
              </h2>
              {selectedTopics.size > 0 && (
                <button
                  onClick={() => setSelectedTopics(new Set())}
                  className="text-xs text-[#A0AEC0] hover:text-[#D64545] transition-colors flex items-center gap-1"
                >
                  <X className="w-3 h-3" />
                  {lang === "de" ? "Zurücksetzen" : "Clear"}
                </button>
              )}
            </div>
            {loading ? (
              <div className="text-xs text-[#A0AEC0]">{lang === "de" ? "Lade…" : "Loading…"}</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {topicCounts.map((t) => {
                  const cfg = getTopicConfig(t.topic);
                  const isSel = selectedTopics.has(t.topic);
                  return (
                    <button
                      key={t.topic}
                      onClick={() => toggleTopic(t.topic)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition-all active:scale-[0.98] ${
                        isSel
                          ? "border-[#007B5F] bg-[#007B5F]/8 text-[#1A2B3C] dark:text-[#E2E8F0]"
                          : "border-[#E4E9F0] dark:border-[#334155] hover:border-[#007B5F]/40 hover:bg-[#007B5F]/5 text-[#4A5568] dark:text-[#A0AEC0]"
                      }`}
                    >
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: `${cfg.color}18`, color: cfg.color }}
                      >
                        <TopicIcon name={cfg.icon} className="w-4 h-4" />
                      </span>
                      <span className="flex-1 text-xs font-medium truncate">{t.topic}</span>
                      <span className="text-[10px] font-mono text-[#A0AEC0]">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Question count */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0] flex items-center gap-2 mb-3">
              <Hash className="w-4 h-4 text-[#007B5F]" />
              {lang === "de" ? "Anzahl Fragen" : "Number of questions"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {COUNT_PRESETS.map((n) => (
                <button
                  key={n}
                  onClick={() => setTargetCount(n)}
                  className={`px-4 py-2 rounded-xl text-sm font-mono font-semibold transition-all ${
                    targetCount === n
                      ? "bg-[#007B5F] text-white shadow-[var(--shadow-card)]"
                      : "bg-[#F7F9FC] dark:bg-[#1E293B] text-[#4A5568] dark:text-[#A0AEC0] hover:bg-[#007B5F]/10"
                  }`}
                >
                  {n}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={500}
                value={targetCount}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v) && v > 0) setTargetCount(v);
                }}
                className="w-20 px-3 py-2 rounded-xl text-sm font-mono text-center bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] text-[#1A2B3C] dark:text-[#E2E8F0] focus:outline-none focus:border-[#007B5F]"
              />
            </div>
            {totalAvailable > 0 && (
              <p className="text-[11px] text-[#A0AEC0]">
                {lang === "de"
                  ? `${totalAvailable.toLocaleString("de-DE")} Fragen verfügbar mit deinen Filtern`
                  : `${totalAvailable.toLocaleString("en-US")} questions available with your filters`}
              </p>
            )}
          </section>

          {/* Time limit */}
          <section className="card rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0] flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-[#007B5F]" />
              {lang === "de" ? "Zeitlimit" : "Time limit"}
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {TIME_PRESETS.map((p) => (
                <button
                  key={String(p.value)}
                  onClick={() => setTimeLimitMin(p.value)}
                  className={`px-4 py-2 rounded-xl text-xs font-medium transition-all ${
                    timeLimitMin === p.value
                      ? "bg-[#007B5F] text-white shadow-[var(--shadow-card)]"
                      : "bg-[#F7F9FC] dark:bg-[#1E293B] text-[#4A5568] dark:text-[#A0AEC0] hover:bg-[#007B5F]/10"
                  }`}
                >
                  {p.label[lang]}
                </button>
              ))}
            </div>
          </section>

          {/* Advanced (tags + exam dates) */}
          <section className="card rounded-2xl p-5">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-[#1A2B3C] dark:text-[#E2E8F0] mb-2"
            >
              <span className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-[#007B5F]" />
                {lang === "de" ? "Erweitert" : "Advanced"}
              </span>
              <span className="text-xs text-[#A0AEC0]">{showAdvanced ? "−" : "+"}</span>
            </button>
            {showAdvanced && (
              <div className="space-y-4 mt-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 block">
                    {lang === "de" ? "Tags (durch Komma getrennt)" : "Tags (comma-separated)"}
                  </label>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="kardiologie, ekg"
                    className="w-full px-3 py-2 rounded-xl text-sm bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] text-[#1A2B3C] dark:text-[#E2E8F0] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {lang === "de" ? "Prüfung von" : "Exam from"}
                    </label>
                    <input
                      type="month"
                      value={examDateFrom}
                      onChange={(e) => setExamDateFrom(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] text-[#1A2B3C] dark:text-[#E2E8F0] focus:outline-none focus:border-[#007B5F]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] uppercase tracking-wider text-[#A0AEC0] font-semibold mb-1.5 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {lang === "de" ? "Prüfung bis" : "Exam to"}
                    </label>
                    <input
                      type="month"
                      value={examDateTo}
                      onChange={(e) => setExamDateTo(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-sm bg-[#F7F9FC] dark:bg-[#1E293B] border border-[#E4E9F0] dark:border-[#334155] text-[#1A2B3C] dark:text-[#E2E8F0] focus:outline-none focus:border-[#007B5F]"
                    />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Start button */}
        <button
          onClick={handleStart}
          disabled={loading}
          className="w-full mt-6 btn-primary py-4 text-base rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Play className="w-5 h-5" />
          {lang === "de" ? `Quiz starten (${targetCount} Fragen)` : `Start quiz (${targetCount} questions)`}
        </button>
      </div>
    </div>
  );
}
