"use client";
import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { getStoredTheme, toggleTheme, type Theme } from "./ThemeProvider";
import { t, useLang } from "@/lib/i18n";

export default function ThemeToggle() {
  const lang = useLang();
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const handleToggle = () => {
    const next = toggleTheme();
    setTheme(next);
  };

  const toggleLabel = t(theme === "dark" ? "home_light_theme" : "home_dark_theme", lang);

  return (
    <button
      onClick={handleToggle}
      className="w-11 h-11 flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--mp-border)]/50 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]"
      title={toggleLabel}
      aria-label={toggleLabel}
    >
      {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </button>
  );
}
