"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang, t } from "@/lib/i18n";
import { getStoredSession, clearSession } from "@/lib/auth";
import { getStoredTheme, setStoredTheme, type Theme } from "@/components/ThemeProvider";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { Moon, Sun, Globe, Target, Calendar, Bell, Trash2, Download, LogOut, Info, Shield } from "lucide-react";

type Lang = "de" | "en";

const PROFILE_KEY = "medpruef_profile";

interface ProfileData {
  university: string;
  country: string;
  targetDate: string;
  dailyGoal: number;
}

function loadProfile(): ProfileData {
  if (typeof window === "undefined") return { university: "", country: "", targetDate: "", dailyGoal: 20 };
  try {
    const data = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return { university: "", country: "", targetDate: "", dailyGoal: 20, ...data };
  } catch {
    return { university: "", country: "", targetDate: "", dailyGoal: 20 };
  }
}

function saveProfile(data: ProfileData) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(data));
}

export default function SettingsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [theme, setThemeState] = useState<Theme>("light");
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);
  const [profile, setProfile] = useState<ProfileData>({ university: "", country: "", targetDate: "", dailyGoal: 20 });
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    setLangState(getLang());
    setThemeState(getStoredTheme());
    setSession(getStoredSession());
    setProfile(loadProfile());
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const handleThemeToggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setStoredTheme(next);
    setThemeState(next);
  };

  const handleDailyGoalChange = (value: number) => {
    const clamped = Math.max(5, Math.min(100, value));
    const updated = { ...profile, dailyGoal: clamped };
    setProfile(updated);
    saveProfile(updated);
  };

  const handleTargetDateChange = (value: string) => {
    const updated = { ...profile, targetDate: value };
    setProfile(updated);
    saveProfile(updated);
  };

  const handleClearData = () => {
    const msg = t("clear_data_confirm", lang);
    if (!window.confirm(msg)) return;

    // Clear quiz-related localStorage keys
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith("medpruef_notes_") ||
        key === "medpruef_favorites" ||
        key === "medpruef_quiz_autosave" ||
        key === "medpruef_weakness"
      )) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => setCleared(false), 3000);
  };

  const handleLogout = () => {
    clearSession();
    window.location.href = "/";
  };

  const user = session?.user;
  const gam = session?.gamification;
  const accuracy =
    gam && gam.total_questions_answered > 0
      ? Math.round((gam.total_correct / gam.total_questions_answered) * 100)
      : 0;

  return (
    <div className="app-layout">
      <Sidebar
        lang={lang}
        userId={user?.id}
        userName={user?.first_name}
        totalXp={gam?.total_xp || 0}
        streak={gam?.current_streak || 0}
        accuracy={accuracy}
      />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            &larr; {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C]">{t("settings", lang)}</h1>
          <div className="w-16" />
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-2xl mx-auto space-y-5 pb-28">

          {/* ===== SECTION 1: Appearance ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
              <Sun className="w-5 h-5 text-[#F4A261]" />
              {t("appearance", lang)}
            </h2>

            {/* Dark mode toggle */}
            <div className="flex items-center justify-between py-3 border-b border-[#E4E9F0]">
              <div className="flex items-center gap-3">
                {theme === "dark" ? (
                  <Moon className="w-5 h-5 text-[#6366F1]" />
                ) : (
                  <Sun className="w-5 h-5 text-[#F4A261]" />
                )}
                <div>
                  <p className="text-sm font-medium text-[#1A2B3C]">{t("dark_mode", lang)}</p>
                  <p className="text-xs text-[#A0AEC0]">
                    {theme === "dark"
                      ? (lang === "de" ? "Aktiviert" : "Enabled")
                      : (lang === "de" ? "Deaktiviert" : "Disabled")}
                  </p>
                </div>
              </div>
              <button
                onClick={handleThemeToggle}
                className={`relative w-12 h-7 rounded-full transition-colors duration-300 ${
                  theme === "dark" ? "bg-[#6366F1]" : "bg-[#E4E9F0]"
                }`}
                aria-label="Toggle dark mode"
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 flex items-center justify-center ${
                    theme === "dark" ? "translate-x-5" : "translate-x-0"
                  }`}
                >
                  {theme === "dark" ? (
                    <Moon className="w-3.5 h-3.5 text-[#6366F1]" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-[#F4A261]" />
                  )}
                </span>
              </button>
            </div>

            {/* Language toggle */}
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <Globe className="w-5 h-5 text-[#007B5F]" />
                <div>
                  <p className="text-sm font-medium text-[#1A2B3C]">{t("language", lang)}</p>
                  <p className="text-xs text-[#A0AEC0]">
                    {lang === "de" ? "Deutsch" : "English"}
                  </p>
                </div>
              </div>
              <div className="flex items-center bg-[#F7F9FC] rounded-lg p-0.5 text-xs border border-[#E4E9F0]">
                <button
                  onClick={() => switchLang("de")}
                  className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
                    lang === "de"
                      ? "bg-[#007B5F] text-white"
                      : "text-[#A0AEC0] hover:text-[#4A5568]"
                  }`}
                >
                  DE
                </button>
                <button
                  onClick={() => switchLang("en")}
                  className={`px-3 py-1.5 rounded font-medium transition-all duration-200 ${
                    lang === "en"
                      ? "bg-[#007B5F] text-white"
                      : "text-[#A0AEC0] hover:text-[#4A5568]"
                  }`}
                >
                  EN
                </button>
              </div>
            </div>
          </div>

          {/* ===== SECTION 2: Study Preferences ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-[#007B5F]" />
              {t("study_preferences", lang)}
            </h2>

            {/* Daily goal */}
            <div className="py-3 border-b border-[#E4E9F0]">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-[#1A2B3C]">{t("daily_goal_setting", lang)}</p>
                  <p className="text-xs text-[#A0AEC0]">
                    {lang === "de" ? "5-100 Fragen pro Tag" : "5-100 questions per day"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleDailyGoalChange(profile.dailyGoal - 5)}
                    className="w-8 h-8 rounded-lg border border-[#E4E9F0] flex items-center justify-center text-[#4A5568] hover:bg-[#F7F9FC] transition-colors text-sm font-bold"
                    disabled={profile.dailyGoal <= 5}
                  >
                    -
                  </button>
                  <span className="w-10 text-center text-lg font-bold text-[#007B5F] font-mono">
                    {profile.dailyGoal}
                  </span>
                  <button
                    onClick={() => handleDailyGoalChange(profile.dailyGoal + 5)}
                    className="w-8 h-8 rounded-lg border border-[#E4E9F0] flex items-center justify-center text-[#4A5568] hover:bg-[#F7F9FC] transition-colors text-sm font-bold"
                    disabled={profile.dailyGoal >= 100}
                  >
                    +
                  </button>
                </div>
              </div>
              {/* Goal progress bar preview */}
              <div className="h-1.5 bg-[#F7F9FC] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#007B5F] rounded-full transition-all duration-300"
                  style={{ width: `${(profile.dailyGoal / 100) * 100}%` }}
                />
              </div>
            </div>

            {/* Exam target date */}
            <div className="py-3 border-b border-[#E4E9F0]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-[#003A8C]" />
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C]">{t("exam_target_date", lang)}</p>
                    <p className="text-xs text-[#A0AEC0]">
                      {profile.targetDate
                        ? new Date(profile.targetDate).toLocaleDateString(
                            lang === "de" ? "de-AT" : "en-GB",
                            { day: "numeric", month: "long", year: "numeric" }
                          )
                        : (lang === "de" ? "Nicht gesetzt" : "Not set")}
                    </p>
                  </div>
                </div>
                <input
                  type="date"
                  value={profile.targetDate}
                  onChange={(e) => handleTargetDateChange(e.target.value)}
                  className="bg-[#F7F9FC] border border-[#E4E9F0] rounded-lg px-3 py-2 text-sm text-[#1A2B3C] focus:outline-none focus:border-[#007B5F]/50 w-40"
                />
              </div>
            </div>

            {/* Exam source (read-only) */}
            <div className="py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-[#1A2B3C]">{t("exam_source_label", lang)}</p>
                  <p className="text-xs text-[#A0AEC0]">
                    {lang === "de" ? "Kenntnisprüfung Wien" : "Kenntnisprüfung Vienna"}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-[#007B5F]/10 text-[#007B5F] text-xs font-semibold rounded-lg">
                  SIP
                </span>
              </div>
            </div>
          </div>

          {/* ===== SECTION 3: Notifications (Coming Soon) ===== */}
          <div className="card rounded-2xl p-5 opacity-60">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-1 flex items-center gap-2">
              <Bell className="w-5 h-5 text-[#A0AEC0]" />
              {t("notifications", lang)}
            </h2>
            <p className="text-xs text-[#A0AEC0] mb-4">{t("coming_soon_label", lang)}</p>

            <div className="space-y-3">
              {[
                { label: t("daily_reminder", lang), desc: lang === "de" ? "Erinnerung zum t\u00e4glichen Lernen" : "Reminder to study daily" },
                { label: t("streak_warning", lang), desc: lang === "de" ? "Warnung vor Verlust der Serie" : "Warning before losing streak" },
                { label: t("weekly_progress_notif", lang), desc: lang === "de" ? "W\u00f6chentliche Zusammenfassung" : "Weekly summary" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C]">{item.label}</p>
                    <p className="text-xs text-[#A0AEC0]">{item.desc}</p>
                  </div>
                  <div className="relative w-12 h-7 rounded-full bg-[#E4E9F0] cursor-not-allowed">
                    <span className="absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow-md" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== SECTION 4: Data & Privacy ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#D64545]" />
              {t("data_privacy", lang)}
            </h2>

            {/* Clear study data */}
            <div className="py-3 border-b border-[#E4E9F0]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Trash2 className="w-5 h-5 text-[#D64545]" />
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C]">{t("clear_data", lang)}</p>
                    <p className="text-xs text-[#A0AEC0]">
                      {lang === "de"
                        ? "Lesezeichen, Notizen und Quiz-Daten entfernen"
                        : "Remove bookmarks, notes, and quiz data"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClearData}
                  className="px-3 py-1.5 border border-[#D64545]/30 text-[#D64545] text-xs font-medium rounded-lg hover:bg-[#D64545]/5 transition-colors"
                >
                  {cleared ? t("data_cleared", lang) : t("clear_data", lang)}
                </button>
              </div>
            </div>

            {/* Export progress (placeholder) */}
            <div className="py-3 border-b border-[#E4E9F0] opacity-60">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Download className="w-5 h-5 text-[#A0AEC0]" />
                  <div>
                    <p className="text-sm font-medium text-[#1A2B3C]">{t("export_progress", lang)}</p>
                    <p className="text-xs text-[#A0AEC0]">{t("coming_soon_label", lang)}</p>
                  </div>
                </div>
                <button
                  disabled
                  className="px-3 py-1.5 border border-[#E4E9F0] text-[#A0AEC0] text-xs font-medium rounded-lg cursor-not-allowed"
                >
                  {t("export_progress", lang)}
                </button>
              </div>
            </div>

            {/* Logout */}
            {user && (
              <div className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <LogOut className="w-5 h-5 text-[#D64545]" />
                    <div>
                      <p className="text-sm font-medium text-[#1A2B3C]">{t("logout", lang)}</p>
                      <p className="text-xs text-[#A0AEC0]">
                        {user.first_name} ({lang === "de" ? "angemeldet" : "signed in"})
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-1.5 border border-[#D64545]/30 text-[#D64545] text-xs font-medium rounded-lg hover:bg-[#D64545]/5 transition-colors"
                  >
                    {t("logout", lang)}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ===== SECTION 5: About ===== */}
          <div className="card rounded-2xl p-5">
            <h2 className="text-lg font-semibold text-[#1A2B3C] mb-4 flex items-center gap-2">
              <Info className="w-5 h-5 text-[#3A7CA5]" />
              {t("about", lang)}
            </h2>

            <div className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <p className="text-sm text-[#4A5568]">{t("app_version", lang)}</p>
                <span className="text-sm font-mono text-[#007B5F]">MedPr&uuml;f v1.0</span>
              </div>

              <div className="py-2 border-t border-[#E4E9F0]">
                <p className="text-sm text-[#4A5568] text-center">
                  Made with &hearts; for Arabic-speaking doctors
                </p>
                <p className="text-xs text-[#A0AEC0] text-center mt-1">
                  {lang === "de"
                    ? "\u00d6sterreichische Kenntnisprüfung (Wien)"
                    : "Austrian Kenntnisprüfung (Vienna)"}
                </p>
              </div>

              <Link
                href="/about"
                className="block text-center text-sm text-[#007B5F] hover:text-[#00A896] transition-colors font-medium py-2"
              >
                {lang === "de" ? "Mehr erfahren" : "Learn more"} &rarr;
              </Link>
            </div>
          </div>

        </div>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}
