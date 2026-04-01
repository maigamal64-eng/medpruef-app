"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang, t } from "@/lib/i18n";
import { getLevelFromXP } from "@/lib/xp";
import { getStoredSession, clearSession } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";

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

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    const p = loadProfile();
    setProfile(p);
    setEditData(p);
    setFavIds(loadFavoriteIds());
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
        <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
          <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#3D4947]">
            <Link href="/" className="text-[#879391] hover:text-[#DCE1FB] text-sm transition-colors">
              ← {t("back_home", lang)}
            </Link>
            <h1 className="text-base font-bold text-[#DCE1FB]">{t("profile", lang)}</h1>
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
          <div className="flex flex-col items-center justify-center min-h-[calc(100vh-60px)] px-4 text-center">
            <div className="text-5xl mb-4">👤</div>
            <p className="text-[#BCC9C6] font-medium mb-2">{t("profile_not_logged_in", lang)}</p>
            <p className="text-[#879391] text-sm mb-6">
              {lang === "de"
                ? "Nutze den Telegram-Login auf der Startseite"
                : "Use Telegram login on the home page"}
            </p>
            <Link
              href="/"
              className="px-6 py-3 bg-[#6BD8CB] text-[#003732] rounded font-bold text-sm hover:bg-[#89F5E7] transition-colors"
            >
              {t("back_home", lang)}
            </Link>
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

      <main className="main-content safe-area-top safe-area-bottom bg-[#0C1324]">
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#3D4947]">
          <Link href="/" className="text-[#879391] hover:text-[#DCE1FB] text-sm transition-colors">
            ← {t("back_home", lang)}
          </Link>
          <h1 className="text-base font-bold text-[#DCE1FB]">{t("profile", lang)}</h1>
          <LanguageToggle lang={lang} onChange={switchLang} />
        </div>

        <div className="px-4 lg:px-8 py-5 max-w-2xl mx-auto space-y-4">

          {/* User card */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded border border-[#6BD8CB]/30 bg-[#6BD8CB]/10 flex items-center justify-center text-2xl font-bold text-[#6BD8CB]">
                {user.first_name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold text-[#DCE1FB]">
                  {user.first_name}{user.last_name ? ` ${user.last_name}` : ""}
                </h2>
                <p className="text-sm text-[#879391]">
                  {xpInfo.rank} · <span className="font-mono">Lv.{xpInfo.level}</span>
                </p>
                <p className="text-xs text-[#879391] font-mono mt-0.5">
                  ID: {user.telegram_id}
                </p>
              </div>
            </div>
            {/* XP progress */}
            <div className="h-1.5 bg-[#23293C] rounded-full overflow-hidden mb-1">
              <div
                className="h-full bg-[#6BD8CB] rounded-full transition-all"
                style={{ width: `${xpInfo.progress}%` }}
              />
            </div>
            <p className="text-[10px] text-[#879391] font-mono">
              {Math.round(xpInfo.progress)}% {t("to_next_level", lang)}
            </p>
          </div>

          {/* Stats overview */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <p className="text-2xl font-bold text-[#FFB95F] font-mono">{gam?.total_xp || 0}</p>
              <p className="text-xs text-[#879391]">{t("total_xp", lang)}</p>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <p className="text-2xl font-bold text-[#FFB4AB] font-mono">🔥 {gam?.current_streak || 0}</p>
              <p className="text-xs text-[#879391]">{t("current_streak", lang)}</p>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <p className="text-2xl font-bold text-[#4EDEA3] font-mono">{accuracy}%</p>
              <p className="text-xs text-[#879391]">{t("accuracy", lang)}</p>
            </div>
            <div className="bg-[#191F31] border border-[#3D4947] rounded p-4 text-center">
              <p className="text-2xl font-bold text-[#6BD8CB] font-mono">{gam?.total_questions_answered || 0}</p>
              <p className="text-xs text-[#879391]">{t("total_answered", lang)}</p>
            </div>
          </div>

          {/* Editable profile info */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#DCE1FB]">
                {lang === "de" ? "Angaben" : "Details"}
              </h3>
              {!editing ? (
                <button
                  onClick={() => { setEditData(profile); setEditing(true); }}
                  className="text-xs text-[#6BD8CB] hover:text-[#89F5E7] transition-colors"
                >
                  ✏ {t("edit", lang)}
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="space-y-4">
                {/* University */}
                <div>
                  <label className="block text-xs text-[#879391] mb-1.5">{t("university", lang)}</label>
                  <select
                    value={editData.university}
                    onChange={(e) => setEditData({ ...editData, university: e.target.value })}
                    className="w-full bg-[#23293C] border border-[#3D4947] rounded px-3 py-2.5 text-sm text-[#DCE1FB] focus:outline-none focus:border-[#6BD8CB]/50"
                  >
                    <option value="">{t("select_university", lang)}</option>
                    {universities.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </select>
                </div>

                {/* Country */}
                <div>
                  <label className="block text-xs text-[#879391] mb-1.5">{t("country_of_origin", lang)}</label>
                  <input
                    type="text"
                    value={editData.country}
                    onChange={(e) => setEditData({ ...editData, country: e.target.value })}
                    placeholder={t("select_country", lang)}
                    className="w-full bg-[#23293C] border border-[#3D4947] rounded px-3 py-2.5 text-sm text-[#DCE1FB] placeholder-[#879391] focus:outline-none focus:border-[#6BD8CB]/50"
                  />
                </div>

                {/* Target exam date */}
                <div>
                  <label className="block text-xs text-[#879391] mb-1.5">{t("target_exam_date", lang)}</label>
                  <input
                    type="date"
                    value={editData.targetDate}
                    onChange={(e) => setEditData({ ...editData, targetDate: e.target.value })}
                    className="w-full bg-[#23293C] border border-[#3D4947] rounded px-3 py-2.5 text-sm text-[#DCE1FB] focus:outline-none focus:border-[#6BD8CB]/50"
                  />
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    onClick={handleSave}
                    className="flex-1 py-2.5 bg-[#6BD8CB]/15 border border-[#6BD8CB]/30 text-[#6BD8CB] text-sm font-medium rounded hover:bg-[#6BD8CB]/25 transition-colors"
                  >
                    {t("save", lang)}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="flex-1 py-2.5 border border-[#3D4947] text-[#879391] text-sm rounded hover:border-[#6BD8CB]/30 transition-colors"
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
                  <p className="text-xs text-[#4EDEA3] animate-fade-in">✓ {t("note_saved", lang)}</p>
                )}
              </div>
            )}
          </div>

          {/* Target exam countdown */}
          {profile.targetDate && (() => {
            const target = new Date(profile.targetDate);
            const today = new Date();
            const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diff <= 0) return null;
            return (
              <div className="bg-[#FFB95F]/6 border border-[#FFB95F]/25 rounded p-4 text-center">
                <p className="text-3xl font-bold text-[#FFB95F] font-mono mb-1">{diff}</p>
                <p className="text-sm text-[#BCC9C6]">
                  {lang === "de" ? "Tage bis zur Prüfung" : "days until your exam"}
                </p>
              </div>
            );
          })()}

          {/* Bookmarked questions */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5">
            <h3 className="text-sm font-semibold text-[#DCE1FB] mb-3">
              ★ {t("favorites", lang)}{" "}
              {favIds.length > 0 && (
                <span className="font-mono text-[#879391]">({favIds.length})</span>
              )}
            </h3>
            {favIds.length === 0 ? (
              <p className="text-sm text-[#879391]">{t("no_favorites", lang)}</p>
            ) : (
              <div className="space-y-1">
                {favIds.slice(0, 10).map((id) => (
                  <div
                    key={id}
                    className="flex items-center justify-between py-2 border-b border-[#3D4947]/50 last:border-0"
                  >
                    <span className="text-sm text-[#BCC9C6] font-mono">
                      {lang === "de" ? "Frage" : "Question"} #{id}
                    </span>
                    <Link
                      href={`/quiz?questionId=${id}`}
                      className="text-xs text-[#6BD8CB] hover:text-[#89F5E7] transition-colors"
                    >
                      {lang === "de" ? "Üben" : "Practice"} →
                    </Link>
                  </div>
                ))}
                {favIds.length > 10 && (
                  <p className="text-xs text-[#879391] pt-1 font-mono">
                    +{favIds.length - 10} {lang === "de" ? "weitere" : "more"}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Daily goal progress */}
          <div className="bg-[#191F31] border border-[#3D4947] rounded p-5">
            <h3 className="text-sm font-semibold text-[#DCE1FB] mb-3">
              {lang === "de" ? "Tagesziel" : "Daily Goal"}
            </h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-[#BCC9C6]">
                {gam?.daily_questions_today || 0} / {user.daily_goal || 20}
              </span>
              <span className="text-sm font-mono text-[#6BD8CB]">
                {Math.min(100, Math.round(((gam?.daily_questions_today || 0) / (user.daily_goal || 20)) * 100))}%
              </span>
            </div>
            <div className="h-2 bg-[#23293C] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#6BD8CB] rounded-full transition-all"
                style={{
                  width: `${Math.min(100, Math.round(((gam?.daily_questions_today || 0) / (user.daily_goal || 20)) * 100))}%`,
                }}
              />
            </div>
          </div>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="w-full py-3 border border-[#FFB4AB]/30 text-[#FFB4AB] text-sm rounded hover:bg-[#FFB4AB]/8 transition-colors"
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
        <p className="text-[10px] text-[#879391] uppercase tracking-wider">{label}</p>
        <p className={`text-sm ${muted ? "text-[#879391] italic" : "text-[#DCE1FB]"}`}>{value}</p>
      </div>
    </div>
  );
}
