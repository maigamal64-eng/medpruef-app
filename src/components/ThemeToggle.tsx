"use client";
import { useState, useEffect } from "react";
import { Moon, Sun } from "lucide-react";
import { getStoredTheme, toggleTheme, type Theme } from "./ThemeProvider";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  const handleToggle = () => {
    const next = toggleTheme();
    setTheme(next);
  };

  return (
    <button
      onClick={handleToggle}
      className="w-9 h-9 flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--mp-border)]/50 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)]"
      title={theme === "dark" ? "Light mode" : "Dark mode"}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
    </button>
  );
}
