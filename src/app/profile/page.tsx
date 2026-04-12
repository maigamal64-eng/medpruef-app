"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang, t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { getStoredSession, clearSession } from "@/lib/auth";
import {
  EXAM_SOURCES,
  getStoredExamSource,
  setStoredExamSource,
  type ExamSourceId,
} from "@/lib/topics";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

const PROFILE_KEY = "medpruef_profile";
const FAVORITES_KEY = "medpruef_favorites";

interface ProfileData {
  university: string;
  country: string;
  targetDate: string;
}

const AT_UNIVERSITIES_DE = [
  "Medizinische Universität Wien",
  "Medizinische Universität Graz",
  "Medizinische Universität Innsbruck",
  "Andere / Sonstige",
];

const AT_UNIVERSITIES_EN = [
  "Medical University of Vienna",
  "Medical University of Graz",
  "Medical University of Innsbruck",
  "Other",
];

function loadProfile(): ProfileData {
  if (typeof window === "undefined") return { university: "", country: "", targetDate: "" };
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
  } catch {
    return { university: "", country: "", targetDate: "" };
  }
}

function saveProfile(data: ProfileData) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
}

function loadFavoriteIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
  } catch {
    return [];
  }
}

export default function ProfilePage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [profile, setProfile] = useState<ProfileData>({ university: "", country: "", targetDate: "" });
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<ProfileData>({ university: "", country: "", targetDate: "" });
  const [favIds, setFavIds] = useState<number[]>([]);
  const [saved, setSaved] = useState(false);
  const [examSource, setExamSourceState] = useState<ExamSourceId>("kenntnispruefung");

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    const p = loadProfile();
    setProfile(p);
    setEditData(p);
    setFavIds(loadFavoriteIds());
    setExamSourceState(getStoredExamSource());
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const handleSave = () => {
    saveProfile(editData);
    setProfile(editData);
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  const gam = session?.gamification;
  const user = session?.user;
  const xpInfo = getLevelFromXP(gam?.total_xp || 0);
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  const universities = lang === "de" ? AT_UNIVERSITIES_DE : AT_UNIVERSITIES_EN;

  if (!user) {
    return (
      <div className="app-layout">
        <Sidebar lang={lang} />
        <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
            <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <h1 className="text-base font-bold text-[#1A2B3C]">{t("profile", lang)}</h1>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageToggle lang={lang} onChange={switchLang} />
            </div>
          </div>
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 text-center max-w-sm mx-auto">
            <div className="text-5xl mb-4">👤</div>
            <p className="text-[#4A5568] font-medium mb-2">{t("profile_not_logged_in", lang)}</p>
            <p className="text-[#A0AEC0] text-sm mb-6">
              {lang === "de"
                ? "Melde dich mit Telegram an, um deinen Fortschritt zu speichern"
                : "Sign in with Telegram to save your progress"}
            </p>
            <div className="flex flex-col gap-3 w-full mb-4">
              <a
                href="https://t.me/MedPruefBot?start=web_login"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[#1A2B3C] px-5 py-3 rounded font-semibold text-sm transition-all"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                </svg>
                {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
              </a>
              <Link
                href="/"
                className="px-6 py-3 bg-[#FFFFFF] border border-[#E4E9F0] text-[#4A5568] rounded text-sm hover:border-[#007B5F]/40 transition-colors"
              >
                ← {t("back_home", lang)}
              </Link>
            </div>
          </div>
        </main>
        <BottomNav lang={lang} />
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={user.id}
        userName={user.first_name}
        totalXp={gam?.total_xp || 0}
        streak={gam?.current_streak || 0}
        accuracy={accuracy}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            ← {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C]">{t("profile", lang)}</h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-2xl mx-auto space-y-5">

          {/* User card */}
          <div className="card rounded-2xl p-6">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 rounded-full bg-[#007B5F]/10 flex items-center justify-center text-2xl font-bold text-[#007B5F] ring-4 ring-[#007B5F]/20">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#1A2B3C]">
                  {user.first_name}{user.last_name ? ` ${user.last_name}` : ""}
                </h2>
                <p className="text-sm text-[#A0AEC0]">
                  {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
                </p>
                <p className="text-xs text-[#A0AEC0] font-mono mt-0.5">
                  ID: {user.telegram_id}
                </p>
              </div>
            </div>
            {/* XP progress */}
            <div className="h-1.5 bg-[#F7F9FC] rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-[#007B5F] rounded-full transition-all"
                style={{ width: `${xpInfo.progress}%` }}
              />
            </div>
            <p className="text-[10px] text-[#A0AEC0] font-mono">
              {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
            </p>
          </div>

          {/* Stats overview */}
          <div className="grid grid-cols-2 gap-3">
            <div className="card rounded-2xl p-5 text-center">
              <p className="text-2xl font-black text-[#F4A261] font-mono">{gam?.total_xp || 0}</p>
              <p className="text-xs text-[#A0AEC0] font-medium mt-1">{t("total_xp", lang)}</p>
            </div>
            <div className="card rounded-2xl p-5 text-center">
              <p className="text-2xl font-black text-[#D64545] font-mono">🔥 {gam?.current_streak || 0}</p>
              <p className="text-xs text-[#A0AEC0] font-medium mt-1">{t("current_streak", lang)}</p>
            </div>
            <div className="card rounded-2xl p-5 text-center">
              <p className="text-2xl font-black text-[#00A896] font-mono">{accuracy}%</p>
              <p className="text-xs text-[#A0AEC0] font-medium mt-1">{t("accuracy", lang)}</p>
            </div>
            <div className="card rounded-2xl p-5 text-center">
              <p className="text-2xl font-black text-[#007B5F] font-mono">{gam?.total_questions_answered || 0}</p>
              <p className="text-xs text-[#A0AEC0] font-medium mt-1">{t("total_answered", lang)}</p>
            </div>
          </div>

          {/* Editable profile info */}
          <div className="card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#1A2B3C]">
                {lang === "de" ? "Angaben" : "Details"}
              </h3>
              {!editing ? (
                <button
                  onClick={() => { setEditData(profile); setEditing(true); }}
                  className="text-xs text-[#007B5F] hover:text-[#00A896] transition-colors"
                >
                  ✏ {t("edit", lang)}
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="space-y-4">
                {/* University */}
                <div>
                  <label className="block text-xs text-[#A0AEC0] mb-1.5">{t("university", lang)}</label>
                  <select
                    value={editData.university}
                    onChange={(e) => setEditData({ ...editData, university: e.target.value })}
                    className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 text-sm text-[#1A2B3C] focus:outline-none focus:border-[#007B5F]/50"
                  >
                    <option value="">{t("select_university", lang)}</option>
                    {universities.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                {/* Country */}
                <div>
                  <label className="block text-xs text-[#A0AEC0] mb-1.5">{t("country_of_origin", lang)}</label>
                  <input
                    type="text"
                    value={editData.country}
                    onChange={(e) => setEditData({ ...editData, country: e.target.value })}
                    placeholder={t("select_country", lang)}
                    className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50 focus:bg-white transition-colors"
                  />
                </div>

                {/* Target exam date */}
                <div>
                  <label className="block text-xs text-[#A0AEC0] mb-1.5">{t("target_exam_date", lang)}</label>
                  <input
                    type="date"
                    value={editData.targetDate}
                    onChange={(e) => setEditData({ ...editData, targetDate: e.target.value })}
                    className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 text-sm text-[#1A2B3C] focus:outline-none focus:border-[#007B5F]/50"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleSave}
                    className="btn-secondary flex-1 py-2.5 text-sm"
                  >
                    {t("save", lang)}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 py-2.5 border border-[#E4E9F0] text-[#A0AEC0] text-sm rounded hover:border-[#007B5F]/30 transition-colors"
                  >
                    {t("cancel", lang)}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <ProfileRow
                  icon="🎓"
                  label={t("university", lang)}
                  value={profile.university || (lang === "de" ? "Nicht angegeben" : "Not specified")}
                  muted={!profile.university}
                />
                <ProfileRow
                  icon="🌍"
                  label={t("country_of_origin", lang)}
                  value={profile.country || (lang === "de" ? "Nicht angegeben" : "Not specified")}
                  muted={!profile.country}
                />
                <ProfileRow
                  icon="📅"
                  label={t("target_exam_date", lang)}
                  value={profile.targetDate
                    ? new Date(profile.targetDate).toLocaleDateString(lang === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
                    : lang === "de" ? "Nicht gesetzt" : "Not set"}
                  muted={!profile.targetDate}
                />
                {saved && (
                  <p className="text-xs text-[#00A896] animate-fade-in">✓ {t("note_saved", lang)}</p>
                )}
              </div>
            )}
          </div>

          {/* Target exam countdown */}
          {(() => {
            if (!profile.targetDate) {
              return (
                <div className="card rounded-2xl p-5 text-center border-dashed border-2 border-[#E4E9F0]">
                  <p className="text-sm text-[#A0AEC0] mb-2">
                    {lang === "de" ? "Wann ist deine Prüfung?" : "When is your exam?"}
                  </p>
                  <button
                    onClick={() => setEditing(true)}
                    className="btn-secondary text-sm px-4 py-2"
                  >
                    {lang === "de" ? "Prüfungsdatum festlegen" : "Set exam date"}
                  </button>
                </div>
              );
            }
            const target = new Date(profile.targetDate);
            if (isNaN(target.getTime())) return null;
            const today = new Date();
            const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diff <= 0) return (
              <div className="bg-[#00A896]/8 border border-[#00A896]/25 rounded-2xl p-5 text-center">
                <p className="text-lg font-bold text-[#00A896] mb-1">
                  {lang === "de" ? "Prüfungszeit!" : "Exam time!"}
                </p>
                <p className="text-sm text-[#4A5568]">
                  {lang === "de" ? "Viel Erfolg bei deiner Prüfung!" : "Good luck on your exam!"}
                </p>
              </div>
            );
            return (
              <div className="bg-[#F4A261]/6 border border-[#F4A261]/25 rounded-2xl p-5 text-center">
                <p className="text-4xl font-black text-[#F4A261] font-mono mb-1">{diff}</p>
                <p className="text-sm text-[#4A5568]">
                  {lang === "de" ? "Tage bis zur Prüfung" : "days until your exam"}
                </p>
              </div>
            );
          })()}

          {/* Bookmarked questions */}
          <div className="card rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-[#1A2B3C] mb-3">
              ★ {t("favorites", lang)}{" "}
              {favIds.length > 0 && (
                <span className="font-mono text-[#A0AEC0]">({favIds.length})</span>
              )}
            </h3>
            {favIds.length === 0 ? (
              <p className="text-sm text-[#A0AEC0]">{t("no_favorites", lang)}</p>
            ) : (
              <div className="space-y-1">
                {favIds.slice(0, 10).map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between py-2 border-b border-[#E4E9F0]/50 last:border-0"
                  >
                    <span className="text-sm text-[#4A5568] font-mono">
                      {lang === "de" ? "Frage" : "Question"} #{id}
                    </span>
                    <Link
                      href={`/quiz?questionId=${id}`}
                      className="text-xs text-[#007B5F] hover:text-[#00A896] transition-colors"
                    >
                      {lang === "de" ? "Üben" : "Practice"} →
                    </Link>
                  </div>
                ))}
                {favIds.length > 10 && (
                  <p className="text-xs text-[#A0AEC0] pt-1 font-mono">
                    +{favIds.length - 10} {lang === "de" ? "weitere" : "more"}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Daily goal progress */}
          <div className="card rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Tagesziel" : "Daily Goal"}
            </h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[#4A5568]">
                {gam?.daily_questions_today || 0} / {user.daily_goal || 20}
              </span>
              <span className="text-sm font-mono text-[#007B5F]">
                {Math.min(100, Math.round(((gam?.daily_questions_today || 0) / (user.daily_goal || 20)) * 100))}%
              </span>
            </div>
            <div className="h-2 bg-[#F7F9FC] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#007B5F] rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.round(((gam?.daily_questions_today || 0) / (user.daily_goal || 20)) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Exam selection */}
          <div className="card rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-[#1A2B3C] mb-3">
              {lang === "de" ? "Prüfungsauswahl" : "Exam Selection"}
            </h3>
            <div className="space-y-2">
              {EXAM_SOURCES.map((exam) => (
                <button
                  key={exam.id}
                  onClick={() => {
                    setStoredExamSource(exam.id);
                    setExamSourceState(exam.id);
                  }}
                  className={`w-full flex items-center gap-3 rounded p-3 text-left text-sm transition-all ${
                    examSource === exam.id
                      ? "bg-[#007B5F]/12 border border-[#007B5F]/40 text-[#007B5F]"
                      : "border border-[#E4E9F0] text-[#4A5568] hover:border-[#007B5F]/30"
                  }`}
                >
                  <span>{exam.badge}</span>
                  <span className="flex-1">{exam.fullName}</span>
                  <span className="font-mono text-xs text-[#A0AEC0]">
                    {exam.questions.toLocaleString("de-DE")}
                  </span>
                  {examSource === exam.id && (
                    <span className="text-[#007B5F] text-xs font-bold">✓</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Connect Telegram — shown if guest */}
          {user.id.startsWith("guest_") && (
            <div className="card rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-[#1A2B3C] mb-2">
                {lang === "de" ? "Später mit Telegram verbinden" : "Connect Telegram later"}
              </h3>
              <p className="text-xs text-[#A0AEC0] mb-4">
                {lang === "de"
                  ? "Verbinde deinen Fortschritt mit Telegram, um geräteübergreifend zu lernen."
                  : "Connect your progress to Telegram to study across devices."}
              </p>
              <a
                href="https://t.me/MedPruefBot?start=web_login"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-[#1A2B3C] px-5 py-3 rounded font-semibold text-sm transition-all w-full"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
                </svg>
                {lang === "de" ? "Mit Telegram verbinden" : "Connect with Telegram"}
              </a>
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full py-3 border border-[#D64545]/30 text-[#D64545] text-sm rounded hover:bg-[#D64545]/8 transition-colors"
          >
            {lang === "de" ? "Abmelden" : "Sign Out"}
          </button>
        </div>
      </main>

      <BottomNav lang={lang} userId={user.id} />
    </div>
  );
}

function ProfileRow({
  icon,
  label,
  value,
  muted,
}: {
  icon: string;
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-6 flex-shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-[#A0AEC0] uppercase tracking-wider">{label}</p>
        <p className={`text-sm ${muted ? "text-[#A0AEC0] italic" : "text-[#1A2B3C]"}`}>{value}</p>
      </div>
    </div>
  );
}
